import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import { HubConfig, Session } from './api';
import { loadDesktopThemeMode, saveDesktopThemeMode } from './desktop-theme-storage';
export { onDesktopThemeStorageChange } from './desktop-theme-storage';

// Token + server persist in the platform keystore (Android Keystore /
// iOS Keychain) so login survives app restarts. Vincent tg 683 known
// gap: v0.1.1 lost the session on kill — this closes it.

const KEY = 'hub_config_v1';

const isTauriDesktop = (): boolean =>
  typeof globalThis !== 'undefined' && !!(globalThis as any).__TAURI_INTERNALS__;

const parseConfig = (raw: string | null): HubConfig | null => {
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  return typeof parsed?.serverUrl === 'string' && typeof parsed?.token === 'string'
    ? parsed as HubConfig
    : null;
};

export const saveConfig = async (cfg: HubConfig): Promise<void> => {
  if (isTauriDesktop()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('save_desktop_session', { sessionJson: JSON.stringify(cfg) });
    return;
  }
  await SecureStore.setItemAsync(KEY, JSON.stringify(cfg));
};

export const loadConfig = async (): Promise<HubConfig | null> => {
  if (isTauriDesktop()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return parseConfig(await invoke<string | null>('load_desktop_session'));
  }
  try {
    return parseConfig(await SecureStore.getItemAsync(KEY));
  } catch {
    return null;
  }
};

export const clearConfig = async (): Promise<void> => {
  if (isTauriDesktop()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('clear_desktop_session');
    return;
  }
  await SecureStore.deleteItemAsync(KEY);
};

const THEME_KEY = 'theme_mode_v1';

export const saveThemeMode = async (mode: string): Promise<void> => {
  try {
    if (saveDesktopThemeMode(mode)) return;
    await SecureStore.setItemAsync(THEME_KEY, mode);
  } catch {
    /* theme preference is best-effort */
  }
};

export const loadThemeMode = async (): Promise<string | null> => {
  try {
    const desktop = loadDesktopThemeMode();
    if (desktop !== undefined) return desktop;
    return await SecureStore.getItemAsync(THEME_KEY);
  } catch {
    return null;
  }
};

// Stale-while-revalidate cache for the agents list (perf: cold-start load
// time). Cold start used to show a blank spinner until the first /api/status
// round-trip returned — slow on flaky cellular. Persisting the last list lets
// AgentsScreen paint from disk instantly while the live fetch refreshes in the
// background. SecureStore is unsuitable: its values are size-capped on Android
// (~2KB) and a 150-agent list overflows it, so use the file system instead.
// All operations are best-effort — a cache miss/error never blocks the live
// data path.
const SESSIONS_CACHE = `${FileSystem.cacheDirectory}sessions_cache_v1.json`;

export const saveSessionsCache = async (sessions: Session[]): Promise<void> => {
  try {
    await FileSystem.writeAsStringAsync(SESSIONS_CACHE, JSON.stringify(sessions));
  } catch {
    /* best-effort — never fail the live path on a cache write */
  }
};

export const loadSessionsCache = async (): Promise<Session[] | null> => {
  try {
    const info = await FileSystem.getInfoAsync(SESSIONS_CACHE);
    if (!info.exists) return null;
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(SESSIONS_CACHE));
    return Array.isArray(parsed) ? (parsed as Session[]) : null;
  } catch {
    return null;
  }
};

// R2 avatar: per-device local echo of user-set avatars (alias → avatar_url).
// For session-only aliases (no hub nodes row) this is the ONLY store, so it must
// PERSIST across app kills → documentDirectory (not the evictable cache dir).
// For node-backed aliases it's just an echo (hub is authoritative). Best-effort;
// a small JSON map (only explicitly-customized aliases) so no SecureStore 2KB cap.
const AVATAR_LOCAL = `${FileSystem.documentDirectory}avatar_local_v1.json`;

export const saveLocalAvatars = async (map: Record<string, string>): Promise<void> => {
  try {
    await FileSystem.writeAsStringAsync(AVATAR_LOCAL, JSON.stringify(map));
  } catch {
    /* best-effort — never fail the UI on a preference write */
  }
};

export const loadLocalAvatars = async (): Promise<Record<string, string>> => {
  try {
    const info = await FileSystem.getInfoAsync(AVATAR_LOCAL);
    if (!info.exists) return {};
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(AVATAR_LOCAL));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

// PR3 判据C:未送达消息 outbox(src/outbox.ts)的落盘。documentDirectory(持久·
// 非可清缓存目录)——判据是「杀掉 app 再开它还在」,放 cacheDirectory 就输在判据上。
import type { OutboxEntry } from './outbox';
const OUTBOX_FILE = `${FileSystem.documentDirectory}outbox_v1.json`;

export const saveOutbox = async (all: OutboxEntry[]): Promise<void> => {
  try {
    await FileSystem.writeAsStringAsync(OUTBOX_FILE, JSON.stringify(all));
  } catch {
    /* best-effort — 落盘失败不阻塞发送 UI;下次 flush 再试 */
  }
};

export const loadOutbox = async (): Promise<OutboxEntry[]> => {
  try {
    const info = await FileSystem.getInfoAsync(OUTBOX_FILE);
    if (!info.exists) return [];
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(OUTBOX_FILE));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};
