// 本机上次下载成功的来源(内部,不展示),按设备存;顺带删掉 0.2.121 遗留的「下载线路」偏好(同 agent-list-prefs.ts 的做法):
// web / Tauri 桌面壳 → localStorage;原生 → documentDirectory 下一个小 JSON 文件。
// expo-file-system 惰性 import:这个文件会被 android-updater.ts 引用,而后者在 ck 测试(bun)里加载,
// 原生模块在那里加载不了。任何读写失败都只影响「记不住」,不影响更新本身。
import { createRoutePrefsStore, type RouteStorage } from './update-route';

const FILE_NAME = 'update_route_prefs_v1.json';

const webStorage = (): Storage | null => {
  try {
    const ls = (globalThis as any).localStorage as Storage | undefined;
    return ls && typeof ls.getItem === 'function' ? ls : null;
  } catch { return null; }
};

async function nativeFs(): Promise<any | null> {
  try {
    const FileSystem = await import('expo-file-system/legacy');
    return FileSystem.documentDirectory ? FileSystem : null;
  } catch { return null; }
}

async function readNative(): Promise<Record<string, string>> {
  const FileSystem = await nativeFs();
  if (!FileSystem) return {};
  try {
    const path = `${FileSystem.documentDirectory}${FILE_NAME}`;
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return {};
    const v = JSON.parse(await FileSystem.readAsStringAsync(path));
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
}

let nativeWrite: Promise<unknown> = Promise.resolve();

export const deviceRouteStorage: RouteStorage = {
  async get(key) {
    const ls = webStorage();
    if (ls) { try { return ls.getItem(key); } catch { return null; } }
    await nativeWrite;
    return (await readNative())[key] ?? null;
  },
  set(key, value) {
    const ls = webStorage();
    if (ls) { try { ls.setItem(key, value); } catch { /* 本次会话有效 */ } return Promise.resolve(); }
    // 串行化读-改-写:连着存「偏好」和「上次成功」不能互相覆盖。
    const next = nativeWrite.then(async () => {
      const FileSystem = await nativeFs();
      if (!FileSystem) return;
      const prefs = await readNative();
      prefs[key] = value;
      await FileSystem.writeAsStringAsync(`${FileSystem.documentDirectory}${FILE_NAME}`, JSON.stringify(prefs));
    }).catch(() => { /* 本次会话有效 */ });
    nativeWrite = next;
    return next as Promise<void>;
  },
  remove(key) {
    const ls = webStorage();
    if (ls) { try { ls.removeItem(key); } catch { /* 无所谓 */ } return Promise.resolve(); }
    const next = nativeWrite.then(async () => {
      const FileSystem = await nativeFs();
      if (!FileSystem) return;
      const prefs = await readNative();
      if (!(key in prefs)) return;
      delete prefs[key];
      await FileSystem.writeAsStringAsync(`${FileSystem.documentDirectory}${FILE_NAME}`, JSON.stringify(prefs));
    }).catch(() => { /* 无所谓 */ });
    nativeWrite = next;
    return next as Promise<void>;
  },
};

/** 全局唯一的「上次成功来源」store。 */
export const routePrefs = createRoutePrefsStore(deviceRouteStorage);
