// 登录设备(设置 → 账号 → 登录设备):hub 的登录会话列表、退出某台 / 退出其他所有设备、闲置过期。
// hub 侧见 agent-network 的 GET /api/auth/sessions(登录令牌闲置 30 天自动失效,过期令牌的 401 带
// error = "token_expired")。这里只放纯逻辑,不 import react-native,ck 测试直接跑。
import { t } from './i18n';
import './i18n-sessions';
import { parseHubTime } from './time';

export type LoginSession = {
  token_id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
  client_label: string | null;
  user_agent: string | null;
  is_current: boolean;
};

export type SessionsLoad =
  | { kind: 'ok'; sessions: LoginSession[]; idleDays: number | null }
  /** 旧 hub 没有这个接口:页面整个不出现。 */
  | { kind: 'unsupported' }
  | { kind: 'error'; message: string };

/**
 * 把 GET /api/auth/sessions 的响应解释成三种结果。
 * 🔴 旧 hub 不回 404:未知路径落到 hub 的纯文本帮助页,**HTTP 200 + text/plain**(0.9.0-preview.68 实测)。
 *    所以「支持」的判据是正文是 JSON、ok 为 true、sessions 是数组 —— 不是状态码。
 */
export function interpretSessionsResponse(status: number, text: string): SessionsLoad {
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (status === 404 || status === 405) return { kind: 'unsupported' };
  if (status >= 200 && status < 300) {
    if (body && body.ok === true && Array.isArray(body.sessions)) {
      const sessions = body.sessions.filter(isSession).map(normalizeSession);
      const idle = Number(body.idle_timeout_days);
      return { kind: 'ok', sessions, idleDays: Number.isFinite(idle) ? idle : null };
    }
    return { kind: 'unsupported' };
  }
  return { kind: 'error', message: String(body?.message ?? body?.error ?? `HTTP ${status}`) };
}

function isSession(x: any): boolean {
  return !!x && typeof x.token_id === 'string' && x.token_id.length > 0;
}

function normalizeSession(x: any): LoginSession {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  return {
    token_id: x.token_id,
    name: typeof x.name === 'string' ? x.name : '',
    created_at: typeof x.created_at === 'string' ? x.created_at : '',
    last_used_at: str(x.last_used_at),
    client_label: str(x.client_label),
    user_agent: str(x.user_agent),
    is_current: x.is_current === true,
  };
}

/** 401 的正文说的是「登录已过期」(hub 的闲置过期)而不是别的 401。 */
export function isTokenExpiredBody(body: unknown): boolean {
  return !!body && typeof body === 'object' && (body as { error?: unknown }).error === 'token_expired';
}

/** 本机排第一,其余按最近使用倒序(从没用过的按登录时间)。 */
export function orderSessions(list: readonly LoginSession[]): LoginSession[] {
  const at = (s: LoginSession) => parseHubTime(s.last_used_at ?? s.created_at)?.getTime() ?? 0;
  return [...list].sort((a, b) => Number(b.is_current) - Number(a.is_current) || at(b) - at(a));
}

export type DeviceKind = 'phone' | 'desktop' | 'browser' | 'terminal' | 'unknown';

/**
 * 这台设备是什么。优先用登录时 app 自报的 client_label(见 clientLabelForLogin);
 * 旧令牌 / 别的客户端只有 User-Agent,从里面认几种常见的;都没有 = 未知设备。
 */
