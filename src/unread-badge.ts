/**
 * Agent 列表行上的未读数 —— 组合 #209/#211 的纯函数，不另写一套计数。
 *
 * 显示 = resolveUnread(readServerUnread(body), unreadOf(ledger, agentId))
 * 的语义，但服务端 `unread` 是**用户收件箱总数**，不是 per-Agent。
 * 把正总数画到每一行会让 A/B 共用一个数字。所以：
 *   - 服务端 0 → 权威「全已读」，每行都 0（resolveUnread(0, local)）
 *   - 服务端拿不到或 >0 → 退回该 Agent 的 ledger（ingest + rendered_to_latest）
 * 打开会话仍走 reduceUnread：conversation_opened 不清零，只有 rendered_to_latest 清。
 */
import type { HubMessage } from './api';
import { reduceUnread, unreadOf, type UnreadState } from './unread-ledger';
import { readServerUnread, resolveUnread } from './user-unread';

export function unreadCountForAgentRow(
  body: unknown,
  ledger: UnreadState,
  agentId: string,
): number {
  const local = unreadOf(ledger, agentId);
  const server = readServerUnread(body);
  return resolveUnread(server === 0 ? 0 : null, local);
}

export function ingestUserMessages(
  ledger: UnreadState,
  messages: HubMessage[],
  seenIds: ReadonlySet<string>,
): { ledger: UnreadState; seenIds: Set<string> } {
  const seen = new Set(seenIds);
  let next = ledger;
  for (const message of messages) {
    if (!message?.id || seen.has(message.id)) continue;
    const agent = typeof message.from_alias === 'string' ? message.from_alias.trim() : '';
    if (!agent) continue;
    seen.add(message.id);
    next = reduceUnread(next, { kind: 'message_arrived', agent });
  }
  return { ledger: next, seenIds: seen };
}
