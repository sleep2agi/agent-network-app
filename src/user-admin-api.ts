// 多用户账号与 Agent 权限 —— Hub REST 调用(agent-network#2084)。
// 只调这几条:auth/me、networks/:id/members、admin/users、members/:uid/agent-grants、auth/register。
import { appFetch } from './app-fetch';
import type { HubConfig } from './api';
import type { AgentGrant, AuthMe, MemberRole, NetworkMember } from './user-admin';

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

export const fetchAuthMe = (cfg: HubConfig) => call<AuthMe>(cfg.serverUrl, cfg.token, '/api/auth/me');

export const fetchNetworkMembers = (cfg: HubConfig, networkId: string) =>
  call<{ members: NetworkMember[] }>(cfg.serverUrl, cfg.token, `/api/networks/${net(networkId)}/members`).then(d => d.members ?? []);

export const createHubUser = (cfg: HubConfig, body: { username: string; password: string; display_name?: string; network_id: string; role: MemberRole }) =>
  call<{ user: { user_id: string; username: string }; membership: unknown }>(cfg.serverUrl, cfg.token, '/api/admin/users', { method: 'POST', body });

export const fetchAgentGrants = (cfg: HubConfig, networkId: string, userId: string) =>
  call<{ agent_access: 'all' | 'granted' | null; grants: AgentGrant[] }>(cfg.serverUrl, cfg.token, `/api/networks/${net(networkId)}/members/${net(userId)}/agent-grants`);

export const saveAgentGrants = (cfg: HubConfig, networkId: string, userId: string, body: { grants: Array<{ node_id?: string; alias?: string; can_message: boolean }> }) =>
  call<{ agent_access: 'all' | 'granted'; grants: AgentGrant[] }>(cfg.serverUrl, cfg.token, `/api/networks/${net(networkId)}/members/${net(userId)}/agent-grants`, { method: 'PUT', body });

/** POST /api/auth/register(公开)。成功返回用户令牌,调用方按登录同一条路径继续。 */
export const registerHubAccount = (serverUrl: string, body: { username: string; password: string; display_name?: string }) =>
  call<{ token?: string; user?: { username?: string } }>(serverUrl, null, '/api/auth/register', { method: 'POST', body });

/** GET /api/networks —— Hub 管理员拿到全部网络(新建用户时选网络用)。 */
export const fetchNetworks = (cfg: HubConfig) =>
  call<{ networks: Array<{ network_id: string; network_name?: string | null; name?: string | null }> }>(cfg.serverUrl, cfg.token, '/api/networks').then(d => d.networks ?? []);
