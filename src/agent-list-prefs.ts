// Per-device agent list preferences: the two-pane list width (dragged divider) and which
// group headers are folded. Not per hub profile — both are about this screen, not an account.
//
// web (Tauri desktop and the web export): localStorage. Native: one small JSON file in
// documentDirectory (SecureStore is for secrets and is size-capped on Android; chat-pins.ts
// and storage.ts use the same directory for the same reason). Every read and write is
// best-effort: a preference we cannot store just lasts for this session.
import * as FileSystem from 'expo-file-system/legacy';
import { parseCollapsed } from './agents-list';
import { parseConversationTab, type ConversationTab } from './conversation-tab';
import { parseStoredListWidth } from './wide-layout';

export const LIST_WIDTH_KEY = 'agent_list_pane_width_v1';
export const COLLAPSED_KEY = 'agent_list_collapsed_v1';
export const CONVERSATION_TAB_KEY = 'agent_list_tab_v1';
// 折叠屏 / 平板左侧导航的形态:纯图标(对齐桌面,0.296 起的默认)还是「图标 + 文字」。
// admin 2026-10-24 问「跟桌面端不太一样」,但这是口味问题,给个开关比替他决定好。
export const RAIL_LABELS_KEY = 'agent_list_rail_labels_v1';
export type RailLabels = 'icons' | 'labels';
const PREFS_FILE = () => `${FileSystem.documentDirectory}agent_list_prefs_v1.json`;

type Prefs = { [LIST_WIDTH_KEY]?: string; [COLLAPSED_KEY]?: string; [CONVERSATION_TAB_KEY]?: string; [RAIL_LABELS_KEY]?: string };

const webStorage = (): Storage | null => {
  try {
    const ls = (globalThis as any).localStorage as Storage | undefined;
    return ls && typeof ls.getItem === 'function' ? ls : null;
  } catch { return null; }
};

async function readNative(): Promise<Prefs> {
  try {
    if (!FileSystem.documentDirectory) return {};
    const info = await FileSystem.getInfoAsync(PREFS_FILE());
    if (!info.exists) return {};
    const v = JSON.parse(await FileSystem.readAsStringAsync(PREFS_FILE()));
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
}

// Writes are chained so two quick saves (width, then a fold) cannot interleave their
// read-modify-write and drop one of them.
let nativeWrite: Promise<unknown> = Promise.resolve();

async function readKey(key: keyof Prefs): Promise<string | null> {
  const ls = webStorage();
  if (ls) { try { return ls.getItem(key); } catch { return null; } }
  await nativeWrite;
  return (await readNative())[key] ?? null;
}

function writeKey(key: keyof Prefs, value: string): Promise<void> {
  const ls = webStorage();
  if (ls) { try { ls.setItem(key, value); } catch { /* session only */ } return Promise.resolve(); }
  const next = nativeWrite.then(async () => {
    if (!FileSystem.documentDirectory) return;
    const prefs = await readNative();
    prefs[key] = value;
    await FileSystem.writeAsStringAsync(PREFS_FILE(), JSON.stringify(prefs));
  }).catch(() => { /* session only */ });
  nativeWrite = next;
  return next;
}

export const parseRailLabels = (v: string | null | undefined): RailLabels => (v === 'labels' ? 'labels' : 'icons');
export const loadRailLabels = async (): Promise<RailLabels> => {
  const v = parseRailLabels(await readKey(RAIL_LABELS_KEY));
  if (v !== railLabelsMemo) { railLabelsMemo = v; railListeners.forEach(fn => fn(v)); }
  return v;
};
export const saveRailLabels = (v: RailLabels): Promise<void> => writeKey(RAIL_LABELS_KEY, parseRailLabels(v));

// 进程内的小 store(与 ui-scale 同款做法):设置页改完,App 里那条 rail 立刻跟着变,不用重挂整棵树。
let railLabelsMemo: RailLabels = 'icons';
const railListeners = new Set<(v: RailLabels) => void>();
export const railLabelsNow = (): RailLabels => railLabelsMemo;
export const onRailLabelsChange = (fn: (v: RailLabels) => void): (() => void) => { railListeners.add(fn); return () => { railListeners.delete(fn); }; };
export const setRailLabels = (v: RailLabels): void => {
  const next = parseRailLabels(v);
  if (next === railLabelsMemo) { void saveRailLabels(next); return; }
  railLabelsMemo = next;
  railListeners.forEach(fn => fn(next));
  void saveRailLabels(next);
};

/** null = never saved (use LIST_PANE_DEFAULT_WIDTH). */
export const loadListPaneWidth = async (): Promise<number | null> => parseStoredListWidth(await readKey(LIST_WIDTH_KEY));
export const saveListPaneWidth = (width: number): Promise<void> =>
  parseStoredListWidth(String(width)) === null ? Promise.resolve() : writeKey(LIST_WIDTH_KEY, String(Math.round(width)));

export const loadCollapsedGroups = async (): Promise<string[]> => parseCollapsed(await readKey(COLLAPSED_KEY));
export const saveCollapsedGroups = (titles: readonly string[]): Promise<void> => writeKey(COLLAPSED_KEY, JSON.stringify(parseCollapsed([...titles])));

// 「全部 / 未读」(conversation-tab.ts),每台设备各记各的。
// 手机上打开会话会卸载列表,回来时重新挂载:内存里留一份上次的值,重新挂载那一帧就用它,
// 不先画「全部」再跳成「未读」。null = 本进程还没读过存储。
let tabMemo: ConversationTab | null = null;
export const peekConversationTab = (): ConversationTab | null => {
  if (tabMemo) return tabMemo;
  // web(Tauri 桌面 / web 导出)的 localStorage 是同步的:首次挂载那一帧就能拿到,不闪。
  const ls = webStorage();
  if (!ls) return null;
  try { tabMemo = parseConversationTab(ls.getItem(CONVERSATION_TAB_KEY)); } catch { return null; }
  return tabMemo;
};
export const loadConversationTab = async (): Promise<ConversationTab> => {
  if (tabMemo) return tabMemo;
  tabMemo = parseConversationTab(await readKey(CONVERSATION_TAB_KEY));
  return tabMemo;
};
export const saveConversationTab = (tab: ConversationTab): Promise<void> => {
  tabMemo = tab;
  return writeKey(CONVERSATION_TAB_KEY, tab);
};
