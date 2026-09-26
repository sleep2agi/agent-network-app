// 会话行菜单的两份本机状态(「不显示该对话」「标为未读」)的存取 + 订阅 —— 不 import expo / RN,
// 存储后端注入进来,ck 测试可以拿假 localStorage / 假文件直接跑。接线在 conversation-flags.ts。
//
// 每台设备、每个账号一份:web(Tauri 桌面 / web 导出)用 localStorage,原生落 documentDirectory 的
// JSON 文件 —— 和 chat-pins.ts 同样按 pinScopeKey(cfg) 分账号,同一 alias 在两个 Hub 上互不影响。
// 读写都是尽力而为:存不下就只在本次会话里生效,不抛给界面。
//
// 为什么要一个模块级的 store:ChatScreen 打开会话要清「手动未读」,AgentsScreen 要重画角标,
// 两个组件不在一棵 props 树上能直接传的位置(双栏 / 单栏 / 桌面三种挂法)。
import { pinScopeKey } from './chat-pins-core';
import {
  clearManualUnread,
  emptyConversationFlags,
  parseConversationFlags,
  serializeConversationFlags,
  type ConversationFlags,
} from './agent-row-menu';

export type ScopeCfg = { profileId?: string; serverUrl?: string; username?: string };

export const CONVERSATION_FLAGS_KEY = 'agent_conversation_flags_v1';
export const conversationFlagsWebKey = (scope: string) => `${CONVERSATION_FLAGS_KEY}:${scope}`;

export interface ConversationFlagsBackend {
  /** web 的 localStorage;原生端返回 null,走 native。 */
  web: () => Pick<Storage, 'getItem' | 'setItem'> | null;
  native: {
    /** 读不到 / 不存在返回 null。 */
    read: (scope: string) => Promise<string | null>;
    write: (scope: string, body: string) => Promise<void>;
  };
}

export function createConversationFlagsStore(backend: ConversationFlagsBackend) {
  let scope: string | null = null;
  let flags: ConversationFlags = emptyConversationFlags();
  const listeners = new Set<() => void>();
  const emit = () => { for (const l of listeners) l(); };
  const web = () => { try { return backend.web(); } catch { return null; } };
  /** 原生端读盘还没回来时的改动排到读完之后 —— 否则拿空状态改一笔再写盘,会把盘上的旧记录整份冲掉。 */
  let nativeLoading: Promise<void> | null = null;
  let nativeWrite: Promise<unknown> = Promise.resolve();

  const get = (): ConversationFlags => flags;
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };

  /** 切到某个账号的那一份。web 同步读;原生异步读完再通知。同一账号重复调用是 no-op。 */
  const bind = (cfg: ScopeCfg): void => {
    const next = pinScopeKey(cfg);
    if (next === scope) return;
    scope = next;
    const ls = web();
    if (ls) {
      try { flags = parseConversationFlags(ls.getItem(conversationFlagsWebKey(next))); } catch { flags = emptyConversationFlags(); }
      emit();
      return;
    }
    flags = emptyConversationFlags();
    emit();
    const load = (async () => {
      try {
        const raw = await backend.native.read(next);
        if (raw == null || scope !== next) return;
        flags = parseConversationFlags(raw);
        emit();
      } catch { /* 读不到 = 空 */ }
    })();
    nativeLoading = load;
    void load.finally(() => { if (nativeLoading === load) nativeLoading = null; });
  };

  /** 所有改动都走这里:算出新值 → 同一引用就什么都不做 → 否则更新内存、通知、落盘。 */
  const update = (fn: (f: ConversationFlags) => ConversationFlags): void => {
    if (scope === null) return;
    const ls = web();
    if (!ls && nativeLoading) { const wait = nativeLoading; void wait.then(() => update(fn)); return; }
    // web:桌面端的独立聊天窗口是另一个 JS 上下文,和主窗口共用 localStorage。先读盘上的最新值再改,
    // 不拿自己内存里可能过期的那份覆盖另一个窗口刚写的。
    if (ls) {
      try { flags = parseConversationFlags(ls.getItem(conversationFlagsWebKey(scope))); } catch { /* 用内存那份 */ }
    }
    const next = fn(flags);
    if (next === flags) return;
    flags = next;
    emit();
    const s = scope;
    const body = serializeConversationFlags(next);
    if (ls) { try { ls.setItem(conversationFlagsWebKey(s), body); } catch { /* 本次会话有效 */ } return; }
    nativeWrite = nativeWrite.then(() => backend.native.write(s, body)).catch(() => { /* 本次会话有效 */ });
  };

  /** ChatScreen 打开某个会话:手动「标为未读」到此为止(微信:点进去就算读过)。 */
  const opened = (cfg: ScopeCfg, alias: string): void => {
    bind(cfg);
    update(f => clearManualUnread(f, alias));
  };

  /** 测试用:等所有排队的原生读写落定。 */
  const settled = async (): Promise<void> => {
    while (nativeLoading) await nativeLoading;
    await nativeWrite;
  };

  return { get, subscribe, bind, update, opened, settled };
}
