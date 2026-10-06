// 登录设备的 hub 调用:GET /api/auth/sessions、POST /api/auth/sessions/revoke-others、DELETE /api/auth/sessions/:id。
// 401 同样上报给账号状态(过期 → 重新登录),和轮询读一个口径。
import { appFetch } from './app-fetch';
import { authProfileId, type HubConfig } from './api';
import { interpretSessionsResponse, isTokenExpiredBody, type SessionsLoad } from './login-sessions';
import { reportProfileAuthResponse } from './profile-auth-state';

const TIMEOUT_MS = 12_000;

async function request(cfg: HubConfig, path: string, method: string): Promise<{ status: number; text: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await appFetch(`${cfg.serverUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (res.status === 401) {
      let body: unknown = null;
      try { body = JSON.parse(text); } catch { /* 非 JSON 的 401 = 普通失效 */ }
      reportProfileAuthResponse(401, authProfileId(cfg), isTokenExpiredBody(body) ? 'token_expired' : undefined, cfg.token);
    }
    return { status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchLoginSessions(cfg: HubConfig): Promise<SessionsLoad> {
  try {
    const { status, text } = await request(cfg, '/api/auth/sessions', 'GET');
    return interpretSessionsResponse(status, text);
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

function result(status: number, text: string): { ok: true; revoked?: number } | { ok: false; error: string } {
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = null; }
  if (status >= 200 && status < 300 && body?.ok === true) return { ok: true, ...(typeof body.revoked === 'number' ? { revoked: body.revoked } : {}) };
  return { ok: false, error: String(body?.message ?? body?.error ?? `HTTP ${status}`) };
}

export async function revokeLoginSession(cfg: HubConfig, tokenId: string) {
  const { status, text } = await request(cfg, `/api/auth/sessions/${encodeURIComponent(tokenId)}`, 'DELETE');
  return result(status, text);
}

export async function revokeOtherLoginSessions(cfg: HubConfig) {
  const { status, text } = await request(cfg, '/api/auth/sessions/revoke-others', 'POST');
  return result(status, text);
}
