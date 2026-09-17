// 0.2.76 通知设置(桌面端 localStorage,与 desktop-theme-storage 同一套存法):
// 消息提示音(默认开)、免打扰时段(默认关)。手机端/网页无 Tauri 时返回默认值、不落盘。

import { DEFAULT_QUIET_HOURS, parseClock, type QuietHours } from './quiet-hours';

export const NOTIFY_SETTINGS_KEY = 'notify_settings_v1';

export type NotifySettings = { soundEnabled: boolean; quiet: QuietHours };

export const DEFAULT_NOTIFY_SETTINGS: NotifySettings = { soundEnabled: true, quiet: DEFAULT_QUIET_HOURS };

const storage = (): Storage | null => {
  if (!(globalThis as any).__TAURI_INTERNALS__ || typeof localStorage === 'undefined') return null;
  return localStorage;
};

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
    };
  } catch {
    return DEFAULT_NOTIFY_SETTINGS;
  }
}

let cached: NotifySettings | null = null;
const listeners = new Set<() => void>();

export function loadNotifySettings(): NotifySettings {
  if (cached) return cached;
  const desktop = storage();
  cached = desktop ? parseNotifySettings(desktop.getItem(NOTIFY_SETTINGS_KEY)) : DEFAULT_NOTIFY_SETTINGS;
  return cached;
}

export function saveNotifySettings(next: NotifySettings): boolean {
  cached = next;
  for (const l of listeners) l();
  const desktop = storage();
  if (!desktop) return false;
  desktop.setItem(NOTIFY_SETTINGS_KEY, JSON.stringify(next));
  return true;
}

export function subscribeNotifySettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
