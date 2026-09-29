// 需求池走 Hub。手机和电脑读同一份。Hub 还没有这个接口时不要退回本机列表。
import { appFetch } from './app-fetch';
import { issuesFromHub } from './requirement-issues';
import type { HubConfig } from './api';
import { readStatusCountsAsFailure, reportReadFailure, reportReadSuccess } from './connectivity';
import { withDeadline } from './deadline';
import { assignmentsFromHub } from './requirement-people-api';
import type { RequirementPersonRef } from './requirement-people';
import { patchApplied, statusPatch, type EditPatch } from './task-board-model';
import {
  dueOk,
  REQ_COLUMNS,
  REQ_PRIORITIES,
  type ReqColumn,
  type ChecklistItem,
  type RequirementProject,
  type ReqPriority,
  type Requirement,
} from './requirements-model';

export class RequirementsHubError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function requirementFromHub(row: unknown): Requirement | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string' || !r.name.trim()) return null;
  const due = typeof r.due === 'string' && dueOk(r.due.trim()) ? r.due.trim() : '';
  const priority = REQ_PRIORITIES.includes(r.priority as ReqPriority) ? r.priority as ReqPriority : 'normal';
  const column = REQ_COLUMNS.includes(r.column as ReqColumn) ? r.column as ReqColumn : 'pool';
  return {
    ...(('updatedAt' in r || 'updated_at' in r) ? { updatedAt: typeof (r.updatedAt ?? r.updated_at) === 'string' ? String(r.updatedAt ?? r.updated_at) : null } : {}),
    ...('updated_by' in r ? { updatedBy: updateActor(r.updated_by) } : {}),
    ...('issues' in r ? { issues: issuesFromHub(r.issues) } : {}),
    ...(('owner' in r || 'participants' in r) ? assignmentsFromHub(r) : {}),
    ...('agent_owner' in r ? { agentOwner: agentOwnerFromHub(r.agent_owner) } : {}),
    ...(typeof r.description === 'string' ? { description: r.description } : {}),
    ...(Array.isArray(r.checklist) ? { checklist: checklistFromHub(r.checklist) } : {}),
    ...('project_id' in r ? { projectId: typeof r.project_id === 'string' && r.project_id ? r.project_id : null } : {}),
    ...('parent_id' in r ? { parentId: typeof r.parent_id === 'string' && r.parent_id ? r.parent_id : null } : {}),
    ...(r.children && typeof r.children === 'object' ? { children: childCounts(r.children) } : {}),
    ...('external_ref' in r ? { externalRef: typeof r.external_ref === 'string' && r.external_ref ? r.external_ref : null } : {}),
    // 只收 http(s):界面会把它做成可点的链接。
    ...('external_url' in r ? { externalUrl: typeof r.external_url === 'string' && /^https?:\/\//i.test(r.external_url) ? r.external_url : null } : {}),
    id: r.id,
    name: r.name.trim().slice(0, 80),
    priority,
    assignee: typeof r.assignee === 'string' ? r.assignee.trim().slice(0, 80) : '',
    due,
    column,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : '',
  };
}

function updateActor(value: unknown): RequirementPersonRef | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  return (v.kind === 'user' || v.kind === 'node') && typeof v.id === 'string' && !!v.id ? { kind: v.kind, id: v.id } : null;
}

/** 负责 Agent:只认 {kind:'node', id}。读不懂的值当成未分配,不让一张卡因为它整张丢掉。 */
function agentOwnerFromHub(value: unknown): RequirementPersonRef | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  return v.kind === 'node' && typeof v.id === 'string' && v.id ? { kind: 'node', id: v.id } : null;
}

function childCounts(value: unknown): { total: number; done: number } {
  const v = value as Record<string, unknown>;
  const total = typeof v.total === 'number' && v.total >= 0 ? Math.floor(v.total) : 0;
  const done = typeof v.done === 'number' && v.done >= 0 ? Math.min(Math.floor(v.done), total) : 0;
  return { total, done };
}

