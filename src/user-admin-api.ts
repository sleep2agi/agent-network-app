// 多用户账号与 Agent 权限 —— Hub REST 调用(agent-network#2084)。
// 只调这几条:auth/me、networks/:id/members(列表 / 改角色 / 移出)、admin/users、members/:uid/agent-grants、auth/register。
import { appFetch } from './app-fetch';
import type { HubConfig } from './api';
import type { AgentGrant, AuthMe, GroupGrant, HubAgentGroup, MemberRole, NetworkMember } from './user-admin';

const TIMEOUT_MS = 12_000;

export class HubRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function call<T>(serverUrl: string, token: string | null, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await appFetch(`${serverUrl}${path}`, {
      method: init.method ?? 'GET',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* 下面按 HTTP 状态报 */ }
    if (!res.ok || data?.ok === false) throw new HubRequestError(String(data?.error ?? data?.message ?? `HTTP ${res.status}`), res.status);
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

const net = (id: string) => encodeURIComponent(id);

/**
 * GET /api/auth/me, shared. Chat list, every chat, the 任务 board, settings and the send / rules
 * paths each asked the hub "who am I" on their own — the same answer, one trans-Pacific round
 * trip each (0.22 s, 0.72 s on a fresh desktop connection). One in-flight request per hub +
 * token is shared, and a success is reused for AUTH_ME_TTL_MS. Failures are never cached: the
 * next caller asks again (ChatScreen retries with backoff on purpose).
 */
export const AUTH_ME_TTL_MS = 60_000;
const authMeCache = new Map<string, { at: number; pending: Promise<AuthMe> }>();
export const fetchAuthMe = (cfg: Pick<HubConfig, 'serverUrl' | 'token'>): Promise<AuthMe> => {
  const key = `${cfg.serverUrl}\u0000${cfg.token}`;
  const hit = authMeCache.get(key);
  if (hit && Date.now() - hit.at < AUTH_ME_TTL_MS) return hit.pending;
  const entry = { at: Date.now(), pending: call<AuthMe>(cfg.serverUrl, cfg.token, '/api/auth/me') };
  authMeCache.set(key, entry);
  // A settled success keeps its slot for the TTL (counted from when it landed); a failure frees it.
  entry.pending.then(() => { entry.at = Date.now(); }, () => { if (authMeCache.get(key) === entry) authMeCache.delete(key); });
  return entry.pending;
};
/** Drop the shared /api/auth/me answers (test hook; also safe after a role change). */
export const forgetAuthMe = (): void => { authMeCache.clear(); };
/** #552 —— 只丢这一个 hub + 令牌的「我是谁」(发送回 404/400/403 网络类错误后要重新判网络,不能读 60 s 内的旧答案)。 */
export const forgetAuthMeFor = (cfg: Pick<HubConfig, 'serverUrl' | 'token'>): void => { authMeCache.delete(`${cfg.serverUrl}\u0000${cfg.token}`); };

export const fetchNetworkMembers = (cfg: HubConfig, networkId: string) =>
  call<{ members: NetworkMember[] }>(cfg.serverUrl, cfg.token, `/api/networks/${net(networkId)}/members`).then(d => d.members ?? []);

export const createHubUser = (cfg: HubConfig, body: { username: string; password: string; display_name?: string; network_id: string; role: MemberRole }) =>
  call<{ user: { user_id: string; username: string }; membership: unknown }>(cfg.serverUrl, cfg.token, '/api/admin/users', { method: 'POST', body });

export const fetchAgentGrants = (cfg: HubConfig, networkId: string, userId: string) =>
  call<{ agent_access: 'all' | 'granted' | null; grants: AgentGrant[]; group_grants?: GroupGrant[] }>(cfg.serverUrl, cfg.token, `/api/networks/${net(networkId)}/members/${net(userId)}/agent-grants`);

export const saveAgentGrants = (cfg: HubConfig, networkId: string, userId: string, body: { agent_access: 'all' | 'granted'; grants: Array<{ node_id?: string; alias?: string; can_message: boolean }>; group_grants?: Array<{ group_id: string; can_message: boolean }> }) =>
  call<{ agent_access: 'all' | 'granted'; grants: AgentGrant[] }>(cfg.serverUrl, cfg.token, `/api/networks/${net(networkId)}/members/${net(userId)}/agent-grants`, { method: 'PUT', body });

/** POST /api/auth/register(公开)。成功返回用户令牌,调用方按登录同一条路径继续。 */
export const registerHubAccount = (serverUrl: string, body: { username: string; password: string; display_name?: string; client_label?: string }) =>
  call<{ token?: string; user?: { username?: string } }>(serverUrl, null, '/api/auth/register', { method: 'POST', body });

/** GET /api/networks —— Hub 管理员拿到全部网络(新建用户时选网络用)。 */
export const fetchNetworks = (cfg: HubConfig) =>
  call<{ networks: Array<{ network_id: string; network_name?: string | null; name?: string | null }> }>(cfg.serverUrl, cfg.token, '/api/networks').then(d => d.networks ?? []);

/** PUT /api/networks/:id/members/:uid {role} —— hub 只认网络 owner。 */
export const updateMemberRole = (cfg: HubConfig, networkId: string, userId: string, role: MemberRole) =>
  call<{ ok: true }>(cfg.serverUrl, cfg.token, `/api/networks/${net(networkId)}/members/${net(userId)}`, { method: 'PUT', body: { role } });

/** DELETE /api/networks/:id/members/:uid —— 网络 owner / admin;hub 同时清掉授权、断开此人的实时流。 */
export const removeNetworkMember = (cfg: HubConfig, networkId: string, userId: string) =>
  call<{ ok: true }>(cfg.serverUrl, cfg.token, `/api/networks/${net(networkId)}/members/${net(userId)}`, { method: 'DELETE' });

// —— Agent 分组(RFC-038 §8)。旧 Hub 没有这些路由:列表返回 404 ⇒ null,调用方整块隐藏。 ——
const groups = (networkId: string) => `/api/networks/${net(networkId)}/agent-groups`;

export const fetchAgentGroups = (cfg: HubConfig, networkId: string): Promise<HubAgentGroup[] | null> =>
  call<{ groups: HubAgentGroup[] }>(cfg.serverUrl, cfg.token, groups(networkId))
    .then(d => d.groups ?? [])
    .catch(e => { if (e instanceof HubRequestError && (e.status === 404 || e.status === 405)) return null; throw e; });

export const createAgentGroup = (cfg: HubConfig, networkId: string, body: { name: string; node_ids: string[] }) =>
  call<{ group: HubAgentGroup }>(cfg.serverUrl, cfg.token, groups(networkId), { method: 'POST', body });

export const renameAgentGroup = (cfg: HubConfig, networkId: string, groupId: string, name: string) =>
  call<{ group: HubAgentGroup }>(cfg.serverUrl, cfg.token, `${groups(networkId)}/${net(groupId)}`, { method: 'PATCH', body: { name } });

export const saveAgentGroupMembers = (cfg: HubConfig, networkId: string, groupId: string, nodeIds: string[]) =>
  call<{ group: HubAgentGroup; added: string[]; removed: string[] }>(cfg.serverUrl, cfg.token, `${groups(networkId)}/${net(groupId)}/members`, { method: 'PUT', body: { node_ids: nodeIds } });

export const deleteAgentGroup = (cfg: HubConfig, networkId: string, groupId: string) =>
  call<{ affected_user_ids: string[] }>(cfg.serverUrl, cfg.token, `${groups(networkId)}/${net(groupId)}`, { method: 'DELETE' });

// —— 任务(需求卡)的人员权限(hub RFC-038 §9,agent-network#2163)。旧 Hub 没有这条路由:404 ⇒ null,调用方整块隐藏。 ——
export type TaskGrantsResponse = { task_access: 'all' | 'scoped'; restricted?: boolean; project_grants: Array<{ project_id: string; can_edit: boolean }> };
export const fetchTaskGrants = (cfg: HubConfig, networkId: string, userId: string): Promise<TaskGrantsResponse | null> =>
  call<TaskGrantsResponse>(cfg.serverUrl, cfg.token, `/api/networks/${net(networkId)}/members/${net(userId)}/task-grants`)
    .catch(e => { if (e instanceof HubRequestError && (e.status === 404 || e.status === 405) && e.message !== 'member_not_found') return null; throw e; });

export const saveTaskGrants = (cfg: HubConfig, networkId: string, userId: string, body: { task_access: 'all' | 'scoped'; project_grants: Array<{ project_id: string; can_edit: boolean }> }) =>
  call<TaskGrantsResponse>(cfg.serverUrl, cfg.token, `/api/networks/${net(networkId)}/members/${net(userId)}/task-grants`, { method: 'PUT', body });
