// 需求池走 Hub。手机和电脑读同一份。Hub 还没有这个接口时不要退回本机列表。
import { appFetch } from './app-fetch';
import type { HubConfig } from './api';
import { assignmentsFromHub } from './requirement-people-api';
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

export async function createRequirementOnHub(cfg: HubConfig, input: { name: string; priority: ReqPriority; assignee: string; due: string; column?: ReqColumn; clientId?: string }): Promise<Requirement> {
  const data = await call(cfg, '/api/requirements', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      priority: input.priority,
      assignee: input.assignee,
      due: input.due,
      column: input.column,
      client_id: input.clientId,
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