export function describeDevice(s: Pick<LoginSession, 'client_label' | 'user_agent'>): { kind: DeviceKind; label: string } {
  const label = s.client_label?.trim();
  if (label) return { kind: kindFromLabel(label), label };
  const ua = s.user_agent ?? '';
  if (!ua) return { kind: 'unknown', label: t('sessions.device.unknown') };
  if (/okhttp/i.test(ua)) return { kind: 'phone', label: 'Android App' };
  if (/CFNetwork|Darwin\//i.test(ua)) return { kind: 'phone', label: 'iOS App' };
  if (/Mozilla\//.test(ua)) {
    const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iOS/i.test(ua) ? 'iOS' : /Mac OS X|Macintosh/i.test(ua) ? 'macOS' : /Windows/i.test(ua) ? 'Windows' : /Linux/i.test(ua) ? 'Linux' : '';
    const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
    const name = [browser || t('sessions.device.browser'), os].filter(Boolean).join(' · ');
    return { kind: /Android|iPhone|iPad|Mobile/i.test(ua) ? 'phone' : 'browser', label: name };
  }
  if (/^(node|undici|bun|curl|python|go-http|anet)/i.test(ua)) return { kind: 'terminal', label: t('sessions.device.cli') };
  return { kind: 'unknown', label: t('sessions.device.unknown') };
}

function kindFromLabel(label: string): DeviceKind {
  if (/^(Android|iOS)\b/i.test(label)) return 'phone';
  if (/^(macOS|Windows|Linux)\b/i.test(label)) return 'desktop';
  if (/^Web\b/i.test(label)) return 'browser';
  return 'unknown';
}

/**
 * app 登录时自报的设备名(写进 POST /api/auth/login 的 client_label,hub 原样存、原样回)。
 * 不翻译:它会被别的设备、别的语言看到。形如「Android · 0.2.155」「macOS · 0.2.155」「Web · 0.2.155」。
 */
export function clientLabelForLogin(env: { os: string; shell: 'mac' | 'windows' | 'other' | null; version: string }): string {
  const name = env.os === 'android' ? 'Android'
    : env.os === 'ios' ? 'iOS'
    : env.shell === 'mac' ? 'macOS'
    : env.shell === 'windows' ? 'Windows'
    : env.shell === 'other' ? 'Linux'
    : 'Web';
  return `${name} · ${env.version}`;
}

/** 「最近使用」的相对时间:刚刚 / N 分钟前 / N 小时前 / N 天前 / 日期。hub 时间是 UTC 的 SQLite 串。 */
export function lastUsedText(s: Pick<LoginSession, 'last_used_at' | 'created_at'>, nowMs: number = Date.now()): string {
  const d = parseHubTime(s.last_used_at ?? s.created_at);
  if (!d) return '';
  const min = Math.max(0, Math.floor((nowMs - d.getTime()) / 60000));
  if (min < 1) return t('sessions.time.now');
  if (min < 60) return t('sessions.time.minutes', { n: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t('sessions.time.hours', { n: h });
  const days = Math.floor(h / 24);
  if (days < 30) return t('sessions.time.days', { n: days });
  return t('sessions.time.date', { m: d.getMonth() + 1, d: d.getDate(), y: d.getFullYear() });
}

/** 一行的副标题:本机 → 「正在使用」(「本机」已经是右侧的值 / 徽标);其他 → 「最近使用 3 小时前」。 */
export function sessionSubtitle(s: LoginSession, nowMs: number = Date.now()): string {
  if (s.is_current) return t('sessions.thisDeviceActive');
  const when = lastUsedText(s, nowMs);
  return when ? t('sessions.lastUsed', { when }) : '';
}

/** 列表很长时(管理员账号上可能有几百条)先显示这么多,底下「显示全部 N 台」。 */
export const SESSIONS_VISIBLE_DEFAULT = 20;

export function visibleSessions(list: readonly LoginSession[], showAll: boolean): LoginSession[] {
  return showAll ? [...list] : list.slice(0, SESSIONS_VISIBLE_DEFAULT);
}

/** 「退出其他所有设备」的确认文案里说的台数。 */
export const otherSessionCount = (list: readonly LoginSession[]): number => list.filter(s => !s.is_current).length;

// ── 切换账号面板:验别的已保存账号(saved-session-probe.ts 接线,这里是可单测的流程) ──
export type ProbeProfile = { profileId: string; requiresReauth?: boolean };
export type ProbeDeps = {
  load: (profileId: string) => Promise<{ serverUrl: string; token: string } | null>;
  /** 用这个令牌打 GET /api/auth/me 的 HTTP 状态;请求本身失败返回 null。 */
  status: (cfg: { serverUrl: string; token: string }) => Promise<number | null>;
  mark: (profileId: string) => Promise<void>;
};

/**
 * 只认 401:网络错、5xx、超时说明不了令牌坏了,不标。当前账号、本地工作区(skip)和已经标过的不验。
 * 返回被新标成「需要重新登录」的账号 id。
 */
export async function probeSavedSessionsWith(profiles: readonly ProbeProfile[], skip: readonly (string | undefined)[], deps: ProbeDeps): Promise<string[]> {
  const candidates = profiles.filter(p => !skip.includes(p.profileId) && !p.requiresReauth);
  const marked: string[] = [];
  await Promise.all(candidates.map(async p => {
    try {
      const cfg = await deps.load(p.profileId);
      if (!cfg?.token) return;
      if ((await deps.status(cfg)) !== 401) return;
      await deps.mark(p.profileId);
      marked.push(p.profileId);
    } catch {
      /* 读不到凭据 / 标记失败:保持原样,点过去时照常走重新登录 */
    }
  }));
  return marked;
}
