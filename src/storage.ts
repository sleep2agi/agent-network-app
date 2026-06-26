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