/** 子任务:坏的项丢掉,不让一张卡因为它整张丢掉。 */
function checklistFromHub(rows: unknown[]): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const v = row as Record<string, unknown>;
    if (typeof v.id !== 'string' || !v.id || typeof v.text !== 'string') continue;
    out.push({ id: v.id, text: v.text, done: v.done === true });
  }
  return out;
}

/** 需求池每个请求(含响应体)的硬上限。原来没有任何超时:手机链路上一个卡住的连接会让任务页
 *  首次加载永远停在转圈(2026-09-29 Vincent 折叠屏截图),而 refresh 只在 ready 时才跑,没有东西能把它救回来。 */
export const REQUIREMENTS_DEADLINE_MS = 20_000;
export const REQUIREMENTS_TIMEOUT_TEXT = `服务器 ${REQUIREMENTS_DEADLINE_MS / 1000} 秒内没有响应`;
let deadlineMs = REQUIREMENTS_DEADLINE_MS;
/** Test-only: shorten the deadline so a hanging-request test doesn't wait 20 s. */
export function __setRequirementsDeadlineForTest(ms: number = REQUIREMENTS_DEADLINE_MS): void { deadlineMs = ms; }

async function call(cfg: HubConfig, path: string, init?: RequestInit): Promise<unknown> {
  // 读(GET)和 api.ts 的轮询读一样上报连接横幅:任务页上轮询的主要就是这一路,不报的话横幅只能靠
  // 30 秒一次的头像轮询判断连没连上,「截至」时刻也会比屏上看板的实际数据更旧。写有自己的失败提示。
  const isRead = !init?.method || init.method === 'GET';
  const started = Date.now();
  const ctrl = new AbortController();
  let status = 0;
  try {
    const got = await withDeadline(
      (async () => {
        const res = await appFetch(`${cfg.serverUrl}${path}`, {
          ...init,
          headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
          signal: ctrl.signal,
        });
        status = res.status;
        if (res.status === 404) throw new RequirementsHubError('这个 Hub 还没有需求池', 404);
        if (!res.ok) throw new RequirementsHubError(`HTTP ${res.status}`, res.status);
        return { body: await res.json() as unknown };
      })(),
      deadlineMs,
      () => null,
    );
    if (!got) {
      ctrl.abort();
      throw new RequirementsHubError(REQUIREMENTS_TIMEOUT_TEXT, 0);
    }
    if (isRead) reportReadSuccess(Date.now(), Date.now() - started);
    return got.body;
  } catch (e) {
    if (isRead && (status === 0 || status === 200 || readStatusCountsAsFailure(status))) reportReadFailure();
    throw e;
  }
}

function scoped(cfg: HubConfig, path: string): string {
  if (!cfg.networkId) return path;
  const join = path.includes('?') ? '&' : '?';
  return `${path}${join}network_id=${encodeURIComponent(cfg.networkId)}`;
}

export async function listRequirements(cfg: HubConfig): Promise<Requirement[]> {
  return (await listRequirementsFull(cfg)).rows;
}

/** 连同 Hub 的 capabilities(#2076 起:agent_owner / description / checklist / projects / due_datetime;旧 Hub = [])。 */
export async function listRequirementsFull(cfg: HubConfig): Promise<{ rows: Requirement[]; capabilities: string[] }> {
  const data = await call(cfg, scoped(cfg, '/api/requirements')) as { requirements?: unknown; capabilities?: unknown };
  const rows = Array.isArray(data.requirements) ? data.requirements : [];
  const capabilities = Array.isArray(data.capabilities) ? data.capabilities.filter((c): c is string => typeof c === 'string') : [];
  return { rows: rows.map(requirementFromHub).filter((row): row is Requirement => !!row), capabilities };
}

