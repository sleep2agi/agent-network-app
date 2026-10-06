// #632 会话草稿(微信同款):输入框里没发出去的字,离开会话 / 切会话 / 退到后台 / 重启 app 后还在。
// 纯逻辑,不 import react-native / expo —— 存储后端由 composer-drafts.ts 注入,这里只决定:
//   · 键:账号 + Hub 地址 + 网络 + 会话(节点 / 私信 / 群),换账号 / 换服务器绝不串;
//   · 什么算「有草稿」(去掉空白后非空),空了就删;
//   · 上限:单条 MAX_DRAFT_CHARS 字、最多 MAX_DRAFTS 条、总字数 MAX_TOTAL_CHARS,超了先删最旧的;
//   · 写盘节流:内存立刻更新,落盘(和通知会话列表)300ms 去抖,flush() 立刻落。
// 只在本机,不发给 Hub。

export const MAX_DRAFT_CHARS = 20_000;
export const MAX_DRAFTS = 500;
/** 网页 / 桌面的 localStorage 一般 5MB(UTF-16 约 2.5M 字);留足余量给别的键。 */
export const MAX_TOTAL_CHARS = 1_000_000;
export const DRAFT_SAVE_DEBOUNCE_MS = 300;
/** 会话列表里 [草稿] 后面显示的字数(微信只露开头几个字)。 */
export const DRAFT_PREVIEW_CHARS = 40;

export type DraftConversation =
  | { kind: 'node'; alias: string }
  | { kind: 'dm'; userId: string }
  | { kind: 'group'; groupId: string };

export interface DraftAccount {
  serverUrl: string;
  /** 登录用户名(HubConfig.username);旧配置没有时退到 profileId。 */
  username?: string | null;
  profileId?: string | null;
  networkId?: string | null;
}

const normServer = (url: string): string => (url ?? '').trim().replace(/\/+$/, '').toLowerCase();

const conversationId = (c: DraftConversation): string =>
  c.kind === 'node' ? `node:${c.alias}` : c.kind === 'dm' ? `dm:${c.userId}` : `group:${c.groupId}`;

/** 草稿键。各段 encodeURIComponent,分隔符 `|` 不会出现在段里。 */
export const draftKey = (account: DraftAccount, conversation: DraftConversation): string => [
  'v1',
  encodeURIComponent(normServer(account.serverUrl)),
  encodeURIComponent(account.username || (account.profileId ? `profile:${account.profileId}` : '')),
  encodeURIComponent(account.networkId ?? ''),
  encodeURIComponent(conversationId(conversation)),
].join('|');

/** 「有草稿」= 去掉空白后还有字。只有空格 / 换行的输入框等同于空。 */
export const hasDraftText = (text: string | null | undefined): text is string => !!text && text.trim().length > 0;

/** 列表预览:换行压成空格,截前 DRAFT_PREVIEW_CHARS 个字(按码点,不切半个 emoji)。 */
export const draftPreview = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  return chars.length > DRAFT_PREVIEW_CHARS ? `${chars.slice(0, DRAFT_PREVIEW_CHARS).join('')}…` : flat;
};

export interface DraftEntry { t: string; at: number }
export type DraftMap = Record<string, DraftEntry>;

export interface DraftBackend {
  /** 读盘上的全部草稿;没有 / 坏了 → {}。 */
  read(): DraftMap | Promise<DraftMap>;
  write(all: DraftMap): void | Promise<void>;
}

const isEntry = (v: unknown): v is DraftEntry =>
  !!v && typeof v === 'object' && typeof (v as DraftEntry).t === 'string' && Number.isFinite((v as DraftEntry).at);

export const parseDraftBlob = (raw: string | null | undefined): DraftMap => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    const entries = parsed && typeof parsed === 'object' && parsed.v === 1 ? parsed.drafts : null;
    if (!entries || typeof entries !== 'object') return {};
    const out: DraftMap = {};
    for (const [k, v] of Object.entries(entries)) if (isEntry(v) && hasDraftText(v.t)) out[k] = { t: v.t.slice(0, MAX_DRAFT_CHARS), at: v.at };
    return out;
  } catch {
    return {};
  }
};

export const serializeDraftBlob = (all: DraftMap): string => JSON.stringify({ v: 1, drafts: all });

/** 超出条数 / 总字数时按 at 从旧到新删。返回新对象,不改入参。 */
export const enforceDraftLimits = (all: DraftMap, limits: { maxDrafts?: number; maxTotalChars?: number } = {}): DraftMap => {
  const maxDrafts = limits.maxDrafts ?? MAX_DRAFTS;
  const maxTotal = limits.maxTotalChars ?? MAX_TOTAL_CHARS;
  const sorted = Object.entries(all).sort((a, b) => b[1].at - a[1].at); // 新的在前
  const out: DraftMap = {};
  let total = 0;
  let n = 0;
  for (const [k, v] of sorted) {
    if (n >= maxDrafts || total + v.t.length > maxTotal) continue;
    out[k] = v;
    total += v.t.length;
    n++;
  }
  return out;
};

