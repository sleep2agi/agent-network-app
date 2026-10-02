// 部门群 / 群聊的 Hub 调用(RFC-042,agent-network #2280/#2281/#2282)。
// 功能门(group-chat.ts 顶部):旧 Hub 没有这些接口 → probeGroupSupport 回 false,界面整块不画,不报错。
import { appFetch } from './app-fetch';
import type { HubConfig } from './api';
import type { DmThread } from './human-dm';
import { groupErrorText, groupThreadsOf, type ChatGroup, type ChatGroupMember, type GroupMessage, type GroupThread } from './group-chat';

const TIMEOUT_MS = 12_000;

export class GroupRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); }
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
    try { data = text ? JSON.parse(text) : null; } catch { /* 按 HTTP 状态说 */ }
    if (!res.ok || data?.ok === false) {
      const code = String(data?.error ?? `HTTP ${res.status}`);
      throw new GroupRequestError(groupErrorText(code), res.status, code);
    }
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

const net = (id: string) => encodeURIComponent(id);
const gpath = (networkId: string, groupId: string) => `/api/networks/${net(networkId)}/chat-groups/${encodeURIComponent(groupId)}`;

// ── 功能门 ──
// 每个 (Hub, 网络) 只探一次:GET …/chat-groups 2xx ⇒ 有群。会话列表那边从 /api/dm/threads 看到 group_threads 也记一笔。
const support = new Map<string, Promise<boolean>>();
const supportKey = (cfg: HubConfig, networkId: string) => `${cfg.serverUrl}\u0000${networkId}`;

export function noteGroupSupport(cfg: HubConfig, networkId: string, supported: boolean): void {
  support.set(supportKey(cfg, networkId), Promise.resolve(supported));
}

/** 这个 Hub 有没有群接口。任何失败(404 / 405 / 403 / 断网)都算「没有」并且不缓存失败以外的结论 —— 下次再探。 */
export function probeGroupSupport(cfg: HubConfig, networkId: string): Promise<boolean> {
  const key = supportKey(cfg, networkId);
  const hit = support.get(key);
  if (hit) return hit;
  const p = call<{ groups?: unknown }>(cfg, `/api/networks/${net(networkId)}/chat-groups`)
    .then(d => Array.isArray(d?.groups))
    .catch((e: unknown) => {
      // 404 / 405 = 旧 Hub,确定没有 → 记住;别的失败(超时 / 5xx)不记,下次重探。
      if (!(e instanceof GroupRequestError && (e.status === 404 || e.status === 405))) support.delete(key);
      return false;
    });
  support.set(key, p);
  return p;
}

/** 只给测试用:清掉探测缓存。 */
export function resetGroupSupportForTest(): void { support.clear(); }

// ── 会话列表 ──

/** /api/dm/threads 一次拿私信和群。groupThreads = null ⇒ 这个 Hub 没有群(不画)。 */
export async function fetchConversationThreads(cfg: HubConfig, networkId: string): Promise<{ threads: DmThread[]; groupThreads: GroupThread[] | null }> {
  const d = await call<{ threads?: DmThread[] }>(cfg, `/api/dm/threads?network_id=${net(networkId)}`);
  const groupThreads = groupThreadsOf(d);
  if (groupThreads) noteGroupSupport(cfg, networkId, true);
  return { threads: Array.isArray(d?.threads) ? d.threads : [], groupThreads };
}

// ── 群聊 ──

export const fetchGroupMessages = (cfg: HubConfig, networkId: string, groupId: string, before?: number, limit = 50) =>
  call<{ messages?: GroupMessage[]; next_before?: number | null; unread?: number }>(cfg, `${gpath(networkId, groupId)}/messages?limit=${limit}${before ? `&before=${before}` : ''}`)
    .then(d => ({ messages: Array.isArray(d.messages) ? d.messages : [], nextBefore: d.next_before ?? null, unread: Number(d.unread ?? 0) || 0 }));

export const sendGroupMessage = (cfg: HubConfig, networkId: string, groupId: string, body: unknown) =>
  call<{ message: GroupMessage; duplicate?: boolean; delivered_to?: number }>(cfg, `${gpath(networkId, groupId)}/messages`, { method: 'POST', body });

export const markGroupRead = (cfg: HubConfig, networkId: string, groupId: string, seq?: number) =>
  call<{ last_read_seq: number; unread: number }>(cfg, `${gpath(networkId, groupId)}/read`, { method: 'POST', body: seq === undefined ? {} : { seq } });

// ── 群资料 / 部门群 ──

export type GroupDetail = { group: ChatGroup; members: ChatGroupMember[]; is_member?: boolean };

export const fetchGroup = (cfg: HubConfig, networkId: string, groupId: string) =>
  call<GroupDetail>(cfg, gpath(networkId, groupId)).then(d => ({ group: d.group, members: Array.isArray(d.members) ? d.members : [], is_member: d.is_member }));

/** 部门挂着的群。没有(或我看不见)→ null。 */
export async function fetchDepartmentGroup(cfg: HubConfig, networkId: string, departmentId: string): Promise<GroupDetail | null> {
  try {
    const d = await call<GroupDetail>(cfg, `/api/networks/${net(networkId)}/departments/${encodeURIComponent(departmentId)}/group`);
    return { group: d.group, members: Array.isArray(d.members) ? d.members : [], is_member: d.is_member };
  } catch (e) {
    if (e instanceof GroupRequestError && e.status === 404) return null;
    throw e;
  }
}

export const createDepartmentGroup = (cfg: HubConfig, networkId: string, departmentId: string, name?: string) =>
  call<GroupDetail>(cfg, `/api/networks/${net(networkId)}/departments/${encodeURIComponent(departmentId)}/group`, { method: 'POST', body: name ? { name } : {} });

export const renameGroup = (cfg: HubConfig, networkId: string, groupId: string, name: string) =>
  call<{ group: ChatGroup }>(cfg, gpath(networkId, groupId), { method: 'PATCH', body: { name } }).then(d => d.group);

export const addGroupMember = (cfg: HubConfig, networkId: string, groupId: string, userId: string) =>
  call<{ member: ChatGroupMember }>(cfg, `${gpath(networkId, groupId)}/members`, { method: 'POST', body: { user_id: userId } }).then(d => d.member);

export const removeGroupMember = (cfg: HubConfig, networkId: string, groupId: string, userId: string) =>
  call<{ removed: string }>(cfg, `${gpath(networkId, groupId)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' });
