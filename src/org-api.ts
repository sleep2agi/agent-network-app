// 组织架构(board #419)—— Hub REST。旧 Hub 没有 /departments(404)→ fetchOrg 回 null:整块不出现,与升级前一样。
import { appFetch } from './app-fetch';
import type { HubConfig } from './api';
import type { Department, OrgData } from './org-model';

const TIMEOUT_MS = 12_000;

export class OrgRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly detail?: Record<string, unknown>) { super(message); }
}

/** Hub 的错误码 → 一句人话(界面照这个说,不显示码)。 */
export function orgErrorText(code: string, detail?: Record<string, unknown>): string {
  switch (code) {
    case 'department_name_taken': return '同一上级下已经有同名部门';
    case 'invalid_department_name': return '部门名称 1–40 个字';
    case 'department_id_taken': return '这个部门 ID 已被占用';
    case 'invalid_department_id': return '部门 ID 只能用字母、数字、- 和 _(最多 64 个)';
    case 'parent_not_found': return '上级部门不存在了,刷新后再试';
    case 'department_cycle': return '不能移到自己或自己的下级部门下面';
    case 'department_too_deep': return '部门最多 10 层';
    case 'leader_not_member': return '负责人必须是本网络成员';
    case 'department_not_empty': return `部门里还有${detail?.children ? ` ${detail.children} 个子部门` : ''}${detail?.children && detail?.members ? '、' : ''}${detail?.members ? ` ${detail.members} 个成员` : ''},先移走再删除`;
    case 'department_not_found': return '这个部门已经不存在了';
    case 'member_not_found': return '这个人已不在本网络';
    case 'too_many_departments': return '部门数量已达上限(500)';
    case 'owner/admin required': return '只有网络所有者和管理员能修改组织架构';
    default: return '没有保存成功,请重试';
  }
}

async function call<T>(cfg: HubConfig, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await appFetch(`${cfg.serverUrl}${path}`, {
      method: init.method ?? 'GET',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* 按状态码说 */ }
    if (!res.ok || data?.ok === false) {
      const code = String(data?.error ?? `HTTP ${res.status}`);
      throw new OrgRequestError(orgErrorText(code, data ?? undefined), res.status, code, data ?? undefined);
    }
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

const net = (id: string) => encodeURIComponent(id);

/** null = 这个 Hub 还没有组织架构(旧 Hub)。 */
export async function fetchOrg(cfg: HubConfig, networkId: string): Promise<OrgData | null> {
  try {
    const d = await call<{ departments?: Department[]; members?: OrgData['members'] }>(cfg, `/api/networks/${net(networkId)}/departments`);
    return { departments: Array.isArray(d.departments) ? d.departments : [], members: Array.isArray(d.members) ? d.members : [] };
  } catch (e) {
    if (e instanceof OrgRequestError && (e.status === 404 || e.status === 405)) return null;
    throw e;
  }
}

export type DepartmentInput = { name: string; parent_id?: string | null; id?: string; leader_user_id?: string | null };
export const createDepartment = (cfg: HubConfig, networkId: string, input: DepartmentInput) =>
  call<{ department: Department }>(cfg, `/api/networks/${net(networkId)}/departments`, { method: 'POST', body: input }).then(d => d.department);
export const updateDepartment = (cfg: HubConfig, networkId: string, id: string, patch: Partial<Pick<Department, 'name' | 'parent_id' | 'leader_user_id' | 'sort'>>) =>
  call<{ department: Department }>(cfg, `/api/networks/${net(networkId)}/departments/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }).then(d => d.department);
export const deleteDepartment = (cfg: HubConfig, networkId: string, id: string) =>
  call<{ deleted: string }>(cfg, `/api/networks/${net(networkId)}/departments/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const setMemberDepartment = (cfg: HubConfig, networkId: string, userId: string, departmentId: string | null) =>
  call<{ department_id: string | null }>(cfg, `/api/networks/${net(networkId)}/members/${encodeURIComponent(userId)}/department`, { method: 'PUT', body: { department_id: departmentId } });
