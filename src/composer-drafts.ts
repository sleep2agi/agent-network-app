// #632 会话草稿的运行时:平台存储 + 全局落盘时机 + React 钩子。纯逻辑在 composer-draft-core.ts。
//
// 存哪里(和 app 别的本机持久化同一套,storage.ts):
//   · 网页 / Tauri 桌面:localStorage(同步读 —— 打开会话第一帧就放回草稿;分离聊天窗共享,靠 storage 事件同步);
//   · 手机原生:documentDirectory 下一个 JSON 文件(SecureStore 单值 ~2KB 上限,装不下 2 万字的草稿)。
// 什么时候落盘:敲字 300ms 去抖;离开 / 切换会话、app 退到后台、页面关闭 / 刷新时立刻落。
// 只在本机,不发给 Hub。
import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import type { HubConfig } from './api';
import type { PickedImage } from './attach';
import {
  createDraftStore, draftKey, hasDraftText, parseDraftBlob, serializeDraftBlob,
  type DraftBackend, type DraftConversation, type DraftMap,
} from './composer-draft-core';

export { draftKey, draftPreview, hasDraftText } from './composer-draft-core';
export type { DraftConversation } from './composer-draft-core';

const STORAGE_KEY = 'composer_drafts_v1';

const webStorage = (): Storage | null => {
  if (Platform.OS !== 'web') return null;
  try { return globalThis.localStorage ?? null; } catch { return null; }
};

const localStorageBackend = (ls: Storage): DraftBackend => ({
  read: () => { try { return parseDraftBlob(ls.getItem(STORAGE_KEY)); } catch { return {}; } },
  write: all => { ls.setItem(STORAGE_KEY, serializeDraftBlob(all)); },
});

const fileBackend = (): DraftBackend => {
  // 懒加载:网页包里不带 expo-file-system 的原生路径。
  const fs = () => import('expo-file-system/legacy');
  const path = async () => `${(await fs()).documentDirectory}${STORAGE_KEY}.json`;
  return {
    read: async () => {
      try {
        const FileSystem = await fs();
        const p = await path();
        const info = await FileSystem.getInfoAsync(p);
        return info.exists ? parseDraftBlob(await FileSystem.readAsStringAsync(p)) : {};
      } catch { return {}; }
    },
    write: async all => { const FileSystem = await fs(); await FileSystem.writeAsStringAsync(await path(), serializeDraftBlob(all)); },
  };
};

const ls = webStorage();
const backend = ls ? localStorageBackend(ls) : fileBackend();
const initial: DraftMap | undefined = ls ? (backend.read() as DraftMap) : undefined;
export const composerDrafts = createDraftStore({ backend, initial });
if (!ls) void composerDrafts.hydrate();

// ── 全局落盘时机 ──
const flushNow = () => { void composerDrafts.flush(); };
try {
  AppState.addEventListener('change', state => { if (state !== 'active') flushNow(); });
} catch { /* 测试 / 非 RN 环境 */ }
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('pagehide', flushNow);
  window.addEventListener('beforeunload', flushNow);
  // 另一个窗口(分离聊天窗 / 设置窗)改了草稿:重读一次,会话列表跟着更新。
  window.addEventListener('storage', (e: StorageEvent) => { if (e.key === STORAGE_KEY) void composerDrafts.hydrate(); });
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushNow(); });
}

/** 会话的草稿键;没登录(没有 serverUrl)→ null,不存。 */
export const conversationDraftKey = (cfg: Pick<HubConfig, 'serverUrl' | 'username' | 'profileId' | 'networkId'> | null | undefined, conversation: DraftConversation): string | null =>
  cfg?.serverUrl ? draftKey(cfg, conversation) : null;

/** 会话列表:草稿有变化(落盘 / 另一个窗口改了)时重渲染。 */
export const useDraftsVersion = (): number =>
  useSyncExternalStore(composerDrafts.subscribe, composerDrafts.version, composerDrafts.version);

export const draftTextFor = (key: string | null): string => (key ? composerDrafts.get(key) : '');

// ── 选了还没发的附件:只在本次运行的内存里按会话留着(切走再回来还在;重启 app 不保留 ——
//    网页的 blob: 地址 / 手机的临时文件过了这次运行就不可靠)。
const attachmentStash = new Map<string, PickedImage[]>();
export const stashDraftAttachments = (key: string | null, list: PickedImage[]): void => {
  if (!key) return;
  if (list.length) attachmentStash.set(key, list); else attachmentStash.delete(key);
};
export const takeDraftAttachments = (key: string | null): PickedImage[] => {
  if (!key) return [];
  const list = attachmentStash.get(key) ?? [];
  attachmentStash.delete(key);
  return list;
};

export interface ComposerDraftHandle {
  /** 代替 useState 的 setDraft:用户改输入框走这里,顺带存草稿。 */
  setDraft: (text: string) => void;
  /**
   * 发送开始时调用(在清空输入框之前):输入框清空不删草稿,发成功再删,发失败留着 ——
   * 离开再回来,没发出去的字还在输入框里。返回的回调在发送有结果时调用。
   */
  holdForSend: (text: string) => (ok: boolean) => void;
}

/**
 * 输入框草稿:进会话放回、敲字去抖存、离开 / 切会话立刻存。key 变(主窗口复用同一个 ChatScreen 切会话)
 * 等同于「离开旧会话 + 进新会话」。
 */
export function useComposerDraft(key: string | null, draft: string, setDraftRaw: (text: string) => void): ComposerDraftHandle {
  const keyRef = useRef(key);
  keyRef.current = key;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const touchedRef = useRef(false);
  const holdRef = useRef<{ key: string; text: string } | null>(null);

  useLayoutEffect(() => {
    touchedRef.current = false;
    holdRef.current = null;
    setDraftRaw(key ? composerDrafts.get(key) : '');
    return () => { void composerDrafts.flush(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // 手机原生的草稿文件是异步读的:读完时用户还没动过输入框,就放回去。
  useEffect(() => composerDrafts.subscribe(() => {
    const k = keyRef.current;
    if (!k || touchedRef.current || draftRef.current) return;
    const stored = composerDrafts.get(k);
    if (stored) setDraftRaw(stored);
  }), [setDraftRaw]);

  const setDraft = useCallback((text: string) => {
    setDraftRaw(text);
    touchedRef.current = true;
    const k = keyRef.current;
    if (!k) return;
    const hold = holdRef.current;
    if (hold && hold.key === k && !hasDraftText(text)) return; // 发送中清空输入框:草稿留到发成功
    holdRef.current = null;
    composerDrafts.set(k, text);
  }, [setDraftRaw]);

  const holdForSend = useCallback((text: string) => {
    const k = keyRef.current;
    if (!k) return () => {};
    const hold = { key: k, text };
    holdRef.current = hold;
    return (ok: boolean) => {
      if (holdRef.current === hold) holdRef.current = null;
      // 发成功:草稿还是发出去的那段字才删(发送期间又敲了新字 → 那是新草稿,留着)。
      if (ok && composerDrafts.get(k).trim() === text.trim()) composerDrafts.remove(k);
    };
  }, []);

  return { setDraft, holdForSend };
}
