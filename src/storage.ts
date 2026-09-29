import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { HubConfig, Session } from './api';
import { LEGACY_SESSION_ID, accountScopedFile as scopedFile, createSessionStore, type SessionKv } from './session-registry';
import { loadDesktopThemeMode, loadDesktopUiScale, saveDesktopThemeMode, saveDesktopUiScale } from './desktop-theme-storage';
export { onDesktopThemeStorageChange, onDesktopUiScaleStorageChange } from './desktop-theme-storage';
import { UI_SCALE_STORAGE_KEY, parseStoredUiScale, serializeUiScale, type UiScalePrefs } from './ui-scale';

// Token + server persist in the platform keystore (Android Keystore /
// iOS Keychain) so login survives app restarts. Vincent tg 683 known
// gap: v0.1.1 lost the session on kill — this closes it.
// Several accounts since 2026-09-29: the account index and per-account keys are in src/session-registry.ts.

export interface HubProfile {
  profileId: string;
  serverUrl: string;
  username: string;
  networkId?: string;
  displayName?: string;
  requiresReauth?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface HubProfileRegistry {
  schema_version: number;
  active_profile_id?: string | null;
  profiles: HubProfile[];
}

export interface DesktopStorageDiagnostics {
  root: string;
  schema_version: number;
  profile_count: number;
  active_profile_id?: string | null;
  corrupt_backups: string[];
}

export interface DetachedChatWindow {
  alias: string;
  context?: string;
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

// 手机 / 网页的多账号(src/session-registry.ts):原生落 SecureStore(钥匙串 / Keystore),
// 网页(不是 Tauri 桌面壳)落 localStorage —— expo-secure-store 在 web 上是空实现,调用即抛。
const webStorage = (): Storage | null => {
  if (Platform.OS !== 'web') return null;
  try { return globalThis.localStorage ?? null; } catch { return null; }
};
const sessionKv: SessionKv = {
  get: async key => { const web = webStorage(); return web ? web.getItem(key) : SecureStore.getItemAsync(key); },
  set: async (key, value) => { const web = webStorage(); if (web) web.setItem(key, value); else await SecureStore.setItemAsync(key, value); },
  del: async key => { const web = webStorage(); if (web) web.removeItem(key); else await SecureStore.deleteItemAsync(key); },
};
const mobileSessions = createSessionStore(sessionKv);

export const saveConfig = async (cfg: HubConfig): Promise<HubConfig> => {
  if (isTauriDesktop()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return parseConfig(await invoke<string>('save_desktop_profile', { sessionJson: JSON.stringify(cfg) })) ?? cfg;
  }
  // 新增或更新一个账号并设为当前;其他账号的登录状态原样保留。
  return mobileSessions.save(cfg);
};

export const loadConfig = async (): Promise<HubConfig | null> => {
  if (isTauriDesktop()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return parseConfig(await invoke<string | null>('load_active_desktop_profile'));
  }
  try {
    return await mobileSessions.activeConfig();
  } catch {
    return null;
  }
};

/** 退出登录 = 只移除当前账号;还有别的账号时当前账号换成剩下的第一个(下一次 loadConfig 读到它)。 */
export const clearConfig = async (): Promise<void> => {
  if (isTauriDesktop()) {
    const cfg = await loadConfig();
    if (cfg?.profileId) await removeHubProfile(cfg.profileId);
    return;
  }
  const index = await mobileSessions.loadIndex();
  if (index.active) await removeHubProfile(index.active);
};

/** 手机 / 网页:迁移过来的账号在 HubConfig 上不带 profileId,在列表里的 id 是 LEGACY_SESSION_ID。 */
export const sessionIdOf = (cfg: Pick<HubConfig, 'profileId'> | null | undefined): string | undefined =>
  cfg ? cfg.profileId ?? (isTauriDesktop() ? undefined : LEGACY_SESSION_ID) : undefined;

export const listHubProfiles = async (): Promise<HubProfileRegistry> => {
  if (!isTauriDesktop()) {
    const index = await mobileSessions.loadIndex();
    return {
      schema_version: 2,
      active_profile_id: index.active,
      profiles: index.sessions.map(s => ({
        profileId: s.id,
        serverUrl: s.serverUrl,
        username: s.username,
        networkId: s.networkId,
        displayName: s.displayName,
        requiresReauth: s.requiresReauth,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
    };
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
  if (!isTauriDesktop()) return mobileSessions.switchTo(profileId);
  const { invoke } = await import('@tauri-apps/api/core');
  const cfg = parseConfig(await invoke<string>('switch_desktop_profile', { profileId }));
  if (!cfg) throw new Error('saved profile is invalid');
  return cfg;
};

// 应用多开:按窗口借用一个账号的会话,不改全局「当前账号」(switchHubProfile 会改)。
export const loadHubProfile = async (profileId: string): Promise<HubConfig> => {
  if (!isTauriDesktop()) throw new Error('per-window profiles are currently available on desktop');
  const { invoke } = await import('@tauri-apps/api/core');
  const cfg = parseConfig(await invoke<string>('load_desktop_profile', { profileId }));
  if (!cfg) throw new Error('saved profile is invalid');
  return cfg;
};

/** 读一个已保存账号的凭据但不切过去(切换账号面板验证它还能不能用)。桌面走 Rust 的 profile,手机 / 网页走 session-registry。 */
export const loadSavedProfileConfig = async (profileId: string): Promise<HubConfig | null> => {
  if (isTauriDesktop()) return loadHubProfile(profileId);
  return mobileSessions.loadSession(profileId);
};

export const removeHubProfile = async (profileId: string): Promise<void> => {
  if (!isTauriDesktop()) {
    await mobileSessions.remove(profileId);
    // 这个账号的本地文件(Agent 列表缓存、未送达、转发、头像)一起删;best-effort,和桌面端删 profile 目录对应。
    const scope = profileId === LEGACY_SESSION_ID ? undefined : profileId;
    await Promise.all([SESSIONS_CACHE, AVATAR_LOCAL, OUTBOX_FILE, FORWARD_FILE].map(base =>
      FileSystem.deleteAsync(scopedFile(base, scope), { idempotent: true }).catch(() => {})));
    return;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('remove_desktop_profile', { profileId });
};

export const markHubProfileRequiresReauth = async (profileId: string, required = true): Promise<void> => {
  if (!isTauriDesktop()) { await mobileSessions.markReauth(profileId, required); return; }
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('mark_desktop_profile_requires_reauth', { profileId, required });
};

export const getDesktopStorageDiagnostics = async (): Promise<DesktopStorageDiagnostics | null> => {
  if (!isTauriDesktop()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return JSON.parse(await invoke<string>('desktop_storage_diagnostics')) as DesktopStorageDiagnostics;
};

export const loadDetachedChatWindows = async (profileId?: string): Promise<DetachedChatWindow[]> => {
  try {
    const value = await readDesktopProfileJson<unknown>(profileId, 'windows.json');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is DetachedChatWindow =>
      !!item && typeof item === 'object' && typeof (item as DetachedChatWindow).alias === 'string' && !!(item as DetachedChatWindow).alias.trim(),
    );
  } catch {
    // Replaceable presentation state must never block account/session restore.
    return [];
  }
};

export const saveDetachedChatWindows = async (profileId: string | undefined, windows: DetachedChatWindow[]): Promise<void> => {
  await writeDesktopProfileJson(profileId, 'windows.json', windows);
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

// 字体大小 / 界面密度 — per device, next to the theme (localStorage on desktop, SecureStore on mobile).
// Nothing stored (every install before this setting) parses to "never chosen" → defaults.
export const saveUiScalePrefs = async (prefs: UiScalePrefs): Promise<void> => {
  const raw = serializeUiScale(prefs);
  try {
    if (saveDesktopUiScale(raw)) return;
    await SecureStore.setItemAsync(UI_SCALE_STORAGE_KEY, raw);
  } catch {
    /* best-effort, like the theme */
  }
};

export const loadUiScalePrefs = async (): Promise<UiScalePrefs> => {
  try {
    const desktop = loadDesktopUiScale();
    if (desktop !== undefined) return parseStoredUiScale(desktop);
    return parseStoredUiScale(await SecureStore.getItemAsync(UI_SCALE_STORAGE_KEY));
  } catch {
    return parseStoredUiScale(null);
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
    await FileSystem.writeAsStringAsync(scopedFile(SESSIONS_CACHE, profileId), JSON.stringify(sessions));
  } catch {
    /* best-effort — never fail the live path on a cache write */
  }
};

export const loadSessionsCache = async (profileId?: string): Promise<Session[] | null> => {
  try {
    const desktop = await readDesktopProfileJson<unknown>(profileId, 'cache/sessions.json');
    if (desktop !== undefined) return Array.isArray(desktop) ? desktop as Session[] : null;
    const info = await FileSystem.getInfoAsync(scopedFile(SESSIONS_CACHE, profileId));
    if (!info.exists) return null;
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(scopedFile(SESSIONS_CACHE, profileId)));
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
    await FileSystem.writeAsStringAsync(scopedFile(AVATAR_LOCAL, profileId), JSON.stringify(map));
  } catch {
    /* best-effort — never fail the UI on a preference write */
  }
};

export const loadLocalAvatars = async (profileId?: string): Promise<Record<string, string>> => {
  try {
    const desktop = await readDesktopProfileJson<unknown>(profileId, 'preferences/avatars.json');
    if (desktop !== undefined) return desktop && typeof desktop === 'object' && !Array.isArray(desktop) ? desktop as Record<string, string> : {};
    const info = await FileSystem.getInfoAsync(scopedFile(AVATAR_LOCAL, profileId));
    if (!info.exists) return {};
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(scopedFile(AVATAR_LOCAL, profileId)));
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
    await FileSystem.writeAsStringAsync(scopedFile(OUTBOX_FILE, profileId), JSON.stringify(all));
  } catch {
    /* best-effort — 落盘失败不阻塞发送 UI;下次 flush 再试 */
  }
};

export const loadOutbox = async (profileId?: string): Promise<OutboxEntry[]> => {
  try {
    const desktop = await readDesktopProfileJson<unknown>(profileId, 'outbox.json');
    if (desktop !== undefined) return Array.isArray(desktop) ? desktop as OutboxEntry[] : [];
    const info = await FileSystem.getInfoAsync(scopedFile(OUTBOX_FILE, profileId));
    if (!info.exists) return [];
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(scopedFile(OUTBOX_FILE, profileId)));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

import type { ForwardOperation } from './forward-controller';
const FORWARD_FILE = `${FileSystem.documentDirectory}forward_operations_v1.json`;

const UNREAD_PERSIST_FILE = `${FileSystem.documentDirectory}unread_persist_v1.json`;

/** Unread snapshots must persist across kill. Write errors throw — callers
 *  keep a pending snapshot and retry. Do not catch here. */
export async function saveUnreadPersistSnapshot(snapshot: unknown, profileId?: string): Promise<void> {
  if (await writeDesktopProfileJson(profileId, 'cache/unread.json', snapshot)) return;
  await FileSystem.writeAsStringAsync(UNREAD_PERSIST_FILE, JSON.stringify(snapshot));
}

export const saveForwardOperations = async (all: ForwardOperation[], profileId?: string): Promise<void> => {
  if (await writeDesktopProfileJson(profileId, 'forward-operations.json', all)) return;
  await FileSystem.writeAsStringAsync(scopedFile(FORWARD_FILE, profileId), JSON.stringify(all));
};
export const loadForwardOperations = async (profileId?: string): Promise<ForwardOperation[]> => {
  try { const desktop=await readDesktopProfileJson<unknown>(profileId,'forward-operations.json'); if(desktop!==undefined)return Array.isArray(desktop)?desktop as ForwardOperation[]:[]; const info=await FileSystem.getInfoAsync(scopedFile(FORWARD_FILE, profileId)); if(!info.exists)return []; const v=JSON.parse(await FileSystem.readAsStringAsync(scopedFile(FORWARD_FILE, profileId))); return Array.isArray(v)?v:[]; } catch { return []; }
};
