// app#160 —— Agent **主动**发给用户的消息(hub `user_inbox`,send_desktop_message)进入该 Agent 的会话时间线。
// 会话时间线是按任务行(tasks)拼的:content = 用户发的,result/reply = agent 回的。主动消息没有「用户发的那一半」,
// 所以映射成一条只有 result 的 ChatItem,并打 `_proactive` 标 —— 渲染时不画发送气泡,只画回复气泡 + 「主动汇报」小标。
// 纯函数;取数在 ChatScreen.load(与任务同一次轮询),去重靠 message_id(与 task_id 不会撞:dm_ 前缀)。
import type { HubTask, HubUserMessage } from './api';

export interface ProactiveMessageRow extends HubUserMessage {
  kind?: string;
  title?: string | null;
  content?: string;
  severity?: string;
  created_at?: string;
  meta_json?: string | null;
  in_reply_to?: string | null;
}

export type ProactiveChatItem = HubTask & { _proactive: true; _severity?: string; in_reply_to?: string | null };

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

/** 只取 from_session === alias 的行;缺 message_id / 正文为空的丢弃;不排序(合并时按 created_at 排)。 */
export function proactiveItemsForAgent(rows: readonly ProactiveMessageRow[] | undefined | null, alias: string, username?: string): ProactiveChatItem[] {
  if (!alias) return [];
  const out: ProactiveChatItem[] = [];
  for (const row of rows ?? []) {
    if (!row || row.from_session !== alias || typeof row.message_id !== 'string' || !row.message_id) continue;
    const body = proactiveBody(row);
    if (!body) continue;
    out.push({
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
