// 设置 → 账号:每一行的「复制」「编辑」(Vincent 2026-09-30「账号 支持一下复制 编辑」)。纯逻辑,可单测。
//
// 复制:一行字「Hub 地址 · 用户名 · 网络 ID」—— 🔴 只从账号元数据里取这三格,永远不碰令牌 / 密码
//       (入参类型就只收这三格,传进整个 HubConfig 也只读这三个字段)。
// 编辑:改显示名和 Hub 地址。地址变了先验:GET /health(服务器在不在)→ GET /api/auth/me 带着已存的令牌
//       (这台服务器认不认这个登录)。任何一步不过就不保存,说清楚是哪一步;令牌被拒时给「重新登录」。
import { normalizeServerUrl } from './login-flow';
import { LOCAL_HUB_PROFILE_ID } from './local-hub';
import type { HubProfile } from './storage';

export type AccountCopySource = Pick<HubProfile, 'serverUrl' | 'username' | 'networkId'>;

/** 「http://hub:9300 · demo-user · net_0123456789ab」;缺的格子不留空分隔符。 */
export function accountCopyText(profile: AccountCopySource): string {
  return [profile.serverUrl, profile.username, profile.networkId]
    .map(part => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' · ');
}

export type AccountRowAction = 'copy' | 'edit' | 'openWindow' | 'remove';

/**
 * 一行账号有哪些动作,按显示顺序。本地工作区的地址 / 端口由 app 自己管,只能复制(和开窗口);
 * 要重新登录的账号不能开窗口(开出来也是坏的),但照样能复制、编辑、移除。
 */
export function accountRowActions(profile: Pick<HubProfile, 'profileId' | 'requiresReauth'>, opts: { canOpenWindow: boolean }): AccountRowAction[] {
  const local = profile.profileId === LOCAL_HUB_PROFILE_ID;
  const out: AccountRowAction[] = ['copy'];
  if (!local) out.push('edit');
  if (opts.canOpenWindow && !profile.requiresReauth) out.push('openWindow');
  if (!local) out.push('remove');
  return out;
}

export type HubEditFailure = 'bad-url' | 'unreachable' | 'not-hub' | 'token-rejected' | 'other-user' | 'server-error';
export type HubEditCheck = { ok: true; serverUrl: string; changed: boolean } | { ok: false; kind: HubEditFailure; detail?: string };

/** 只要 status 和能不能读出 JSON —— 测试里直接喂假的。 */
export type EditFetch = (url: string, init: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ status: number; json: () => Promise<unknown> }>;

const sameUrl = (a: string, b: string) => a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase();

export const EDIT_PROBE_TIMEOUT_MS = 10_000;

/**
 * 保存前验新地址。地址没变 → 不发请求直接过(只改显示名)。
 * 顺序固定:地址格式 → /health → /api/auth/me(已存的令牌)→ 返回的用户名要和这个账号一致
 * (令牌在另一台服务器上碰巧有效、却是别人 —— 那不是「改地址」,是换了账号)。
 */
export async function validateHubEdit(
  input: { serverUrl: string; currentServerUrl: string; token: string; username?: string },
  fetchImpl: EditFetch,
  timeoutMs = EDIT_PROBE_TIMEOUT_MS,
): Promise<HubEditCheck> {
  const norm = normalizeServerUrl(input.serverUrl);
  if (!norm.ok) return { ok: false, kind: 'bad-url' };
  if (sameUrl(norm.url, input.currentServerUrl)) return { ok: true, serverUrl: input.currentServerUrl.replace(/\/+$/, ''), changed: false };

  const get = async (path: string, headers?: Record<string, string>) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetchImpl(`${norm.url}${path}`, { headers, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  let health;
  try { health = await get('/health'); } catch (error) { return { ok: false, kind: 'unreachable', detail: error instanceof Error ? error.message : String(error) }; }
  if (health.status < 200 || health.status >= 300) return { ok: false, kind: 'not-hub', detail: `HTTP ${health.status}` };

  let me;
  try { me = await get('/api/auth/me', { Authorization: `Bearer ${input.token}` }); } catch (error) { return { ok: false, kind: 'unreachable', detail: error instanceof Error ? error.message : String(error) }; }
  if (me.status === 401 || me.status === 403) return { ok: false, kind: 'token-rejected', detail: `HTTP ${me.status}` };
  if (me.status < 200 || me.status >= 300) return { ok: false, kind: 'server-error', detail: `HTTP ${me.status}` };
  let body: any;
  try { body = await me.json(); } catch { return { ok: false, kind: 'not-hub', detail: 'auth/me is not JSON' }; }
  const who = typeof body?.user?.username === 'string' ? body.user.username : typeof body?.username === 'string' ? body.username : undefined;
  if (!who) return { ok: false, kind: 'not-hub', detail: 'auth/me has no user' };
  if (input.username && who !== input.username) return { ok: false, kind: 'other-user', detail: who };
  return { ok: true, serverUrl: norm.url, changed: true };
}

/** 每种失败的文案 key(i18n-accounts.ts);「重新登录」只在令牌被拒时有意义。 */
export const HUB_EDIT_FAILURE_KEY: Record<HubEditFailure, string> = {
  'bad-url': 'accounts.editBadUrl',
  unreachable: 'accounts.editUnreachable',
  'not-hub': 'accounts.editNotHub',
  'token-rejected': 'accounts.editTokenRejected',
  'other-user': 'accounts.editOtherUser',
  'server-error': 'accounts.editServerError',
};
export const offersRelogin = (kind: HubEditFailure): boolean => kind === 'token-rejected';
