// 手机端通知设置的落盘:documentDirectory 下一个小 JSON 文件(与 agent-list-prefs / chat-pins
// 同一种存法 —— SecureStore 是给凭据的,且在安卓上有大小上限)。读写都是尽力而为:
// 存不下的设置只在本次运行有效。解析与默认值在 notify-settings.ts(纯逻辑,有测试)。
import * as FileSystem from 'expo-file-system/legacy';
import { hydrateNotifySettings, notifySettingsHydrated, type NotifySettings } from './notify-settings';

const FILE = () => `${FileSystem.documentDirectory}notify_settings_v1.json`;

let pending: Promise<NotifySettings> | null = null;
let writeChain: Promise<unknown> = Promise.resolve();

function write(json: string): void {
  writeChain = writeChain
    .then(() => (FileSystem.documentDirectory ? FileSystem.writeAsStringAsync(FILE(), json) : undefined))
    .catch(() => { /* session only */ });
}

/** 读一次文件、交给 notify-settings;并发调用共用同一个 Promise。 */
export function hydrateNativeNotifySettings(): Promise<NotifySettings> {
  if (pending) return pending;
  pending = (async () => {
    let raw: string | null = null;
    try {
      if (FileSystem.documentDirectory) {
        const info = await FileSystem.getInfoAsync(FILE());
        if (info.exists) raw = await FileSystem.readAsStringAsync(FILE());
      }
    } catch { raw = null; }
    return hydrateNotifySettings(raw, write);
  })();
  return pending;
}

export { notifySettingsHydrated };
