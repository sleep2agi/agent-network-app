// 「当前密码过于简单」标记(#653)。hub ≥ 0.9.0-preview.108 在弱密码登录成功时回 must_change_password: true;
// app 记下来,顶部横幅提示去改,改成功就清掉。纯逻辑(存取经注入的 kv),可单测。
//
// 为什么不放进 HubConfig:桌面端的账号经 Rust save_desktop_profile 落盘,那边按字段白名单反序列化,
// 多出来的字段会被丢掉 —— 重启后标记就没了。这里单独存一个小 JSON。
// 为什么按 hub 地址 + 用户名记,不按 profileId:登录响应到手时还没有 profileId(保存之后才有);
// 同一个人在同一个 hub 上的标记本来就是同一件事(hub 侧也是按用户记的)。
// /api/auth/me 不回这个字段,所以只能靠登录响应 —— 登录时不带这个字段 = 清掉(别处已经改过了)。

export type WeakPasswordKv = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
};

export const WEAK_PASSWORD_STORAGE_KEY = 'anet.weakPassword.v1';

export type AccountRef = { serverUrl: string; username?: string | null };

/** hub 地址去尾斜杠、小写;用户名原样(hub 的用户名区分大小写)。没有用户名 = 不记(无从对应)。 */
export function weakPasswordKey(ref: AccountRef): string | null {
  const user = (ref.username ?? '').trim();
  const server = (ref.serverUrl ?? '').trim().replace(/\/+$/, '').toLowerCase();
  if (!user || !server) return null;
  return `${server}\u0000${user}`;
}

export function createWeakPasswordFlags(kv: WeakPasswordKv) {
  let flagged = new Set<string>();
  let version = 0;
  const listeners = new Set<() => void>();
  const emit = () => { version++; for (const l of [...listeners]) l(); };
  const persist = () => kv.set(WEAK_PASSWORD_STORAGE_KEY, JSON.stringify([...flagged])).catch(() => { /* 只活这一次会话 */ });

  const parse = (raw: string | null): Set<string> => {
    try {
      const list = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : []);
    } catch { return new Set(); }
  };

  // 写之前先读过一次存储:否则登录页(还没读过)记一个账号,会把别的账号存着的标记整份覆盖掉。
  let loaded = false;
  const hydrate = async (): Promise<void> => {
    const next = parse(await kv.get(WEAK_PASSWORD_STORAGE_KEY).catch(() => null));
    loaded = true;
    const same = next.size === flagged.size && [...next].every(k => flagged.has(k));
    flagged = next;
    if (!same) emit();
  };
  const ready = () => (loaded ? Promise.resolve() : hydrate());
  const update = async (key: string, on: boolean): Promise<void> => {
    await ready();
    if (on === flagged.has(key)) return;
    flagged = new Set(flagged);
    if (on) flagged.add(key); else flagged.delete(key);
    emit();
    await persist();
  };

  return {
    /** 启动时(和别的窗口改过之后)从存储读一遍。 */
    hydrate,
    /** 登录响应到手:带 must_change_password=true 就记上,否则清掉。 */
    recordLogin: async (ref: AccountRef, mustChangePassword: boolean): Promise<void> => {
      const key = weakPasswordKey(ref);
      if (key) await update(key, mustChangePassword);
    },
    /** 密码改成功了。 */
    clear: async (ref: AccountRef): Promise<void> => {
      const key = weakPasswordKey(ref);
      if (key) await update(key, false);
    },
    isFlagged: (ref: AccountRef | null | undefined): boolean => {
      const key = ref ? weakPasswordKey(ref) : null;
      return !!key && flagged.has(key);
    },
    subscribe: (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** useSyncExternalStore 的快照:每次变化 +1。 */
    snapshot: (): number => version,
  };
}

export type WeakPasswordFlags = ReturnType<typeof createWeakPasswordFlags>;
