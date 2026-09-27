// 快捷键偏好的本机存储 + 两个小的进程内信号(录入中 / 请求聚焦 agent 搜索)。
//
// 快捷键只在桌面端 / 网页出现,所以只落 localStorage(与 desktop-theme-storage.ts、agent-list-prefs.ts
// 的 web 分支同一套做法);原生没有 localStorage 就只在本次运行有效 —— 手机上本来也没有这个设置页。
// 读写都尽力而为。模型(默认值、校验、格式)在 shortcuts-model.ts。
import { EMPTY_PREFS, isMacLike, parseShortcutPrefs, resolveBindings, serializeShortcutPrefs, type SendKey, type ShortcutId, type ShortcutPrefs } from './shortcuts-model';

export const SHORTCUTS_KEY = 'keyboard_shortcuts_v1';

const webStorage = (): Storage | null => {
  try {
    const ls = (globalThis as any).localStorage as Storage | undefined;
    return ls && typeof ls.getItem === 'function' ? ls : null;
  } catch { return null; }
};

let prefs: ShortcutPrefs | null = null;
let bindings: Record<ShortcutId, string> | null = null;
const listeners = new Set<() => void>();

/** useSyncExternalStore 的快照:同一份没变就是同一个对象。 */
export function shortcutPrefs(): ShortcutPrefs {
  if (!prefs) {
    let raw: string | null = null;
    try { raw = webStorage()?.getItem(SHORTCUTS_KEY) ?? null; } catch { raw = null; }
    prefs = raw ? parseShortcutPrefs(raw) : EMPTY_PREFS;
  }
  return prefs;
}

export function shortcutBindings(): Record<ShortcutId, string> {
  if (!bindings) bindings = resolveBindings(shortcutPrefs());
  return bindings;
}

export const sendKeyPref = (): SendKey => shortcutPrefs().sendKey;

export function subscribeShortcuts(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function saveShortcutPrefs(next: ShortcutPrefs): void {
  prefs = next;
  bindings = null;
  try { webStorage()?.setItem(SHORTCUTS_KEY, serializeShortcutPrefs(next)); } catch { /* session only */ }
  for (const l of listeners) l();
}

/** 测试用:丢掉内存里的缓存,下次从存储重读。 */
export function __reloadShortcutPrefs(): void { prefs = null; bindings = null; }

// ── 录入中:设置页正在等「按下新组合」时,全局快捷键不执行(否则按 ⌘1 会直接跳走)。 ──
let capturing = false;
export const shortcutCaptureActive = (): boolean => capturing;
export function setShortcutCaptureActive(v: boolean): void { capturing = v; }

// ── ⌘K:请求聚焦 agent 列表的搜索框。 ──
// 可能要先切回 Agents 页,列表还没挂上;所以挂一个「待处理」标记,列表挂上时自己来取。
let searchFocusPending = false;
const searchListeners = new Set<() => void>();
export function requestAgentSearchFocus(): void {
  searchFocusPending = true;
  for (const l of searchListeners) l();
}
export function consumeAgentSearchFocus(): boolean {
  const was = searchFocusPending;
  searchFocusPending = false;
  return was;
}
export function subscribeAgentSearchFocus(listener: () => void): () => void {
  searchListeners.add(listener);
  return () => { searchListeners.delete(listener); };
}

/** 键帽显示 ⌘ 还是 Ctrl:看 navigator(Tauri 的 WKWebView 报 MacIntel)。原生 / 拿不到 → 非 mac。 */
export function isMacKeyboard(): boolean {
  const nav = (globalThis as any).navigator as { platform?: string; userAgent?: string } | undefined;
  return isMacLike(`${nav?.platform ?? ''} ${nav?.userAgent ?? ''}`);
}
