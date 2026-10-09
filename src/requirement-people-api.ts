import { appFetch } from './app-fetch';
import { ACCEPT_COLUMNS_HEADERS } from './requirement-columns';
import type { HubConfig } from './api';
import { uniquePeople, type RequirementPerson, type RequirementPersonRef } from './requirement-people';

// Responses include both fields; writes contain only the edited fields.
export type RequirementAssignments = { owner: RequirementPersonRef | null; participants: RequirementPersonRef[] };
export class RequirementPeopleError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

function reference(value: unknown): RequirementPersonRef {
  if (!value || typeof value !== 'object') throw new RequirementPeopleError('成员身份格式错误', 502);
  const row = value as Record<string, unknown>;
  if ((row.kind !== 'user' && row.kind !== 'node') || typeof row.id !== 'string' || !row.id.trim()) throw new RequirementPeopleError('成员身份格式错误', 502);
  return { kind: row.kind, id: row.id };
}

export function assignmentsFromHub(value: unknown): RequirementAssignments {
  if (!value || typeof value !== 'object') throw new RequirementPeopleError('Hub 未返回人员绑定', 502);
  const row = value as Record<string, unknown>;
  // Missing fields mean unsupported, not an empty assignment that can be saved.
  if (!('owner' in row) || !('participants' in row)) throw new RequirementPeopleError('请升级 Hub 以支持负责人和参与人', 501);
  if (!Array.isArray(row.participants)) throw new RequirementPeopleError('参与人格式错误', 502);
  return { owner: row.owner === null ? null : reference(row.owner), participants: uniquePeople(row.participants.map(reference)) };
}

async function call(cfg: HubConfig, path: string, init?: RequestInit): Promise<any> {
  if (!cfg.networkId) throw new RequirementPeopleError('请先选择网络', 400);
  const response = await appFetch(`${cfg.serverUrl}${path}${path.includes('?') ? '&' : '?'}network_id=${encodeURIComponent(cfg.networkId)}`, {
    ...init, headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json', ...ACCEPT_COLUMNS_HEADERS },
  });
  if (response.status === 404 || response.status === 501) throw new RequirementPeopleError('Hub 不支持此操作，或需求已不存在；请刷新并检查 Hub 版本', response.status);
  const reading = !init?.method || init.method === 'GET';
  if (response.status === 403) throw new RequirementPeopleError(reading ? '你没有读取人员信息的权限' : '你没有修改人员绑定的权限', 403);
  if (!response.ok) throw new RequirementPeopleError(reading ? '人员信息加载失败，请重试' : '人员信息未保存，请重试', response.status);
  return response.json();
}

export const PEOPLE_LOAD_TIMEOUT_MS = 10_000;
// In-flight only: never reuse a directory across credentials or networks, and
// evict errors/timeouts so the next click really retries. No persistent cache.
const peopleReads = new Map<string, Promise<RequirementPerson[]>>();
export function listRequirementPeople(cfg: HubConfig): Promise<RequirementPerson[]> {
  const key = JSON.stringify([cfg.serverUrl, cfg.token, cfg.networkId]);
  const pending = peopleReads.get(key);
  if (pending) return pending;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new RequirementPeopleError('人员加载超时，请重试', 408));
      controller.abort();
    }, PEOPLE_LOAD_TIMEOUT_MS);
  });
  // Race includes response.json(), and settles even if native fetch ignores abort.
  const request = Promise.race([readPeople(cfg, controller.signal), timeout]).finally(() => {
    clearTimeout(timer);
    if (peopleReads.get(key) === request) peopleReads.delete(key);
  });
  peopleReads.set(key, request);
  return request;
}

async function readPeople(cfg: HubConfig, signal: AbortSignal): Promise<RequirementPerson[]> {
  const data = await call(cfg, '/api/requirements/people', { signal });
  if (!data || !Array.isArray(data.people)) throw new RequirementPeopleError('Hub 未返回可选成员', 502);
  return data.people.map((value: unknown) => {
    const ref = reference(value);
    const row = value as Record<string, unknown>;
    if (typeof row.networkId !== 'string' || row.networkId !== cfg.networkId || typeof row.name !== 'string' || (row.unavailable !== undefined && typeof row.unavailable !== 'boolean')) throw new RequirementPeopleError('Hub 返回了不属于当前网络的成员或无效数据', 502);
    return { ...ref, networkId: row.networkId, name: row.name, unavailable: row.unavailable === true, ...(typeof row.display_name === 'string' ? { displayName: row.display_name } : {}),
      // 角色 / 在线:Hub 给了才带上(目前的 Hub 不给 —— 选择器副标题就只写 成员 / Agent)。
      ...(row.role === 'admin' || row.role === 'owner' ? { role: 'admin' as const } : row.role === 'member' ? { role: 'member' as const } : {}),
      ...(typeof row.online === 'boolean' ? { online: row.online } : {}) };
  });
}

export async function saveRequirementAssignments(cfg: HubConfig, id: string, assignments: Partial<RequirementAssignments>): Promise<RequirementAssignments> {
  const payload: Partial<RequirementAssignments> = {};
  if (assignments.owner !== undefined) payload.owner = assignments.owner === null ? null : reference(assignments.owner);
  if (assignments.participants !== undefined) payload.participants = uniquePeople(assignments.participants.map(reference));
  if (!Object.keys(payload).length) throw new RequirementPeopleError('没有需要保存的人员变更', 400);
  const data = await call(cfg, `/api/requirements/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
  return assignmentsFromHub(data?.requirement);
}
