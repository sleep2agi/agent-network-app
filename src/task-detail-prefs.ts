// 任务详情「更多」展开没有:每台设备记一份(不分账号 —— 这是「我在这台机器上怎么看详情」)。
// 存法同 rules-editor-prefs.ts:web(Tauri 桌面 / web 导出)localStorage;原生端 documentDirectory 里一个小文件。
// 尽力而为:存不下就只活这一次会话。
import * as FileSystem from 'expo-file-system/legacy';
import { parseMoreOpen } from './task-detail-more';

export const DETAIL_MORE_KEY = 'task_detail_more_open_v1';
const FILE = () => `${FileSystem.documentDirectory}task_detail_prefs_v1.json`;

const webStorage = (): Storage | null => {
  try {
    const ls = (globalThis as any).localStorage as Storage | undefined;
    return ls && typeof ls.getItem === 'function' ? ls : null;
  } catch { return null; }
};


export async function loadDetailMoreOpen(): Promise<boolean | null> {
  const ls = webStorage();
  if (ls) { try { return parseMoreOpen(ls.getItem(DETAIL_MORE_KEY)); } catch { return null; } }
  try {
    if (!FileSystem.documentDirectory) return null;
    const info = await FileSystem.getInfoAsync(FILE());
    if (!info.exists) return null;
    return parseMoreOpen(JSON.parse(await FileSystem.readAsStringAsync(FILE()))?.[DETAIL_MORE_KEY]);
  } catch { return null; }
}

export async function saveDetailMoreOpen(open: boolean): Promise<void> {
  const ls = webStorage();
  if (ls) { try { ls.setItem(DETAIL_MORE_KEY, open ? '1' : '0'); } catch { /* session only */ } return; }
  try {
    if (!FileSystem.documentDirectory) return;
    await FileSystem.writeAsStringAsync(FILE(), JSON.stringify({ [DETAIL_MORE_KEY]: open ? '1' : '0' }));
  } catch { /* session only */ }
}
