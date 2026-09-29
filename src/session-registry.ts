// 手机 / 网页的多账号(Vincent 2026-09-29「新增一个切换账号，或者切换服务器…两个登录状态都要留住」)。
// 桌面端(Tauri)的多账号在 Rust 里(src-tauri/src/lib.rs 的 profile registry),这里是 iOS / 安卓 / web 那一份,
// 形状照着它做:索引里只有元数据,凭据按账号 id 各存一个安全存储键。
//
// 存储布局(kv = 原生 SecureStore / web localStorage):
//   hub_sessions_v2           索引 { v: 2, active, sessions: [{ id, serverUrl, username, … }] } —— 不含 token
//   hub_config_v1             「迁移过来的那个账号」(id = legacy)的凭据 —— 就是升级前唯一那个键,原地不动
//   hub_session_<id>          之后添加的每个账号的凭据(完整 HubConfig,含 profileId = id)
//
// 🔴 升级不丢登录:第一次读到没有索引、但有 hub_config_v1 时,只**新建索引**指向它,不搬、不改、不删那个键。
//    迁移过来的账号不带 profileId —— 它的置顶 / 会话缓存 / 通知设置 / 本地文件都还按升级前的键找得到;
//    回滚到旧版 app 读的也还是 hub_config_v1。
// 🔴 切换不吊销:切走的账号凭据原样留在自己的键里,切回来直接用,不用再输密码。
// 🔴 移除只动本机:删这个账号的凭据键和索引行。服务器上的登录令牌不动(hub 目前没有「吊销当前令牌」的接口)。
import type { HubConfig } from './api';

export const SESSIONS_INDEX_KEY = 'hub_sessions_v2';
export const LEGACY_CONFIG_KEY = 'hub_config_v1';
/** 升级前那个账号的 id。它的 HubConfig 不带 profileId(见文件头)。 */
export const LEGACY_SESSION_ID = 'legacy';

export interface SessionKv {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

export interface SessionMeta {
  id: string;
  serverUrl: string;
  username: string;
  networkId?: string;
  displayName?: string;
  requiresReauth?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SessionIndex {
  v: 2;
  active: string | null;
  sessions: SessionMeta[];
}

export const credentialKey = (id: string): string => (id === LEGACY_SESSION_ID ? LEGACY_CONFIG_KEY : `hub_session_${id}`);

/**
 * 手机上的本地文件按账号分:迁移过来的账号(profileId 为空)沿用升级前的文件名,之后添加的账号在文件名里带上 id ——
 * 切到另一个账号时读不到上一个账号的 Agent 列表缓存 / 未送达消息 / 头像 / 转发记录。
 */
export const accountScopedFile = (base: string, profileId?: string): string =>
  profileId ? base.replace(/\.json$/, `.${profileId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`) : base;

const emptyIndex = (): SessionIndex => ({ v: 2, active: null, sessions: [] });

export const parseHubConfig = (raw: string | null): HubConfig | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed?.serverUrl === 'string' && typeof parsed?.token === 'string' ? parsed as HubConfig : null;
  } catch {
    return null;
  }
};

const parseIndex = (raw: string | null): SessionIndex | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== 2 || !Array.isArray(parsed.sessions)) return null;
    const sessions = parsed.sessions.filter((s: any): s is SessionMeta => !!s && typeof s.id === 'string' && !!s.id && typeof s.serverUrl === 'string');
    const active = typeof parsed.active === 'string' && sessions.some((s: SessionMeta) => s.id === parsed.active) ? parsed.active : sessions[0]?.id ?? null;
    return { v: 2, active, sessions };
  } catch {
    return null;
  }
};

/** 同一个账号 = 同一台服务器(忽略尾斜杠和大小写)+ 同一个用户名。再登录一次同一个账号是「更新」不是「新增」。 */
export const sameAccount = (a: { serverUrl: string; username?: string }, b: { serverUrl: string; username?: string }): boolean =>
  a.serverUrl.replace(/\/+$/, '').toLowerCase() === b.serverUrl.replace(/\/+$/, '').toLowerCase() && (a.username ?? '') === (b.username ?? '');