type CreateInput = { name: string; priority: ReqPriority; assignee: string; due: string; column?: ReqColumn; clientId?: string; owner?: RequirementPersonRef; agentOwner?: RequirementPersonRef; projectId?: string; parentId?: string };

/** POST 的请求体。负责人只带稳定身份 {kind,id},多余字段(显示名、networkId…)一律不发。 */
export function createRequirementBody(cfg: HubConfig, input: CreateInput): Record<string, unknown> {
  return {
    name: input.name,
    priority: input.priority,
    assignee: input.assignee,
    due: input.due,
    column: input.column,
    client_id: input.clientId,
    network_id: cfg.networkId,
    owner: input.owner ? { kind: input.owner.kind, id: input.owner.id } : undefined,
    agent_owner: input.agentOwner ? { kind: input.agentOwner.kind, id: input.agentOwner.id } : undefined,
    project_id: input.projectId || undefined,
    parent_id: input.parentId || undefined,
  };
}

export async function createRequirementOnHub(cfg: HubConfig, input: CreateInput): Promise<Requirement> {
  const data = await call(cfg, '/api/requirements', {
    method: 'POST',
    body: JSON.stringify(createRequirementBody(cfg, input)),
  }) as { requirement?: unknown };
  const row = requirementFromHub(data.requirement);
  if (!row) throw new RequirementsHubError('Hub 没有返回这条需求', 502);
  return row;
}

/**
 * 改标题 / 优先级 / 期限 / 负责人(Hub #2070 的 PATCH)。只发改过的字段(editPatch)。
 * 旧 Hub:不认识这些字段时回 400 empty_patch;更老的会忽略字段照样回 200 —— 两种都报「还不能改」,
 * 不把没生效的保存说成成功。
 */
export async function updateRequirementOnHub(cfg: HubConfig, id: string, patch: EditPatch): Promise<Requirement> {
  const res = await appFetch(`${cfg.serverUrl}${scoped(cfg, `/api/requirements/${encodeURIComponent(id)}`)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const data = await res.json().catch(() => null) as { requirement?: unknown; error?: string } | null;
  if (res.status === 403) throw new RequirementsHubError('你没有修改这条需求的权限', 403);
  if (res.status === 400 && data?.error === 'invalid_issues') throw new RequirementsHubError('invalid_issues', 400);
  if (res.status === 400 && data?.error === 'empty_patch') throw new RequirementsHubError(HUB_CANNOT_EDIT, 400);
  if (res.status === 400 && (data?.error === 'person_not_in_network' || data?.error === 'invalid_person')) throw new RequirementsHubError('这个负责人已不在当前网络', 400);
  if (res.status === 400 && data?.error === 'owner_must_be_human') throw new RequirementsHubError('负责人只能是人类;Agent 请放在「负责 Agent」', 400);
  if (res.status === 400 && data?.error === 'project_archived') throw new RequirementsHubError('这个项目已归档，换一个项目', 400);
  if (res.status === 400 && data?.error === 'project_not_in_network') throw new RequirementsHubError('这个项目不在当前网络', 400);
  if (res.status === 400 && data?.error === 'parent_too_deep') throw new RequirementsHubError('子需求最多 5 层', 400);
  if (res.status === 400 && (data?.error === 'parent_cycle' || data?.error === 'parent_not_found')) throw new RequirementsHubError('不能挂到这个父需求下', 400);
  if (res.status === 400 && data?.error === 'invalid_description') throw new RequirementsHubError('描述太长了(最多 20000 字)', 400);
  if (res.status === 400 && data?.error === 'invalid_checklist') throw new RequirementsHubError('子任务不合法(最多 100 项,每项 1–500 字)', 400);
  if (res.status === 400 && data?.error === 'agent_owner_must_be_agent') throw new RequirementsHubError('负责 Agent 只能是 Agent 节点', 400);
  if (res.status === 404) throw new RequirementsHubError('这条需求已不存在', 404);
  if (!res.ok) throw new RequirementsHubError('修改没有保存，请重试', res.status);
  const row = requirementFromHub(data?.requirement);
  if (!row) throw new RequirementsHubError('Hub 没有返回这条需求', 502);
  if (!patchApplied(row, patch)) throw new RequirementsHubError(HUB_CANNOT_EDIT, 501);
  return row;
}

/**
 * 这个 Hub 分不分「负责人(人类)/ 负责 Agent」?看板里有卡片时直接看行里有没有 agent_owner 字段;
 * 一张卡都没有时用一个不存在的 id 探一下:认识 agent_owner 的 Hub 过了 empty_patch 检查、回 404
 * requirement_not_found;旧 Hub 不认识这个字段,回 400 empty_patch。探针什么都不写。
 */
export async function probeAgentOwnerSupport(cfg: HubConfig): Promise<boolean> {
  // 在看板首次加载的路径上:卡住就当旧 Hub(false),不能让它把任务页挂在转圈上。
  try {
    return await withDeadline((async () => {
      const res = await appFetch(`${cfg.serverUrl}${scoped(cfg, '/api/requirements/__capability_probe__')}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_owner: null }),
      });
      const data = await res.json().catch(() => null) as { error?: string } | null;
      return res.status === 404 && data?.error === 'requirement_not_found';
    })(), deadlineMs, () => false);
  } catch {
    return false;
  }
}

