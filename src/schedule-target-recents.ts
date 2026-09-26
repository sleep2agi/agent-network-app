// 定时任务「执行节点」最近使用的存储后端(本设备)。逻辑(key、解析、置顶去重)在 node-picker-model.ts。
//
// 与 agent-list-prefs.ts / chat-pins.ts 同一套存法:web(Tauri 桌面 / 网页导出)用 localStorage,
// 原生落 documentDirectory 下一个小 JSON 文件(SecureStore 是存密钥的,Android 上还有大小上限)。
// 读写都是尽力而为:存不下就只在这一次会话里有效。
import * as FileSystem from 'expo-file-system/legacy';
import { loadRecents, rememberRecent, type RecentsStore } from './node-picker-model';

type Scope = { profileId?: string; serverUrl?: string; username?: string };

const webStorage = (): Storage | null => {
  try {
    const ls = (globalThis as any).localStorage as Storage | undefined;
    return ls && typeof ls.getItem === 'function' ? ls : null;
  } catch { return null; }
};

const fileFor = (key: string) => `${FileSystem.documentDirectory}${key}.json`;

const store = (): RecentsStore => {
  const ls = webStorage();
  if (ls) return { get: async k => ls.getItem(k), set: async (k, v) => { ls.setItem(k, v); } };
  return {
    get: async k => {
      if (!FileSystem.documentDirectory) return null;
      const info = await FileSystem.getInfoAsync(fileFor(k));
      return info.exists ? FileSystem.readAsStringAsync(fileFor(k)) : null;
    },
    set: async (k, v) => { if (FileSystem.documentDirectory) await FileSystem.writeAsStringAsync(fileFor(k), v); },
  };
};

export const loadScheduleTargetRecents = (cfg: Scope): Promise<string[]> => loadRecents(store(), cfg);
export const rememberScheduleTarget = (cfg: Scope, current: readonly string[], nodeId: string): string[] =>
  rememberRecent(store(), cfg, current, nodeId);
