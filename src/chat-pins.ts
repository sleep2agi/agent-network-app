// app#168 —— 会话置顶(列表排序层的「置顶」,与桌面窗口的 always-on-top 无关)跨平台持久化。
// 桌面端沿用 desktop-chat-menu 的 localStorage(按 profileId 分 key);手机端没有 localStorage,
// 落到 documentDirectory 的 JSON 文件,同样按 profile 分 —— 两个 Hub 上同名 alias 的置顶互不影响。
import * as FileSystem from 'expo-file-system/legacy';
import { loadPinnedChats, savePinnedChats } from './desktop-chat-menu';
import { pinScopeKey, togglePinned } from './chat-pins-core';

const isDesktop = () => typeof globalThis !== 'undefined' && !!(globalThis as any).__TAURI_INTERNALS__;

export { pinScopeKey, togglePinned };

const pinsFile = (scope: string) => `${FileSystem.documentDirectory}chat_pins_v1_${scope}.json`;

export async function loadChatPins(cfg: { profileId?: string; serverUrl?: string; username?: string }): Promise<string[]> {
  if (isDesktop()) return loadPinnedChats(cfg.profileId);
  try {
    const file = pinsFile(pinScopeKey(cfg));
    const info = await FileSystem.getInfoAsync(file);
    if (!info.exists) return [];
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(file));
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** 返回是否真的落盘了;手机端写失败要让调用方知道(#168 评论:以前静默吞掉,UI 显示置顶、重启后丢)。 */
export async function saveChatPins(aliases: readonly string[], cfg: { profileId?: string; serverUrl?: string; username?: string }): Promise<boolean> {
  if (isDesktop()) { savePinnedChats([...aliases], cfg.profileId); return true; }
  await FileSystem.writeAsStringAsync(pinsFile(pinScopeKey(cfg)), JSON.stringify([...new Set(aliases)]));
  return true;
}