/**
 * 勾一个子任务:PATCH /api/requirements/{id}/checklist/{itemId} {done}。只改那一项(Agent 同时在勾别的项不会被盖掉)。
 * done 是显式值,重复请求结果一样。
 */
export async function setChecklistItemOnHub(cfg: HubConfig, id: string, itemId: string, done: boolean): Promise<Requirement> {
  const res = await appFetch(`${cfg.serverUrl}${scoped(cfg, `/api/requirements/${encodeURIComponent(id)}/checklist/${encodeURIComponent(itemId)}`)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ done }),
  });
  const data = await res.json().catch(() => null) as { requirement?: unknown; error?: string } | null;
  if (res.status === 403) throw new RequirementsHubError('你没有修改这条需求的权限', 403);
  if (res.status === 404 && data?.error === 'checklist_item_not_found') throw new RequirementsHubError('这个子任务已被删除，请刷新', 404);
  if (res.status === 404) throw new RequirementsHubError(HUB_CANNOT_EDIT, 404);
  if (!res.ok) throw new RequirementsHubError('子任务没有保存，请重试', res.status);
  const row = requirementFromHub(data?.requirement);
  if (!row) throw new RequirementsHubError('Hub 没有返回这条需求', 502);
  return row;
}

export const HUB_CANNOT_EDIT = '这个 Hub 还不能修改已有需求的内容，升级 Hub 后再试';

/** 当前登录用户的 user_id(「我负责的」用)。拿不到就是 null,左栏那一项不可用。 */
export async function fetchMyUserId(cfg: HubConfig): Promise<string | null> {
  try {
    const data = await withDeadline((async () => {
      const res = await appFetch(`${cfg.serverUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${cfg.token}` } });
      if (!res.ok) return null;
      return await res.json() as { user?: { user_id?: unknown } };
    })(), deadlineMs, () => null);
    return typeof data?.user?.user_id === 'string' && data.user.user_id ? data.user.user_id : null;
  } catch {
    return null;
  }
}

export async function moveRequirementOnHub(cfg: HubConfig, id: string, column: ReqColumn): Promise<Requirement> {
  const data = await call(cfg, `/api/requirements/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(statusPatch(column)),
  }) as { requirement?: unknown };
  const row = requirementFromHub(data.requirement);
  if (!row) throw new RequirementsHubError('Hub 没有返回这条需求', 502);
  return row;
}

