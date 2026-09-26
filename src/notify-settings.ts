// 0.2.76 通知设置(桌面端 localStorage,与 desktop-theme-storage 同一套存法):
// 消息提示音(默认开)、免打扰时段(默认关)。
//
// 0.2.107 安卓通知(Vincent:小米折叠屏,没有 Google 服务,想在手机上收到 agent 的消息):
//   · enabled     总开关(默认开 —— 桌面端此前一直是「开」,默认值不能把桌面端关掉);
//   · mode        'all' = 每条消息都响铃/横幅;'new' = 仅新消息 —— 某个 agent 已经有一条没看的
//                 通知时,后来的消息只更新那条通知的计数和预览,不再响铃(见 mobile-notify-model);
//   · mutedByProfile  按账号记的「消息免打扰」agent 列表(不同 hub 上可能有同名 alias);
//   · keepAlive   「后台保持连接」—— 安卓前台服务,默认关(见 keep-alive.ts);
//   · permissionPrompted  登录后是否已经弹过一次系统通知权限(只弹一次,之后从设置里开)。
//
// 存法:桌面壳 = localStorage(同步,和以前一样);手机 = documentDirectory 下一个 JSON 文件,
// 由 notify-settings-native.ts 异步读进来(hydrateNotifySettings)并注册写手;
// 不是桌面壳的网页 = 只在内存里。本模块不 import react-native / expo,bun 测试能直接跑。

import { DEFAULT_QUIET_HOURS, parseClock, type QuietHours } from './quiet-hours';

export const NOTIFY_SETTINGS_KEY = 'notify_settings_v1';

export type NotifyMode = 'all' | 'new';

export type NotifySettings = {
  soundEnabled: boolean;
  quiet: QuietHours;
  enabled: boolean;
  mode: NotifyMode;
  mutedByProfile: Readonly<Record<string, readonly string[]>>;
  keepAlive: boolean;
  permissionPrompted: boolean;
};

export const DEFAULT_NOTIFY_SETTINGS: NotifySettings = {
  soundEnabled: true,
  quiet: DEFAULT_QUIET_HOURS,
  enabled: true,
  mode: 'all',
  mutedByProfile: {},
  keepAlive: false,
  permissionPrompted: false,
};

const desktopStorage = (): Storage | null => {
  if (!(globalThis as any).__TAURI_INTERNALS__ || typeof localStorage === 'undefined') return null;
  return localStorage;
};

function parseMuted(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [profile, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!profile || !Array.isArray(list)) continue;
    const aliases = [...new Set(list.filter((a): a is string => typeof a === 'string' && a.trim() !== '').map(a => a.trim()))];
    if (aliases.length) out[profile] = aliases;
  }
  return out;
}

export function parseNotifySettings(raw: string | null | undefined): NotifySettings {
  if (!raw) return DEFAULT_NOTIFY_SETTINGS;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_NOTIFY_SETTINGS;
    const q = (parsed as any).quiet ?? {};
    const start = typeof q.start === 'string' && parseClock(q.start) !== null ? q.start : DEFAULT_QUIET_HOURS.start;
    const end = typeof q.end === 'string' && parseClock(q.end) !== null ? q.end : DEFAULT_QUIET_HOURS.end;
    return {
      soundEnabled: (parsed as any).soundEnabled !== false,
      quiet: { enabled: q.enabled === true, start, end },
      // 旧版(0.2.76–0.2.106)存的对象没有这几个键 → 缺省值;尤其 enabled 缺省为开。
      enabled: (parsed as any).enabled !== false,
      mode: (parsed as any).mode === 'new' ? 'new' : 'all',
      mutedByProfile: parseMuted((parsed as any).mutedByProfile),
      keepAlive: (parsed as any).keepAlive === true,
      permissionPrompted: (parsed as any).permissionPrompted === true,
    };
  } catch {
    return DEFAULT_NOTIFY_SETTINGS;
  }
}

export function serializeNotifySettings(s: NotifySettings): string {
  return JSON.stringify(s);
}

/** 账号键:同一台手机可以登多个 hub,免打扰列表按它分。 */
export function notifyProfileKey(cfg: { profileId?: string; serverUrl?: string; username?: string } | null | undefined): string {
  if (!cfg) return '';
  if (cfg.profileId) return cfg.profileId;
  return `${cfg.serverUrl ?? ''}|${cfg.username ?? ''}`;
}

export function mutedAgents(s: NotifySettings, profileKey: string): readonly string[] {
  return s.mutedByProfile[profileKey] ?? [];
}

export function isAgentMuted(s: NotifySettings, profileKey: string, alias: string): boolean {
  return mutedAgents(s, profileKey).includes(alias);
}

/** 切换某个 agent 的免打扰;返回新对象(不改入参)。 */
export function toggleAgentMuted(s: NotifySettings, profileKey: string, alias: string): NotifySettings {
  const name = alias.trim();
  if (!name) return s;
  const current = mutedAgents(s, profileKey);
  const next = current.includes(name) ? current.filter(a => a !== name) : [...current, name];
  const mutedByProfile: Record<string, readonly string[]> = { ...s.mutedByProfile };
  if (next.length) mutedByProfile[profileKey] = next; else delete mutedByProfile[profileKey];
  return { ...s, mutedByProfile };
}

let cached: NotifySettings | null = null;
let hydrated = false;
let nativeWriter: ((json: string) => void) | null = null;
const listeners = new Set<() => void>();

function emit() { for (const l of listeners) l(); }

export function loadNotifySettings(): NotifySettings {
  if (cached) return cached;
  const desktop = desktopStorage();
  cached = desktop ? parseNotifySettings(desktop.getItem(NOTIFY_SETTINGS_KEY)) : DEFAULT_NOTIFY_SETTINGS;
  if (desktop) hydrated = true;
  return cached;
}

/**
 * 手机端:把文件里读到的原文交进来(notify-settings-native.ts 调),并登记写手。
 * 之后的 saveNotifySettings 都会经写手落盘。hydrate 之前 loadNotifySettings 返回默认值。
 */
export function hydrateNotifySettings(raw: string | null, writer: ((json: string) => void) | null): NotifySettings {
  nativeWriter = writer;
  // hydrate 期间(文件还没读回来)用户已经改过一次 → 以用户那次为准,不被旧文件覆盖。
  if (!hydrated) cached = parseNotifySettings(raw);
  else if (writer && cached) { try { writer(serializeNotifySettings(cached)); } catch { /* session only */ } }
  hydrated = true;
  emit();
  return cached!;
}

export function notifySettingsHydrated(): boolean {
  loadNotifySettings();
  return hydrated;
}

export function saveNotifySettings(next: NotifySettings): boolean {
  cached = next;
  hydrated = true;
  emit();
  const desktop = desktopStorage();
  if (desktop) {
    desktop.setItem(NOTIFY_SETTINGS_KEY, serializeNotifySettings(next));
    return true;
  }
  if (nativeWriter) {
    try { nativeWriter(serializeNotifySettings(next)); return true; } catch { return false; }
  }
  return false;
}

export function subscribeNotifySettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 测试用:清掉模块缓存。 */
export function resetNotifySettingsForTest(): void {
  cached = null;
  hydrated = false;
  nativeWriter = null;
}
