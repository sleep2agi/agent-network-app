import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import { HubConfig, Session } from './api';
import { loadDesktopThemeMode, saveDesktopThemeMode } from './desktop-theme-storage';
export { onDesktopThemeStorageChange } from './desktop-theme-storage';

// Token + server persist in the platform keystore (Android Keystore /
// iOS Keychain) so login survives app restarts. Vincent tg 683 known
// gap: v0.1.1 lost the session on kill — this closes it.

const KEY = 'hub_config_v1';

export interface HubProfile {
  profileId: string;
  serverUrl: string;
  username: string;
  networkId?: string;
  displayName?: string;
  createdAt: number;
  updatedAt: number;
}

export interface HubProfileRegistry {
  schema_version: number;
  active_profile_id?: string | null;
  profiles: HubProfile[];
}

const isTauriDesktop = (): boolean =>
  typeof globalThis !== 'undefined' && !!(globalThis as any).__TAURI_INTERNALS__;

const writeDesktopProfileJson = async (profileId: string | undefined, relativePath: string, value: unknown): Promise<boolean> => {
  if (!profileId || !isTauriDesktop()) return false;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('write_desktop_profile_file', { profileId, relativePath, contents: JSON.stringify(value) });
  return true;
};

const readDesktopProfileJson = async <T>(profileId: string | undefined, relativePath: string): Promise<T | undefined> => {
  if (!profileId || !isTauriDesktop()) return undefined;
  const { invoke } = await import('@tauri-apps/api/core');
  const raw = await invoke<string | null>('read_desktop_profile_file', { profileId, relativePath });
  return raw ? JSON.parse(raw) as T : undefined;
};

const parseConfig = (raw: string | null): HubConfig | null => {
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  return typeof parsed?.serverUrl === 'string' && typeof parsed?.token === 'string'
    ? parsed as HubConfig
    : null;
};

export const saveConfig = async (cfg: HubConfig): Promise<HubConfig> => {
  if (isTauriDesktop()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return parseConfig(await invoke<string>('save_desktop_profile', { sessionJson: JSON.stringify(cfg) })) ?? cfg;
  }
  await SecureStore.setItemAsync(KEY, JSON.stringify(cfg));
  return cfg;
};

export const loadConfig = async (): Promise<HubConfig | null> => {
  if (isTauriDesktop()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return parseConfig(await invoke<string | null>('load_active_desktop_profile'));
  }
  try {
    return parseConfig(await SecureStore.getItemAsync(KEY));
  } catch {
    return null;
  }
};

export const clearConfig = async (): Promise<void> => {
  if (isTauriDesktop()) {
    const cfg = await loadConfig();
    if (cfg?.profileId) await removeHubProfile(cfg.profileId);
    return;
  }
  await SecureStore.deleteItemAsync(KEY);
};

export const listHubProfiles = async (): Promise<HubProfileRegistry> => {
  if (!isTauriDesktop()) {
    const cfg = await loadConfig();
    return { schema_version: 1, active_profile_id: cfg?.profileId, profiles: cfg?.profileId ? [{
      profileId: cfg.profileId,
      serverUrl: cfg.serverUrl,
      username: cfg.username ?? '',
      networkId: cfg.networkId,
      displayName: cfg.displayName,
      createdAt: 0,
      updatedAt: 0,
    }] : [] };
  }
  const { invoke } = await import('@tauri-apps/api/core');
  const raw = JSON.parse(await invoke<string>('list_desktop_profiles'));
  return {
    schema_version: Number(raw?.schema_version ?? 1),
    active_profile_id: typeof raw?.active_profile_id === 'string' ? raw.active_profile_id : null,
    profiles: Array.isArray(raw?.profiles) ? raw.profiles : [],
  };
};

export const switchHubProfile = async (profileId: string): Promise<HubConfig> => {
  if (!isTauriDesktop()) throw new Error('profile switching is currently available on desktop');
  const { invoke } = await import('@tauri-apps/api/core');
  const cfg = parseConfig(await invoke<string>('switch_desktop_profile', { profileId }));
  if (!cfg) throw new Error('saved profile is invalid');
  return cfg;
};

export const removeHubProfile = async (profileId: string): Promise<void> => {
  if (!isTauriDesktop()) {
    const cfg = await loadConfig();
    if (cfg?.profileId === profileId) await clearConfig();
    return;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('remove_desktop_profile', { profileId });
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

export const saveSessionsCache = async (sessions: Session[], profileId?: string): Promise<void> => {
  try {
    if (await writeDesktopProfileJson(profileId, 'cache/sessions.json', sessions)) return;
    await FileSystem.writeAsStringAsync(SESSIONS_CACHE, JSON.stringify(sessions));
  } catch {
    /* best-effort — never fail the live path on a cache write */
  }
};

export const loadSessionsCache = async (profileId?: string): Promise<Session[] | null> => {
  try {
    const desktop = await readDesktopProfileJson<unknown>(profileId, 'cache/sessions.json');
    if (desktop !== undefined) return Array.isArray(desktop) ? desktop as Session[] : null;
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

export const saveLocalAvatars = async (map: Record<string, string>, profileId?: string): Promise<void> => {
  try {
    if (await writeDesktopProfileJson(profileId, 'preferences/avatars.json', map)) return;
    await FileSystem.writeAsStringAsync(AVATAR_LOCAL, JSON.stringify(map));
  } catch {
    /* best-effort — never fail the UI on a preference write */
  }
};

export const loadLocalAvatars = async (profileId?: string): Promise<Record<string, string>> => {
  try {
    const desktop = await readDesktopProfileJson<unknown>(profileId, 'preferences/avatars.json');
    if (desktop !== undefined) return desktop && typeof desktop === 'object' && !Array.isArray(desktop) ? desktop as Record<string, string> : {};
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

export const saveOutbox = async (all: OutboxEntry[], profileId?: string): Promise<void> => {
  try {
    if (await writeDesktopProfileJson(profileId, 'outbox.json', all)) return;
    await FileSystem.writeAsStringAsync(OUTBOX_FILE, JSON.stringify(all));
  } catch {
    /* best-effort — 落盘失败不阻塞发送 UI;下次 flush 再试 */
  }
};

export const loadOutbox = async (profileId?: string): Promise<OutboxEntry[]> => {
  try {
    const desktop = await readDesktopProfileJson<unknown>(profileId, 'outbox.json');
    if (desktop !== undefined) return Array.isArray(desktop) ? desktop as OutboxEntry[] : [];
    const info = await FileSystem.getInfoAsync(OUTBOX_FILE);
    if (!info.exists) return [];
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(OUTBOX_FILE));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};
