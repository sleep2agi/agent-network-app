// POST /api/auth/password { old_password, new_password }(hub sleep2agi/agent-network server/src/server.ts)。
//
// 🔴 hub 改密码成功时做三件事(changePassword + 路由):
//   1. 删掉这个用户**其他所有**登录令牌(别的设备都会被退出);
//   2. 签一个新的用户令牌放在响应里 { ok, revoked, token, token_id };
//   3. 吊销**这次请求用的**令牌。
// 所以这台设备必须把存着的令牌换成响应里的新令牌,否则下一次请求就 401、被踢回登录页。
// 旧 hub 不回 token(也不吊销当前令牌)→ 照旧用原令牌。
import { appFetch } from './app-fetch';
import type { HubConfig } from './api';
import { classifyChangePasswordFailure, type ChangePasswordFailure } from './password-policy';

const TIMEOUT_MS = 15_000;

export type ChangePasswordResult =
  | { ok: true; token?: string; revoked?: number }
  | { ok: false; kind: ChangePasswordFailure; message: string };

export async function changeHubPassword(cfg: Pick<HubConfig, 'serverUrl' | 'token'>, oldPassword: string, newPassword: string): Promise<ChangePasswordResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let status: number;
  let text: string;
  try {
    const res = await appFetch(`${cfg.serverUrl}/api/auth/password`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
      signal: ctrl.signal,
    });
    status = res.status;
    text = await res.text();
  } catch (e) {
    return { ok: false, kind: 'network', message: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = null; }
  if (status >= 200 && status < 300 && body?.ok === true) {
    return {
      ok: true,
      ...(typeof body.token === 'string' && body.token ? { token: body.token } : {}),
      ...(typeof body.revoked === 'number' ? { revoked: body.revoked } : {}),
    };
  }
  const message = String(body?.error ?? body?.message ?? `HTTP ${status}`);
  return { ok: false, kind: classifyChangePasswordFailure({ network: false, status, error: body?.error ?? null }), message };
}
