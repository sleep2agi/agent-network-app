// 需求池走 Hub。手机和电脑读同一份。Hub 还没有这个接口时不要退回本机列表。
import { appFetch } from './app-fetch';
import type { HubConfig } from './api';
import {
  dueOk,
  REQ_COLUMNS,
  REQ_PRIORITIES,
  type ReqColumn,
  type ReqPriority,
  type Requirement,
  type RequirementIssue,
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
    id: r.id,
    name: r.name.trim().slice(0, 80),
    priority,
    assignee: typeof r.assignee === 'string' ? r.assignee.trim().slice(0, 80) : '',
    due,
    column,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : '',
    issues: parseIssueList(r.issues),
  };
}

const ISSUE_URL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/(\d+)\/?$/;
const ISSUE_SHORT = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)$/;

export function parseIssueRef(text: string): { repo: string; number: number } | null {
  const raw = text.trim();
  const url = ISSUE_URL.exec(raw);
  if (url) return { repo: `${url[1]}/${url[2]}`, number: Number(url[3]) };
  const short = ISSUE_SHORT.exec(raw);
  if (short) return { repo: `${short[1]}/${short[2]}`, number: Number(short[3]) };
  return null;
}

export function issueUrl(issue: { repo: string; number: number }): string {
  return `https://github.com/${issue.repo}/issues/${issue.number}`;
}

function parseIssueList(raw: unknown): RequirementIssue[] {
  if (!Array.isArray(raw)) return [];
  const out: RequirementIssue[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const repo = typeof row.repo === 'string' ? row.repo.trim() : '';
    const number = typeof row.number === 'number' ? row.number : Number(row.number);
    const ref = parseIssueRef(`${repo}#${number}`);
    if (!ref || seen.has(`${ref.repo}#${ref.number}`)) continue;
    seen.add(`${ref.repo}#${ref.number}`);
    out.push({
      repo: ref.repo,
      number: ref.number,
      title: typeof row.title === 'string' ? row.title.trim().slice(0, 120) : '',
    });
    if (out.length >= 8) break;
  }
  return out;
}

export async function searchGithubIssues(query: string): Promise<RequirementIssue[]> {
  const q = query.trim();
  const direct = parseIssueRef(q);
  if (direct) return [{ repo: direct.repo, number: direct.number, title: '' }];
  if (q.length < 2) return [];
  const search = `is:issue (repo:sleep2agi/agent-network OR repo:sleep2agi/agent-network-app) ${q} in:title`;
  const res = await appFetch(`https://api.github.com/search/issues?per_page=8&q=${encodeURIComponent(search)}`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) return [];
  const data = await res.json() as { items?: unknown };
  return parseIssueList((Array.isArray(data.items) ? data.items : []).map(item => {
    if (!item || typeof item !== 'object') return null;
    const row = item as Record<string, unknown>;
    const repoUrl = typeof row.repository_url === 'string' ? row.repository_url : '';
    const repo = repoUrl.split('/repos/')[1] || '';
    return { repo, number: row.number, title: row.title };
  }));
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

export async function createRequirementOnHub(cfg: HubConfig, input: { name: string; priority: ReqPriority; assignee: string; due: string; column?: ReqColumn; clientId?: string; issues?: RequirementIssue[] }): Promise<Requirement> {
  const data = await call(cfg, '/api/requirements', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      priority: input.priority,
      assignee: input.assignee,
      due: input.due,
      column: input.column,
      client_id: input.clientId,
      issues: input.issues ?? [],
      network_id: cfg.networkId,
    }),
  }) as { requirement?: unknown };
  const row = requirementFromHub(data.requirement);
  if (!row) throw new RequirementsHubError('Hub 没有返回这条需求', 502);
  return row;
}

export async function moveRequirementOnHub(cfg: HubConfig, id: string, column: ReqColumn): Promise<Requirement> {
  const data = await call(cfg, `/api/requirements/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ column }),
  }) as { requirement?: unknown };
  const row = requirementFromHub(data.requirement);
  if (!row) throw new RequirementsHubError('Hub 没有返回这条需求', 502);
  return row;
}

export async function setRequirementIssues(cfg: HubConfig, id: string, issues: RequirementIssue[]): Promise<Requirement> {
  const data = await call(cfg, `/api/requirements/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ issues }),
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
