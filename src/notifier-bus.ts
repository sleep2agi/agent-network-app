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
