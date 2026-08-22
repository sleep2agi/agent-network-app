import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import { HubConfig, Session } from './api';

// Token + server persist in the platform keystore (Android Keystore /
// iOS Keychain) so login survives app restarts. Vincent tg 683 known
// gap: v0.1.1 lost the session on kill — this closes it.

const KEY = 'hub_config_v1';

export const saveConfig = async (cfg: HubConfig): Promise<void> => {
  await SecureStore.setItemAsync(KEY, JSON.stringify(cfg));
};

export const loadConfig = async (): Promise<HubConfig | null> => {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.serverUrl === 'string' && typeof parsed?.token === 'string') {
      return parsed as HubConfig;
    }
    return null;
  } catch {
    return null;
  }
};

export const clearConfig = async (): Promise<void> => {
  await SecureStore.deleteItemAsync(KEY);
};

const THEME_KEY = 'theme_mode_v1';

export const saveThemeMode = async (mode: string): Promise<void> => {
  try {
    await SecureStore.setItemAsync(THEME_KEY, mode);
  } catch {
    /* theme preference is best-effort */
  }
};

export const loadThemeMode = async (): Promise<string | null> => {
  try {
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
export const saveSessionsCache = async (sessions: Session[], profileId?: string): Promise<void> => {
  try {
    await FileSystem.writeAsStringAsync(profileFile('sessions_cache_v1.json', profileId), JSON.stringify(sessions));
  } catch {
    /* best-effort — never fail the live path on a cache write */
  }
};

export const loadSessionsCache = async (profileId?: string): Promise<Session[] | null> => {
  try {
    const target = profileFile('sessions_cache_v1.json', profileId);
    const info = await FileSystem.getInfoAsync(target);
    if (!info.exists) return null;
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(target));
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
const profileFile = (name: string, profileId?: string) =>
  `${FileSystem.documentDirectory}${profileId ? `${profileId}_` : ''}${name}`;

export const saveLocalAvatars = async (map: Record<string, string>, profileId?: string): Promise<void> => {
  try {
    await FileSystem.writeAsStringAsync(profileFile('avatar_local_v1.json', profileId), JSON.stringify(map));
  } catch {
    /* best-effort — never fail the UI on a preference write */
  }
};

export const loadLocalAvatars = async (profileId?: string): Promise<Record<string, string>> => {
  try {
    const target = profileFile('avatar_local_v1.json', profileId);
    let info = await FileSystem.getInfoAsync(target);
    // Upgrade path: the first v2 profile adopts the old unscoped file.
    if (!info.exists && profileId) {
      const legacy = profileFile('avatar_local_v1.json');
      info = await FileSystem.getInfoAsync(legacy);
      if (info.exists) return JSON.parse(await FileSystem.readAsStringAsync(legacy));
    }
    if (!info.exists) return {};
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(target));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

// PR3 判据C:未送达消息 outbox(src/outbox.ts)的落盘。documentDirectory(持久·
// 非可清缓存目录)——判据是「杀掉 app 再开它还在」,放 cacheDirectory 就输在判据上。
import type { OutboxEntry } from './outbox';
export const saveOutbox = async (all: OutboxEntry[], profileId?: string): Promise<void> => {
  try {
    await FileSystem.writeAsStringAsync(profileFile('outbox_v1.json', profileId), JSON.stringify(all));
  } catch {
    /* best-effort — 落盘失败不阻塞发送 UI;下次 flush 再试 */
  }
};

export const loadOutbox = async (profileId?: string): Promise<OutboxEntry[]> => {
  try {
    const target = profileFile('outbox_v1.json', profileId);
    let info = await FileSystem.getInfoAsync(target);
    if (!info.exists && profileId) {
      const legacy = profileFile('outbox_v1.json');
      info = await FileSystem.getInfoAsync(legacy);
      if (info.exists) return JSON.parse(await FileSystem.readAsStringAsync(legacy));
    }
    if (!info.exists) return [];
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(target));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};
