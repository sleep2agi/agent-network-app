// 每个 agent 的未读数 + 最近一条消息时间 —— 纯函数,无 RN 依赖(测试可直接 import)。
//
// 🔴 托盘角标(desktop-tray.ts)和节点列表的「新消息」组都从这里取数:
//    同一个快照 → 同一个 Record<alias, count>。列表和托盘不可能分叉,因为只有这一份实现。
//    (0.2.95 之前这段函数体住在 desktop-tray.ts 里的 trayCountsFrom;搬出来是因为
//     desktop-tray 依赖 unread-store → react-native,ck 测试 import 不了它。)
import type { HubMessage, HubUserMessage } from './api';
import { replyUnreadByAgent } from './reply-unread';
import { unreadCountForAgentRow } from './unread-badge';
import type { UnreadStoreSnapshot } from './unread-store';
import { readServerUnreadByAgent } from './user-unread';

/** 算未读需要的那几格快照字段(unread-store 的快照天然满足)。 */
export type UnreadCountSource = Pick<
  UnreadStoreSnapshot,
  'serverBody' | 'ledger' | 'replyRows' | 'replyUsername' | 'replyWatermarks'
>;

/** 每个 agent 的角标数(和列表行同一函数算),只挑 > 0 的。托盘和列表共用。 */
export function agentUnreadCounts(snap: UnreadCountSource): Record<string, number> {
  const out: Record<string, number> = {};
  const authoritative = readServerUnreadByAgent(snap.serverBody);
  const reply = replyUnreadByAgent(snap.replyRows, snap.replyUsername, snap.replyWatermarks);
  const aliases = new Set<string>([
    ...Object.keys(authoritative ?? {}),
    ...Object.keys(reply),
    ...Object.keys(snap.ledger.counts),
  ]);
  for (const alias of aliases) {
    if (!alias || alias === 'hub') continue;
    const n = unreadCountForAgentRow(snap.serverBody, snap.ledger, alias, reply);
    if (n > 0) out[alias] = n;
  }
  return out;
}

/** hub 的 created_at 是 UTC `YYYY-MM-DD HH:MM:SS`(无时区);也接受 ISO。读不出返回 0。 */
export function hubTimeMs(value: unknown): number {
  if (typeof value !== 'string' || !value) return 0;
  let s = value.trim().replace(' ', 'T');
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(s)) s += 'Z';
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

/**
 * 每个 agent 发给登录用户的最近一条消息时间(ms)。「新消息」组按它倒序。
 * 两个来源:scope=user 的 user_inbox 行(from_session)+ alias 分支 inbox 行里 to 用户的那些(from_alias)。
 */
export function latestMessageAtByAgent(snap: Pick<UnreadCountSource, 'serverBody' | 'replyRows' | 'replyUsername'>): Record<string, number> {
  const out: Record<string, number> = {};
  const bump = (alias: unknown, at: unknown) => {
    if (typeof alias !== 'string' || !alias) return;
    const ms = hubTimeMs(at);
    if (ms > (out[alias] ?? 0)) out[alias] = ms;
  };
  const body = snap.serverBody as { messages?: HubUserMessage[] } | null;
  for (const m of Array.isArray(body?.messages) ? body!.messages! : []) bump(m?.from_session, m?.created_at);
  for (const r of (snap.replyRows ?? []) as readonly HubMessage[]) {
    if (snap.replyUsername && r?.to_alias === snap.replyUsername) bump(r.from_alias, r.created_at);
  }
  return out;
}
