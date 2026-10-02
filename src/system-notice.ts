// Hub 系统通知(#491 / #493 任务到期提醒,hub agent-network#2289)—— 客户端纯逻辑。不 import react-native。
//
// Hub 用 #462 / #464 同一条路发到期提醒:user_inbox 一行 + 用户流上的 desktop_message,
//   kind = 'task_due',meta.task_notice = {requirement_id, seq, network_id, due_reminder, due, overdue_days}。
// 发信人有两种:
//   1. 负责 Agent 的别名(收件人看得见它)—— 与 #464「定时任务卡住」完全一样:落在与那个 Agent 的会话里
//      (主动消息),未读在打开会话时清掉。这里什么都不改。
//   2. 「任务提醒」—— 不是任何节点,App 里没有这个会话。app 的「agent 主动消息 / 未读角标 / 新消息分组 /
//      手机通知」都按 user_inbox 的 from_session 当 agent 名算(human-dm.ts 顶部同一个坑),不处理的话
//      它会变成一个打不开、清不掉的幽灵会话和角标。所以:
//        - 在 user_inbox 的唯一取数口(api.ts)从 agent 链路里摘掉(行、unread_by_agent 的键、各个合计);
//        - 用户流推来时照常弹顶部提示(标题 + 正文,点一下打开那张任务),弹出即在 Hub 上标已读。
// 判据要两格都对上(kind + 发信人):一个真叫「任务提醒」的节点发的普通消息不会被吞掉。

export const DUE_REMINDER_KIND = 'task_due';
/** hub requirement-due-reminders.ts DUE_REMINDER_SENDER。 */
export const DUE_REMINDER_SENDER = '任务提醒';

type RowLike = { kind?: unknown; from_session?: unknown; acked?: unknown; message_id?: unknown };

/** user_inbox 的一行是不是没有会话可去的系统通知(「任务提醒」发的到期提醒)。 */
export const isSystemNoticeRow = (row: RowLike | null | undefined): boolean =>
  !!row && row.kind === DUE_REMINDER_KIND && row.from_session === DUE_REMINDER_SENDER;

/** 用户流上的 desktop_message(desktop-message-consume 解析过的)是不是这种系统通知。 */
export const isSystemNotice = (notice: { kind?: string | null; from?: string | null } | null | undefined): boolean =>
  !!notice && notice.kind === DUE_REMINDER_KIND && notice.from === DUE_REMINDER_SENDER;

/** 任意发信人的到期提醒(含 Agent 别名发的那种)。 */
export const isDueReminderNotice = (notice: { kind?: string | null } | null | undefined): boolean => notice?.kind === DUE_REMINDER_KIND;

/**
 * 什么时候在 Hub 上标已读(返回要 ack 的 message_id,空 = 不 ack):
 *   - 系统通知(「任务提醒」):弹出顶部提示就算看过 —— 它没有会话,不在这里清就永远清不掉;
 *   - Agent 别名发的到期提醒:与 #464 一样留在会话里等打开会话时清;但点提示直接打开了任务,也算看过。
 *   - 其余消息:不动(会话页自己 ack)。
 */
export function noticeAckIds(notice: { messageId: string; kind?: string | null; from?: string | null }, event: 'shown' | 'opened'): string[] {
  if (!notice.messageId) return [];
  if (isSystemNotice(notice)) return [notice.messageId];
  if (event === 'opened' && isDueReminderNotice(notice)) return [notice.messageId];
  return [];
}

type UserMessagesBodyLike = {
  messages?: ReadonlyArray<object>;
  unread?: number;
  pending_count?: number;
  unread_by_agent?: Record<string, number>;
  unread_total?: number;
};

/**
 * `/api/messages?scope=user` 的响应去掉系统通知(同 stripHumanDms 的口径):
 *   - messages 里的系统通知行;
 *   - unread_by_agent 里「任务提醒」这个键(只在本页确有这种行、或 Hub 已经按它计了数时);
 *   - unread / pending_count / unread_total 相应减掉。
 * 没有这种行也没有这个键 → 原样返回(同一个对象)。
 */
export function stripSystemNotices<T extends UserMessagesBodyLike>(body: T): T {
  if (!body || typeof body !== 'object' || !Array.isArray(body.messages)) return body;
  const rows = body.messages as ReadonlyArray<RowLike>;
  const sys = rows.filter(isSystemNoticeRow);
  const byAgent = body.unread_by_agent && typeof body.unread_by_agent === 'object' ? body.unread_by_agent : null;
  const keyed = byAgent && Object.prototype.hasOwnProperty.call(byAgent, DUE_REMINDER_SENDER) ? Number(byAgent[DUE_REMINDER_SENDER]) || 0 : 0;
  if (!sys.length && !keyed) return body;
  const unreadRows = sys.filter(m => !m.acked).length;
  const next: T = { ...body, messages: rows.filter(m => !isSystemNoticeRow(m)) as T['messages'] };
  if (byAgent) next.unread_by_agent = Object.fromEntries(Object.entries(byAgent).filter(([k]) => k !== DUE_REMINDER_SENDER));
  const sub = (v: unknown, n: number) => (typeof v === 'number' ? Math.max(0, v - n) : v);
  const unread = Math.max(unreadRows, keyed);
  if (typeof body.unread === 'number') next.unread = sub(body.unread, unread) as number;
  if (typeof body.pending_count === 'number') next.pending_count = sub(body.pending_count, unread) as number;
  if (typeof body.unread_total === 'number') next.unread_total = sub(body.unread_total, keyed) as number;
  return next;
}
