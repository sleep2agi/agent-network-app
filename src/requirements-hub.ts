// 需求池走 Hub。手机和电脑读同一份。Hub 还没有这个接口时不要退回本机列表。
import { appFetch } from './app-fetch';
import type { HubConfig } from './api';
import { assignmentsFromHub } from './requirement-people-api';
import type { RequirementPersonRef } from './requirement-people';
import { patchApplied, statusPatch, type EditPatch } from './task-board-model';
import {
  dueOk,
  REQ_COLUMNS,
  REQ_PRIORITIES,
  type ReqColumn,
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
    ...(('owner' in r || 'participants' in r) ? assignmentsFromHub(r) : {}),
    id: r.id,
    name: r.name.trim().slice(0, 80),
    priority,
    assignee: typeof r.assignee === 'string' ? r.assignee.trim().slice(0, 80) : '',
    due,
    column,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : '',
  };
}

async function call(cfg: HubConfig, path: string, init?: RequestInit): Promise<unknown> {
  const res = await appFetch(`${cfg.serverUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
  });
  if (res.status === 404) throw new RequirementsHubError('这个 Hub 还没有需求池', 404);
  if (!res.ok) throw new RequirementsHubError(`HTTP ${res.status}`, res.status);
  return res.json();
}

function scoped(cfg: HubConfig, path: string): string {
  if (!cfg.networkId) return path;
  const join = path.includes('?') ? '&' : '?';
  return `${path}${join}network_id=${encodeURIComponent(cfg.networkId)}`;
}

export async function listRequirements(cfg: HubConfig): Promise<Requirement[]> {
  const data = await call(cfg, scoped(cfg, '/api/requirements')) as { requirements?: unknown };
  const rows = Array.isArray(data.requirements) ? data.requirements : [];
  return rows.map(requirementFromHub).filter((row): row is Requirement => !!row);
}

type CreateInput = { name: string; priority: ReqPriority; assignee: string; due: string; column?: ReqColumn; clientId?: string; owner?: RequirementPersonRef };

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
  if (res.status === 400 && data?.error === 'empty_patch') throw new RequirementsHubError(HUB_CANNOT_EDIT, 400);
  if (res.status === 400 && (data?.error === 'person_not_in_network' || data?.error === 'invalid_person')) throw new RequirementsHubError('这个负责人已不在当前网络', 400);
  if (res.status === 404) throw new RequirementsHubError('这条需求已不存在', 404);
  if (!res.ok) throw new RequirementsHubError('修改没有保存，请重试', res.status);
  const row = requirementFromHub(data?.requirement);
  if (!row) throw new RequirementsHubError('Hub 没有返回这条需求', 502);
  if (!patchApplied(row, patch)) throw new RequirementsHubError(HUB_CANNOT_EDIT, 501);
  return row;
}

export const HUB_CANNOT_EDIT = '这个 Hub 还不能修改已有需求的内容，升级 Hub 后再试';

/** 当前登录用户的 user_id(「我负责的」用)。拿不到就是 null,左栏那一项不可用。 */
export async function fetchMyUserId(cfg: HubConfig): Promise<string | null> {
  try {
    const res = await appFetch(`${cfg.serverUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${cfg.token}` } });
    if (!res.ok) return null;
    const data = await res.json() as { user?: { user_id?: unknown } };
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
