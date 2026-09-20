// 0.2.76 新消息系统通知 + 提示音(Vincent 2026-09-17:「有新消息做个提示 类似飞书这样,再做个消息提示音」)。
// 数据源 = unread-store 的快照(user_inbox 行 + 发给我的 inbox 回复行),不另开轮询;
// 首份快照只登记不提醒(登录时的历史不该弹一屏)。人正开着那个会话且窗口在前台 → 不提醒;
// 免打扰时段 → 不提醒;提示音可关。系统通知走 @tauri-apps/plugin-notification(桌面),
// 网页端退回 Web Notification;手机端不挂这个组件。

import { useEffect, useRef } from 'react';
import { playChime } from './chime';
import { loadNotifySettings } from './notify-settings';
import {
  decide,
  fromInboxRows,
  fromUserMessages,
  groupByAgent,
  initialSeen,
  notificationTitle,
  pickNew,
  type Presence,
  type SeenState,
} from './notify-policy';
import { localMinutes } from './quiet-hours';
import { plainTextForNotification } from './notify-text';
import { initialNotifyTarget, recordNotified, targetOnFocus, type NotifyTargetState } from './notify-target';
import { getUnreadSnapshot, subscribeUnread, type UnreadStoreSnapshot } from './unread-store';

const isTauri = () => !!(globalThis as any).__TAURI_INTERNALS__;

export function presenceOf(snap: UnreadStoreSnapshot): Presence {
  const focused = typeof document !== 'undefined' && typeof (document as any).hasFocus === 'function'
    ? (document as any).hasFocus() as boolean
    : snap.ledger.foreground;
  return { windowFocused: focused, openConversation: snap.ledger.open };
}

async function sendSystemNotification(title: string, body: string): Promise<void> {
  if (isTauri()) {
    const n = await import('@tauri-apps/plugin-notification');
    let granted = await n.isPermissionGranted();
    if (!granted) granted = (await n.requestPermission()) === 'granted';
    if (!granted) return;
    n.sendNotification({ title, body });
    return;
  }
  const N = (globalThis as any).Notification as (new (t: string, o?: { body?: string }) => unknown) & { permission?: string; requestPermission?: () => Promise<string> } | undefined;
  if (typeof N !== 'function') return;
  let permission = N.permission;
  if (permission === 'default' && N.requestPermission) permission = await N.requestPermission();
  if (permission !== 'granted') return;
  new N(title, { body });
}

export default function DesktopNotifier({ onOpenChat }: { onOpenChat?: (alias: string) => void } = {}) {
  const seen = useRef<SeenState>(initialSeen());
  const target = useRef<NotifyTargetState>(initialNotifyTarget());
  const openChat = useRef(onOpenChat);
  openChat.current = onOpenChat;

  // 通知点击 → 跳会话。插件在桌面端不回发点击事件(见 notify-target.ts 顶部),
  // 能观测到的是「通知之后窗口被带到前台」——Windows 的 toast 属于应用的 AUMID,点它会激活应用。
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const onFocus = () => {
      const picked = targetOnFocus(target.current, Date.now());
      target.current = picked.next;
      if (picked.agent) openChat.current?.(picked.agent);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  useEffect(() => {
    const onSnapshot = () => {
      const snap = getUnreadSnapshot();
      // 登录后第一份快照可能还没拉到 user_inbox(serverBody 为空)——那时登记会把随后到达的
      // 历史行当成「新消息」弹一屏;等 serverBody 有了再登记首份。
      if (!seen.current.seeded && !snap.serverBody) return;
      const body = snap.serverBody as { messages?: any[] } | null;
      const incoming = [
        ...fromUserMessages(Array.isArray(body?.messages) ? body!.messages : []),
        ...fromInboxRows(snap.replyRows, snap.replyUsername),
      ];
      const picked = pickNew(seen.current, incoming, Date.now());
      seen.current = picked.seen;
      if (!picked.toNotify.length) return;
      const settings = loadNotifySettings();
      const presence = presenceOf(snap);
      const minutes = localMinutes();
      let ring = false;
      for (const group of groupByAgent(picked.toNotify)) {
        const d = decide(group.agent, presence, settings, minutes);
        if (!d.notify) continue;
        ring = ring || d.sound;
        // 正文里可能是 Markdown(链接语法 + 绝对路径),toast 只读得下一两行 → 压成纯文本。
        void sendSystemNotification(
          notificationTitle(group.agent, group.count),
          plainTextForNotification(group.body),
        ).catch(() => { /* 权限被拒/平台不支持 */ });
        target.current = recordNotified(target.current, group.agent, Date.now(), presence.windowFocused);
      }
      if (ring) playChime();
    };
    onSnapshot();
    return subscribeUnread(onSnapshot);
  }, []);
  return null;
}
