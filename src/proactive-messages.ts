// app#160 —— Agent **主动**发给用户的消息(hub `user_inbox`,send_desktop_message)进入该 Agent 的会话时间线。
// 会话时间线是按任务行(tasks)拼的:content = 用户发的,result/reply = agent 回的。主动消息没有「用户发的那一半」,
// 所以映射成一条只有 result 的 ChatItem,并打 `_proactive` 标 —— 渲染时不画发送气泡,只画回复气泡 + 「主动汇报」小标。
// 纯函数;取数在 ChatScreen.load(与任务同一次轮询),去重靠 message_id(与 task_id 不会撞:dm_ 前缀)。
import type { HubTask, HubUserMessage } from './api';
import { eventAttachmentPreview } from './dm-attachment-model';
import { taskNoticeOf, type TaskNoticeRef } from './human-dm';
import { DUE_REMINDER_KIND } from './system-notice';

export interface ProactiveMessageRow extends HubUserMessage {
  kind?: string;
  title?: string | null;
  content?: string;
  severity?: string;
  created_at?: string;
  meta_json?: string | null;
  in_reply_to?: string | null;
}

export type ProactiveChatItem = HubTask & {
  _proactive: true;
  _severity?: string;
  in_reply_to?: string | null;
  /** #499 负责 Agent 发的到期提醒(kind=task_due + meta.task_notice):气泡下画「查看任务 ›」打开那张任务。 */
  _taskNotice?: TaskNoticeRef;
  /** #296 —— 主动消息带的附件(hub `user_inbox.meta_json.attachments`)。
   *  它不是提问者的附件(主动消息没有提问那一半),渲染端把它当**回复侧**附件画卡片;
   *  不带上这一份,附件卡片就整条丢掉(桌面和手机同一条渲染路径)。 */
  meta_json?: string | null;
};

/** 会话里的这条主动消息是不是到期提醒、指向哪张任务(没有 = 不画链接)。 */
export function dueReminderTaskRef(row: Pick<ProactiveMessageRow, 'kind' | 'meta_json'>): TaskNoticeRef | null {
  if (row.kind !== DUE_REMINDER_KIND) return null;
  return taskNoticeOf(row.meta_json);
}

/** 主动消息若是对某条任务的回应:行上的 in_reply_to 优先,否则看 meta_json.in_reply_to。 */
export function proactiveInReplyTo(row: Pick<ProactiveMessageRow, 'in_reply_to' | 'meta_json'>): string | null {
  if (typeof row.in_reply_to === 'string' && row.in_reply_to.trim()) return row.in_reply_to.trim();
  if (typeof row.meta_json !== 'string' || !row.meta_json) return null;
  try {
    const meta = JSON.parse(row.meta_json);
    const id = meta && typeof meta === 'object' ? (meta as { in_reply_to?: unknown }).in_reply_to : null;
    return typeof id === 'string' && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

/** 标题 + 正文合成回复气泡的 Markdown;只有其一时原样。 */
export function proactiveBody(row: Pick<ProactiveMessageRow, 'title' | 'content'>): string {
  const title = (row.title ?? '').trim();
  const body = (row.content ?? '').trim();
  if (title && body) return `**${title}**\n\n${body}`;
  return title || body;
}

/** #296 —— 主动消息只有附件、没有正文时的气泡占位文本(与私信通知同一口径:「[图片]」/「[文件]」)。
 *  没有正文也没有附件 → null(这条消息没有可展示的内容)。 */
export function proactiveAttachmentPreview(metaJson: unknown): string | null {
  if (typeof metaJson !== 'string' || !metaJson.trim()) return null;
  try {
    return eventAttachmentPreview(JSON.parse(metaJson));
  } catch {
    return null;
  }
}

/** 只取 from_session === alias 的行;缺 message_id / 正文为空的丢弃;不排序(合并时按 created_at 排)。
 *  #296:只有附件的主动消息不再丢弃 —— 正文用「[图片]」/「[文件]」占位,附件由回复气泡画卡片。 */
export function proactiveItemsForAgent(rows: readonly ProactiveMessageRow[] | undefined | null, alias: string, username?: string): ProactiveChatItem[] {
  if (!alias) return [];
  const out: ProactiveChatItem[] = [];
  for (const row of rows ?? []) {
    if (!row || row.from_session !== alias || typeof row.message_id !== 'string' || !row.message_id) continue;
    const body = proactiveBody(row) || proactiveAttachmentPreview(row.meta_json);
    if (!body) continue;
    const taskNotice = dueReminderTaskRef(row);
    out.push({
      ...(taskNotice ? { _taskNotice: taskNotice } : {}),
      ...(typeof row.meta_json === 'string' && row.meta_json ? { meta_json: row.meta_json } : {}),
      task_id: row.message_id,
      from_name: alias,
      to_name: username,
      content: '',
      result: body,
      created_at: row.created_at,
      _proactive: true,
      _severity: row.severity,
      in_reply_to: proactiveInReplyTo(row),
    });
  }
  return out;
}