/** 本机旧卡片逐条迁到 Hub。Hub 里已经有别的卡片也要迁。一张成功就从本机删掉一张，中途失败留下剩下的，下次接着迁。clientId 用本机 id，Hub 再收到同一条就返回原卡片。 */
export async function migrateLocalRequirements(
  cfg: HubConfig,
  read: () => Requirement[],
  write: (items: Requirement[]) => void,
  create: typeof createRequirementOnHub = createRequirementOnHub,
): Promise<{ migrated: number; left: number }> {
  let migrated = 0;
  for (const item of read()) {
    await create(cfg, {
      name: item.name,
      priority: item.priority,
      assignee: item.assignee,
      due: item.due,
      column: item.column,
      clientId: item.id,
    });
    write(read().filter(row => row.id !== item.id));
    migrated += 1;
  }
  return { migrated, left: read().length };
}

/** 负责节点从 Hub 的节点列表里点，不手填。空名丢掉，同名只留一个，按名字排。 */
export function filterAssigneeChoices(aliases: readonly string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of aliases) {
    const alias = raw.trim();
    if (!alias || seen.has(alias)) continue;
    if (q && !alias.toLowerCase().includes(q)) continue;
    seen.add(alias);
    out.push(alias);
  }
  out.sort((a, b) => a.localeCompare(b, 'zh'));
  return out;
}

// ── 项目 ──
// GET 在旧 Hub 上是 404(没有这个路由)→ 返回 null:界面把项目整个藏起来。

function projectFromHub(value: unknown): RequirementProject | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || typeof v.name !== 'string' || !v.name.trim()) return null;
  return {
    id: v.id,
    name: v.name,
    color: typeof v.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.color) ? v.color : '#4b5563',
    sort: typeof v.sort === 'number' ? v.sort : 0,
    archived: v.archived === true,
  };
}

async function projectCall(cfg: HubConfig, path: string, init?: RequestInit): Promise<{ status: number; data: any }> {
  // listProjects 在看板首次加载的路径上:同样要有上限。
  const got = await withDeadline((async () => {
    const res = await appFetch(`${cfg.serverUrl}${scoped(cfg, path)}`, {
      ...init,
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  })(), deadlineMs, () => null);
  if (!got) throw new RequirementsHubError(REQUIREMENTS_TIMEOUT_TEXT, 0);
  return got;
}

const projectError = (status: number, error?: string): RequirementsHubError =>
  new RequirementsHubError(
    error === 'project_name_taken' ? '已经有同名的项目'
      : error === 'invalid_project_name' ? '项目名 1–40 个字'
        : status === 403 ? '你没有管理项目的权限'
          : status === 404 ? '这个 Hub 还没有项目，升级 Hub 后再试' : '项目没有保存，请重试',
    status,
  );

/** 项目列表;旧 Hub(没有项目)返回 null。 */
export async function listProjects(cfg: HubConfig): Promise<RequirementProject[] | null> {
  const { status, data } = await projectCall(cfg, '/api/requirements/projects');
  if (status === 404) return null;
  if (status < 200 || status >= 300 || !Array.isArray(data?.projects)) throw projectError(status, data?.error);
  return data.projects.map(projectFromHub).filter((p: RequirementProject | null): p is RequirementProject => !!p);
}

export async function createProject(cfg: HubConfig, input: { name: string; color?: string }): Promise<RequirementProject> {
  const { status, data } = await projectCall(cfg, '/api/requirements/projects', { method: 'POST', body: JSON.stringify({ ...input, network_id: cfg.networkId }) });
  const row = projectFromHub(data?.project);
  if (status !== 201 || !row) throw projectError(status, data?.error);
  return row;
}

export async function updateProject(cfg: HubConfig, id: string, patch: { name?: string; color?: string; sort?: number; archived?: boolean }): Promise<RequirementProject> {
  const { status, data } = await projectCall(cfg, `/api/requirements/projects/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
  const row = projectFromHub(data?.project);
  if (status !== 200 || !row) throw projectError(status, data?.error);
  return row;
}