/** 列表 / 切换面板上的「账号 @ 服务器」。 */
export const accountHost = (serverUrl: string): string => serverUrl.replace(/^https?:\/\//i, '').replace(/\/+$/, '');

const metaOf = (id: string, cfg: HubConfig, now: number, prev?: SessionMeta): SessionMeta => ({
  id,
  serverUrl: cfg.serverUrl,
  username: cfg.username ?? prev?.username ?? '',
  ...(cfg.networkId ? { networkId: cfg.networkId } : {}),
  ...(cfg.displayName ?? prev?.displayName ? { displayName: cfg.displayName ?? prev?.displayName } : {}),
  createdAt: prev?.createdAt ?? now,
  updatedAt: now,
});

export interface SessionStoreDeps {
  now?: () => number;
  newId?: () => string;
}

const randomId = (): string => `m-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function createSessionStore(kv: SessionKv, deps: SessionStoreDeps = {}) {
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? randomId;

  const writeIndex = (index: SessionIndex) => kv.set(SESSIONS_INDEX_KEY, JSON.stringify(index));

  /** 读索引;没有索引时从升级前的单账号键迁移(只写索引,不碰凭据键)。 */
  const loadIndex = async (): Promise<SessionIndex> => {
    const index = parseIndex(await kv.get(SESSIONS_INDEX_KEY));
    if (index) return index;
    const legacy = parseHubConfig(await kv.get(LEGACY_CONFIG_KEY));
    if (!legacy) return emptyIndex();
    const migrated: SessionIndex = { v: 2, active: LEGACY_SESSION_ID, sessions: [metaOf(LEGACY_SESSION_ID, legacy, now())] };
    await writeIndex(migrated);
    return migrated;
  };

  /** 某个账号的完整凭据。迁移账号不带 profileId;其余的 profileId = id。 */
  const loadSession = async (id: string): Promise<HubConfig | null> => {
    const cfg = parseHubConfig(await kv.get(credentialKey(id)));
    if (!cfg) return null;
    if (id === LEGACY_SESSION_ID) {
      const { profileId: _drop, ...rest } = cfg;
      return rest;
    }
    return { ...cfg, profileId: id };
  };

  const activeConfig = async (): Promise<HubConfig | null> => {
    const index = await loadIndex();
    return index.active ? loadSession(index.active) : null;
  };

  /**
   * 登录成功后保存:同一账号(或 reauth 带着 profileId)→ 更新它的凭据;否则新增一个账号。
   * 两种情况都把它设成当前账号。**不动其他账号**。
   */
  const save = async (cfg: HubConfig): Promise<HubConfig> => {
    const index = await loadIndex();
    const existing = (cfg.profileId ? index.sessions.find(s => s.id === cfg.profileId) : undefined)
      ?? index.sessions.find(s => sameAccount(s, cfg));
    const id = existing?.id ?? newId();
    const stored: HubConfig = id === LEGACY_SESSION_ID
      ? (({ profileId: _drop, ...rest }) => rest)(cfg)
      : { ...cfg, profileId: id };
    // 先写凭据再写索引:中途失败时索引里不会出现一个没有凭据的账号。
    await kv.set(credentialKey(id), JSON.stringify(stored));
    const meta = metaOf(id, stored, now(), existing);
    const sessions = existing ? index.sessions.map(s => (s.id === id ? meta : s)) : [...index.sessions, meta];
    await writeIndex({ v: 2, active: id, sessions });
    return stored;
  };

  const switchTo = async (id: string): Promise<HubConfig> => {
    const index = await loadIndex();
    if (!index.sessions.some(s => s.id === id)) throw new Error('saved account not found');
    const cfg = await loadSession(id);
    if (!cfg) throw new Error('saved account is invalid');
    await writeIndex({ ...index, active: id });
    return cfg;
  };

  /** 移除一个账号(只删本机)。移除的是当前账号 → 当前账号换成剩下的第一个;一个都不剩 → null。 */
  const remove = async (id: string): Promise<string | null> => {
    const index = await loadIndex();
    const sessions = index.sessions.filter(s => s.id !== id);
    const active = index.active === id ? sessions[0]?.id ?? null : index.active;
    await writeIndex({ v: 2, active, sessions });
    await kv.del(credentialKey(id));
    return active;
  };

  const removeActive = async (): Promise<string | null> => {
    const index = await loadIndex();
    return index.active ? remove(index.active) : null;
  };

  const markReauth = async (id: string, required: boolean): Promise<void> => {
    const index = await loadIndex();
    if (!index.sessions.some(s => s.id === id)) return;
    await writeIndex({ ...index, sessions: index.sessions.map(s => (s.id === id ? { ...s, requiresReauth: required || undefined } : s)) });
  };

  return { loadIndex, loadSession, activeConfig, save, switchTo, remove, removeActive, markReauth };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
