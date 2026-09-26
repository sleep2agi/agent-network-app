// 「后台保持连接」(安卓,默认关)的 JS 面。
//
// 🔴 为什么是「前台服务 + 一个永不结束的 headless JS 任务」,而不是只起一个前台服务:
//    RN 在 Activity 进后台时暂停 JS 计时器(JavaTimerManager.onHostPause),只有 headless JS
//    任务在跑时才恢复。只起前台服务 = 进程活着,但 setTimeout 驱动的 hub 轮询照样停。
//    所以服务启动时顺带起一个 headless 任务(AnetKeepAliveService.getTaskConfig),它在 JS 里只是
//    等着被 stop;真正的轮询在 notifier-runtime.ts。
//
// 🔴 停的时候两边都要停:只停原生服务,JS 里那个任务的 Promise 还挂着 ⇒ RN 仍认为有 headless 任务
//    在跑 ⇒ 后台计时器照跑、白耗电。stopKeepAlive 先放掉 Promise 再停服务。
//
// 方案取舍(为什么不用 expo-task-manager / expo-background-fetch / 第三方库)写在
// docs/android-notifications.md。

import { AppRegistry, Platform } from 'react-native';
import { AnetKeepAlive } from '../modules/anet-keepalive';
import { KEEPALIVE_NOTIFICATION_TEXT } from './mobile-notify-model';

export const KEEPALIVE_TASK_NAME = 'AnetKeepAlive';

let release: (() => void) | null = null;
let taskActive = false;
let bootHook: (() => Promise<void>) | null = null;
let lastError: string | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

/** 原生模块在不在(老 APK / iOS / 网页上没有)。 */
export function keepAliveAvailable(): boolean {
  return Platform.OS === 'android' && !!AnetKeepAlive;
}

/** 前台服务此刻是否在跑(原生侧的真实状态,不是设置值)。 */
export function keepAliveRunning(): boolean {
  try { return !!AnetKeepAlive?.isRunning(); } catch { return false; }
}

/** headless 任务是否在跑 —— 在跑时后台的 JS 计时器才会走。 */
export function keepAliveTaskActive(): boolean {
  return taskActive;
}

export function subscribeKeepAlive(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 起服务。返回 null = 已起(或本来就在跑);否则是给人看的原因。 */
export function startKeepAlive(): string | null {
  if (!keepAliveAvailable()) { lastError = '当前安装包不支持(需要 0.2.107 或更新的安卓版)'; emit(); return lastError; }
  if (keepAliveRunning()) return null;
  let error: string | null = null;
  try { error = AnetKeepAlive!.start('Agent Network', KEEPALIVE_NOTIFICATION_TEXT); } catch (e) { error = String(e); }
  lastError = error;
  emit();
  return error;
}

/** 最近一次启动失败的原因(成功 / 停止后清空)。设置页显示它。 */
export function keepAliveLastError(): string | null {
  return lastError;
}

export function stopKeepAlive(): void {
  lastError = null;
  const r = release;
  release = null;
  r?.();
  try { AnetKeepAlive?.stop(); } catch { /* 服务已不在 */ }
  emit();
}

/**
 * 进程被系统重启、由服务直接拉起 headless 任务时(没有界面),通知运行时要自己从存储里恢复账号。
 * notifier-runtime.ts 在模块加载时登记。
 */
export function setKeepAliveBootHook(hook: (() => Promise<void>) | null): void {
  bootHook = hook;
}

async function keepAliveTask(): Promise<void> {
  taskActive = true;
  emit();
  try {
    try { await bootHook?.(); } catch { /* 恢复失败也要把任务挂住,服务的通知由用户在设置里关 */ }
    await new Promise<void>(resolve => { release = resolve; });
  } finally {
    taskActive = false;
    emit();
  }
}

/** index.ts 顶层调用一次(headless 任务必须在 AppRegistry 上登记,且早于服务启动)。 */
export function registerKeepAliveTask(): void {
  if (Platform.OS !== 'android') return;
  AppRegistry.registerHeadlessTask(KEEPALIVE_TASK_NAME, () => keepAliveTask);
}
