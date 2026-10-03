// 手机通知的「现在就去拉一次」信号。Hub 的用户 SSE(/events/users/me)推 desktop_message 时,
// DesktopMessageListener 已经连着那条流 —— 不再为通知另开一条,只在它收到事件时敲一下这里。
// 纯模块(不 import react-native);没有登记处理者(桌面端)时是空操作。
let handler: (() => void) | null = null;

export function setNotifierRefreshHandler(next: (() => void) | null): void {
  handler = next;
}

export function requestNotifierRefresh(): void {
  try { handler?.(); } catch { /* 通知是附带功能,不能打断 SSE 消费 */ }
}

// #499:「任务提醒」发的到期提醒(system-notice.ts)不进 agent 链路,轮询那边分组通知看不到它。
// DesktopMessageListener 收到这种事件时把解析好的 notice 交到这里;手机通知运行时 / 桌面 DesktopNotifier
// 登记处理者,自己判要不要发系统通知。没人登记(独立聊天窗)= 空操作。
export type SystemNoticeEvent = {
  messageId: string;
  message: string;
  title?: string | null;
  from?: string | null;
  kind?: string | null;
  createdAt?: string | null;
  taskNotice?: { requirementId: string; networkId: string | null } | null;
};
const systemNoticeHandlers = new Set<(n: SystemNoticeEvent) => void>();

export function subscribeSystemNotice(fn: (n: SystemNoticeEvent) => void): () => void {
  systemNoticeHandlers.add(fn);
  return () => { systemNoticeHandlers.delete(fn); };
}

export function emitSystemNotice(n: SystemNoticeEvent): void {
  for (const fn of systemNoticeHandlers) {
    try { fn(n); } catch { /* 通知是附带功能,不能打断 SSE 消费 */ }
  }
}
