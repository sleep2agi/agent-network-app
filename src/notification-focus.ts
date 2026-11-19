// #1543 —— 点「新消息」系统通知要落到**那条**消息上(以前只打开 agent 会话)。
//
// 两条通知链路各走各的:
//   · 手机(Expo):通知 `data` 里直接带 `messageId`(见 mobile-notify-model.routeTargetFromNotificationData);
//   · 桌面(Tauri):Rust 的 `show_chat_notification` 点正文只回传一个 alias 字符串(`tray-open-chat`),
//     没法加字段 —— 所以照 `due-reminder-notify.taskOpenAlias` 的老办法,把消息 id 编进这个字符串。
//
// 前缀刻意不用 `anet-task:`:托盘那套先解析任务,再落到这里,最后才是裸 alias(托盘菜单点一行)。
// 解码失败一律返回 null → 调用方按「只打开会话」处理,不报错。

export const CHAT_FOCUS_PREFIX = 'anet-chat:';

export function chatFocusAlias(agent: string, messageId: string): string {
  return `${CHAT_FOCUS_PREFIX}${encodeURIComponent(agent)}:${encodeURIComponent(messageId)}`;
}

export function parseChatFocusAlias(alias: string): { agent: string; messageId: string } | null {
  if (typeof alias !== 'string' || !alias.startsWith(CHAT_FOCUS_PREFIX)) return null;
  const rest = alias.slice(CHAT_FOCUS_PREFIX.length);
  const i = rest.indexOf(':');
  if (i <= 0) return null;
  try {
    const agent = decodeURIComponent(rest.slice(0, i)).trim();
    const messageId = decodeURIComponent(rest.slice(i + 1)).trim();
    return agent && messageId ? { agent, messageId } : null;
  } catch {
    return null;
  }
}
