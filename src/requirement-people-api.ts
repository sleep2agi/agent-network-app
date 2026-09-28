import { appFetch } from './app-fetch';
import type { HubConfig } from './api';
import { uniquePeople, type RequirementPerson, type RequirementPersonRef } from './requirement-people';

// Proposed contract for the next Hub increment. The editor requires explicit
// owner/participants fields; keep this increment draft until real Hub verification.
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
    ...init, headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
  });
  if (response.status === 404 || response.status === 501) throw new RequirementPeopleError('Hub 不支持此操作，或需求已不存在；请刷新并检查 Hub 版本', response.status);
  if (response.status === 403) throw new RequirementPeopleError('你没有修改人员绑定的权限', 403);
  if (!response.ok) throw new RequirementPeopleError('人员信息未保存，请重试', response.status);
  return response.json();
}

export async function listRequirementPeople(cfg: HubConfig): Promise<RequirementPerson[]> {
  const data = await call(cfg, '/api/requirements/people');
  if (!data || !Array.isArray(data.people)) throw new RequirementPeopleError('Hub 未返回可选成员', 502);
  return data.people.map((value: unknown) => {
    const ref = reference(value);
    const row = value as Record<string, unknown>;
    if (typeof row.networkId !== 'string' || row.networkId !== cfg.networkId || typeof row.name !== 'string' || (row.unavailable !== undefined && typeof row.unavailable !== 'boolean')) throw new RequirementPeopleError('Hub 返回了不属于当前网络的成员或无效数据', 502);
    return { ...ref, networkId: row.networkId, name: row.name, unavailable: row.unavailable === true };
  });
}

export async function saveRequirementAssignments(cfg: HubConfig, id: string, assignments: RequirementAssignments): Promise<RequirementAssignments> {
  const payload = assignmentsFromHub(assignments);
  const data = await call(cfg, `/api/requirements/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
  return assignmentsFromHub(data?.requirement);
}
