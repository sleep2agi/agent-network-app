// 手机端系统通知的副作用层:expo-notifications(本地通知,不走任何推送服务 —— 小米/HyperOS
// 没有 Google Play 服务,FCM 不可用;本地通知不依赖它)。只在 android / ios 上调用;
// 桌面端仍走 DesktopNotifier(@tauri-apps/plugin-notification),互不相干。
//
// 什么时候发、发什么在 mobile-notify-model.ts / notify-policy.ts(纯逻辑、有测试)。

import { Platform } from 'react-native';
import { ANDROID_PACKAGE } from './android-update-core';
import {
  MESSAGE_CHANNEL_ID,
  MESSAGE_CHANNEL_NAME,
  QUIET_CHANNEL_ID,
  QUIET_CHANNEL_NAME,
  type PermissionStatus,
  type PostPlan,
} from './mobile-notify-model';

type NotificationsModule = typeof import('expo-notifications');

export const mobileNotificationsSupported = (): boolean => Platform.OS === 'android' || Platform.OS === 'ios';

let modPromise: Promise<NotificationsModule> | null = null;
function mod(): Promise<NotificationsModule> {
  if (!modPromise) modPromise = import('expo-notifications');
  return modPromise;
}

let setupPromise: Promise<void> | null = null;

/** 前台展示策略 + 安卓渠道。幂等;安卓 13+ 要先有渠道再请求权限。 */
export function ensureNotificationSetup(): Promise<void> {
  if (!mobileNotificationsSupported()) return Promise.resolve();
  if (setupPromise) return setupPromise;
  setupPromise = (async () => {
    const N = await mod();
    // 该不该发由我们自己判(decide),发出来的一律展示 —— 应用在前台时系统默认不弹横幅。
    N.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    });
    if (Platform.OS === 'android') {
      await N.setNotificationChannelAsync(MESSAGE_CHANNEL_ID, {
        name: MESSAGE_CHANNEL_NAME,
        description: 'agent 发来新消息时提醒',
        importance: N.AndroidImportance.HIGH,
        vibrationPattern: [0, 200, 120, 200],
        lockscreenVisibility: N.AndroidNotificationVisibility.PRIVATE,
        showBadge: true,
      });
      await N.setNotificationChannelAsync(QUIET_CHANNEL_ID, {
        name: QUIET_CHANNEL_NAME,
        description: '「仅新消息」模式或提示音关闭时:只更新通知,不响铃',
        importance: N.AndroidImportance.LOW,
        sound: null,
        vibrationPattern: null,
        enableVibrate: false,
        lockscreenVisibility: N.AndroidNotificationVisibility.PRIVATE,
        showBadge: true,
      });
    }
  })().catch(error => {
    setupPromise = null;
    throw error;
  });
  return setupPromise;
}

export async function notificationPermission(): Promise<{ status: PermissionStatus; canAskAgain: boolean }> {
  if (!mobileNotificationsSupported()) return { status: 'denied', canAskAgain: false };
  const N = await mod();
  const p = await N.getPermissionsAsync();
  return { status: p.status as PermissionStatus, canAskAgain: p.canAskAgain !== false };
}

export async function requestNotificationPermission(): Promise<PermissionStatus> {
  if (!mobileNotificationsSupported()) return 'denied';
  await ensureNotificationSetup();
  const N = await mod();
  const p = await N.requestPermissionsAsync();
  return p.status as PermissionStatus;
}

/** 发一条(同 identifier = 原地更新那条)。 */
export async function postNotification(plan: Pick<PostPlan, 'identifier' | 'title' | 'body' | 'channelId' | 'alert' | 'data'>): Promise<void> {
  if (!mobileNotificationsSupported()) return;
  await ensureNotificationSetup();
  const N = await mod();
  await N.scheduleNotificationAsync({
    identifier: plan.identifier,
    content: {
      title: plan.title,
      body: plan.body,
      data: plan.data,
      sound: plan.alert ? 'default' : false,
      // 安卓:点了就收起;打开会话时我们再按 identifier 清一次(见 notifier-runtime)。
      autoDismiss: true,
    },
    trigger: Platform.OS === 'android' ? { channelId: plan.channelId } : null,
  });
}

export async function dismissNotification(identifier: string): Promise<void> {
  if (!mobileNotificationsSupported()) return;
  const N = await mod();
  await N.dismissNotificationAsync(identifier).catch(() => undefined);
}

export type TapHandler = (data: unknown, responseKey: string) => void;

function responseKeyOf(r: { notification: { request: { identifier: string }; date: number } }): string {
  return `${r.notification.request.identifier}@${r.notification.date}`;
}

/** 点通知(应用在跑时)+ 冷启动时启动应用的那一次点击。返回取消订阅。 */
export async function subscribeNotificationTaps(onTap: TapHandler): Promise<() => void> {
  if (!mobileNotificationsSupported()) return () => {};
  const N = await mod();
  const sub = N.addNotificationResponseReceivedListener(r => onTap(r.notification.request.content.data, responseKeyOf(r)));
  try {
    const last = N.getLastNotificationResponse();
    if (last) onTap(last.notification.request.content.data, responseKeyOf(last));
  } catch { /* 取不到就算了 */ }
  return () => sub.remove();
}

export async function clearLastNotificationTap(): Promise<void> {
  if (!mobileNotificationsSupported()) return;
  const N = await mod();
  try { N.clearLastNotificationResponse(); } catch { /* 老版本没有 */ }
}

// ── 系统设置页 ──
type IntentExtras = { data?: string; extra?: Record<string, unknown>; packageName?: string; className?: string };
async function startActivity(action: string, params: IntentExtras): Promise<boolean> {
  try {
    const IntentLauncher = await import('expo-intent-launcher');
    await IntentLauncher.startActivityAsync(action, params as any);
    return true;
  } catch {
    return false;
  }
}

/** 本应用的「应用详情」页 —— HyperOS 上「自启动」和「省电策略」都在这一页里。 */
export async function openAppDetailsSettings(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await startActivity('android.settings.APPLICATION_DETAILS_SETTINGS', { data: `package:${ANDROID_PACKAGE}` });
}

/** 本应用的通知设置页(权限被永久拒绝后,只能让人去这里开)。 */
export async function openAppNotificationSettings(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const ok = await startActivity('android.settings.APP_NOTIFICATION_SETTINGS', {
    extra: { 'android.provider.extra.APP_PACKAGE': ANDROID_PACKAGE },
  });
  if (!ok) await openAppDetailsSettings();
}

/**
 * 小米安全中心的「自启动管理」。MIUI / HyperOS 的私有页面,换 ROM 版本可能不存在 → 退回应用详情页。
 */
export async function openXiaomiAutostartSettings(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const ok = await startActivity('android.intent.action.MAIN', {
    packageName: 'com.miui.securitycenter',
    className: 'com.miui.permcenter.autostart.AutoStartManagementActivity',
  });
  if (!ok) await openAppDetailsSettings();
}
