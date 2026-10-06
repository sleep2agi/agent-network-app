// 「当前密码过于简单」标记的运行时绑定(逻辑在 weak-password-flag-core.ts,有测试)。
// 存法同 rules-editor-prefs.ts:web(Tauri 桌面 / web 导出)localStorage;原生端 documentDirectory 里一个小 JSON。
// 桌面端设置是独立窗口:那边改完密码清掉标记,主窗口经 localStorage 的 storage 事件重读,横幅随之消失。
import * as FileSystem from 'expo-file-system/legacy';
import { useEffect, useSyncExternalStore } from 'react';
import { createWeakPasswordFlags, WEAK_PASSWORD_STORAGE_KEY, type AccountRef } from './weak-password-flag-core';

const nativeFile = () => `${FileSystem.documentDirectory}weak_password_v1.json`;

const webStorage = (): Storage | null => {
  try {
    const ls = (globalThis as any).localStorage as Storage | undefined;
    return ls && typeof ls.getItem === 'function' ? ls : null;
  } catch { return null; }
};

export const weakPasswordFlags = createWeakPasswordFlags({
  get: async (key) => {
    const ls = webStorage();
    if (ls) { try { return ls.getItem(key); } catch { return null; } }
    try {
      if (!FileSystem.documentDirectory) return null;
      const info = await FileSystem.getInfoAsync(nativeFile());
      return info.exists ? await FileSystem.readAsStringAsync(nativeFile()) : null;
    } catch { return null; }
  },
  set: async (key, value) => {
    const ls = webStorage();
    if (ls) { try { ls.setItem(key, value); } catch { /* session only */ } return; }
    if (!FileSystem.documentDirectory) return;
    await FileSystem.writeAsStringAsync(nativeFile(), value);
  },
});

let hydrated = false;
function ensureHydrated() {
  if (hydrated) return;
  hydrated = true;
  void weakPasswordFlags.hydrate();
  const win = (globalThis as any).window;
  if (win?.addEventListener) {
    win.addEventListener('storage', (event: StorageEvent) => {
      if (event.key === WEAK_PASSWORD_STORAGE_KEY || event.key === null) void weakPasswordFlags.hydrate();
    });
  }
}

/** 这个账号的密码是不是被 hub 判成了太简单(登录时)。 */
export function useWeakPassword(ref: AccountRef | null | undefined): boolean {
  useEffect(ensureHydrated, []);
  useSyncExternalStore(weakPasswordFlags.subscribe, weakPasswordFlags.snapshot, weakPasswordFlags.snapshot);
  return weakPasswordFlags.isFlagged(ref);
}
