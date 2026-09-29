// 切换账号面板打开时,验一下别的已保存账号的令牌还能不能用(hub 的登录闲置过期 / 被「退出其他设备」踢掉)。
// 不能用的标成「需要重新登录」,面板里就显示出来 —— 而不是点过去才发现是坏的。
// 只认 401:网络错、5xx、超时都不算(那说明不了令牌坏了)。
import { appFetch } from './app-fetch';
import type { HubConfig } from './api';
import { LOCAL_HUB_PROFILE_ID } from './local-hub';
import { probeSavedSessionsWith, type ProbeProfile } from './login-sessions';
import { loadSavedProfileConfig, markHubProfileRequiresReauth } from './storage';

const PROBE_TIMEOUT_MS = 8_000;

async function authMeStatus(cfg: Pick<HubConfig, 'serverUrl' | 'token'>): Promise<number | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await appFetch(`${cfg.serverUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${cfg.token}` }, signal: ctrl.signal });
    return res.status;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 返回有没有账号被新标成需要重新登录(有就重新读账号列表)。 */
export async function probeSavedSessions(profiles: readonly ProbeProfile[], currentId: string | undefined): Promise<boolean> {
  const marked = await probeSavedSessionsWith(profiles, [currentId, LOCAL_HUB_PROFILE_ID], {
    load: loadSavedProfileConfig,
    status: authMeStatus,
    mark: id => markHubProfileRequiresReauth(id, true),
  });
  return marked.length > 0;
}