export interface DraftStoreOptions {
  backend?: DraftBackend | null;
  /** 同步可读的后端(localStorage)在创建时就给出盘上内容 —— 打开会话第一帧就能放回草稿。 */
  initial?: DraftMap;
  debounceMs?: number;
  maxChars?: number;
  maxDrafts?: number;
  maxTotalChars?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface DraftStore {
  get(key: string): string;
  /** 输入框变化:内存立刻更新,落盘去抖。空白 = 删。 */
  set(key: string, text: string): void;
  remove(key: string): void;
  /** 立刻把去抖中的改动写盘(离开会话 / 切会话 / 退后台 / 关页面)。 */
  flush(): Promise<void>;
  /** 从后端读一次(启动时;另一个窗口改了 localStorage 时)。本窗口还没落盘的改动不会被盖掉。 */
  hydrate(): Promise<void>;
  isHydrated(): boolean;
  /** 会话列表订阅:落盘 / hydrate 之后通知,不是每敲一个字都通知。 */
  subscribe(listener: () => void): () => void;
  version(): number;
  snapshot(): DraftMap;
}

export const createDraftStore = (opts: DraftStoreOptions = {}): DraftStore => {
  const backend = opts.backend ?? null;
  const debounceMs = opts.debounceMs ?? DRAFT_SAVE_DEBOUNCE_MS;
  const maxChars = opts.maxChars ?? MAX_DRAFT_CHARS;
  const limits = { maxDrafts: opts.maxDrafts ?? MAX_DRAFTS, maxTotalChars: opts.maxTotalChars ?? MAX_TOTAL_CHARS };
  const now = opts.now ?? Date.now;
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let mem: DraftMap = { ...(opts.initial ?? {}) };
  /** 本窗口改过、还没写盘的键(值 = 改成了什么;null = 删)。 */
  let dirty = new Map<string, DraftEntry | null>();
  let timer: unknown = null;
  let hydrated = !!opts.initial;
  let ver = 0;
  const listeners = new Set<() => void>();
  const notify = () => { ver++; listeners.forEach(l => { try { l(); } catch { /* listener bugs never break typing */ } }); };

  const applyBatch = (base: DraftMap, batch: Map<string, DraftEntry | null>): DraftMap => {
    const next = { ...base };
    for (const [k, v] of batch) { if (v) next[k] = v; else delete next[k]; }
    return next;
  };

  let writing: Promise<void> = Promise.resolve();
  const flush = (): Promise<void> => {
    if (timer !== null) { clearTimer(timer); timer = null; }
    if (!dirty.size) return writing;
    const batch = dirty;
    dirty = new Map();
    const run = async () => {
      // 读-改-写:另一个窗口(分离聊天窗)写过的键保留,只覆盖本窗口改过的那些。
      let base: DraftMap = mem;
      if (backend) { try { base = await backend.read(); } catch { base = mem; } }
      const next = enforceDraftLimits(applyBatch(base, batch), limits);
      // 写盘期间又敲的字(dirty)仍以内存为准。
      mem = applyBatch(next, dirty);
      if (backend) {
        try { await backend.write(next); }
        catch { for (const [k, v] of batch) if (!dirty.has(k)) dirty.set(k, v); } // 写失败:留着下次再写
      }
      notify();
    };
    writing = writing.then(run, run);
    return writing;
  };

  const schedule = () => {
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => { timer = null; void flush(); }, debounceMs);
  };

  return {
    get: key => mem[key]?.t ?? '',
    set(key, text) {
      const value = (text ?? '').slice(0, maxChars);
      if (!hasDraftText(value)) {
        if (!(key in mem) && !dirty.has(key)) return;
        delete mem[key];
        dirty.set(key, null);
      } else {
        if (mem[key]?.t === value) return;
        const entry = { t: value, at: now() };
        mem[key] = entry;
        dirty.set(key, entry);
      }
      schedule();
    },
    remove(key) {
      if (!(key in mem) && !dirty.has(key)) return;
      delete mem[key];
      dirty.set(key, null);
      schedule();
    },
    flush,
    async hydrate() {
      if (!backend) { hydrated = true; notify(); return; }
      let disk: DraftMap = {};
      try { disk = await backend.read(); } catch { disk = {}; }
      mem = applyBatch(disk, dirty);
      hydrated = true;
      notify();
    },
    isHydrated: () => hydrated,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    version: () => ver,
    snapshot: () => ({ ...mem }),
  };
};
