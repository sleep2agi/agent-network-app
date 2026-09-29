// 规则文件编辑器的本机偏好:上次选的模式(阅读 / 编辑 / 左右)、左右分栏的比例、滚动同步开关、
// 全屏目录收起没有。每台设备一份,不分 hub 账号 —— 这是「我在这台机器上怎么看文件」,不是账号数据。
//
// 存法同 agent-list-prefs.ts:web(Tauri 桌面 / web 导出)localStorage;原生端 documentDirectory 里
// 一个小 JSON。读写都是尽力而为:存不下的偏好只活这一次会话。键和解析在 rules-split.ts(有测试)。
import * as FileSystem from 'expo-file-system/legacy';
import { rulesEditorPrefs } from './rules-split';

const PREFS_FILE = () => `${FileSystem.documentDirectory}rules_editor_prefs_v1.json`;

const webStorage = (): Storage | null => {
  try {
    const ls = (globalThis as any).localStorage as Storage | undefined;
    return ls && typeof ls.getItem === 'function' ? ls : null;
  } catch { return null; }
};

async function readNative(): Promise<Record<string, string>> {
  try {
    if (!FileSystem.documentDirectory) return {};
    const info = await FileSystem.getInfoAsync(PREFS_FILE());
    if (!info.exists) return {};
    const v = JSON.parse(await FileSystem.readAsStringAsync(PREFS_FILE()));
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
}

// 连着两次写(先拖比例、再切模式)串起来,读-改-写不会互相覆盖。
let nativeWrite: Promise<unknown> = Promise.resolve();

const prefs = rulesEditorPrefs({
  get: async (key) => {
    const ls = webStorage();
    if (ls) { try { return ls.getItem(key); } catch { return null; } }
    await nativeWrite;
    return (await readNative())[key] ?? null;
  },
  set: (key, value) => {
    const ls = webStorage();
    if (ls) { try { ls.setItem(key, value); } catch { /* session only */ } return Promise.resolve(); }
    const next = nativeWrite.then(async () => {
      if (!FileSystem.documentDirectory) return;
      const all = await readNative();
      all[key] = value;
      await FileSystem.writeAsStringAsync(PREFS_FILE(), JSON.stringify(all));
    }).catch(() => { /* session only */ });
    nativeWrite = next;
    return next;
  },
});

export const loadRulesEditorPrefs = prefs.load;
export const saveRulesMode = prefs.saveMode;
export const saveRulesSplitRatio = prefs.saveRatio;
export const saveRulesScrollSync = prefs.saveScrollSync;
export const saveRulesOutlineOpen = prefs.saveOutlineOpen;
