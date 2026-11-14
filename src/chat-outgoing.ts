// 「对话页看不到别的节点回给这个 agent 的那半」—— 真机/后台可见性修复的数据层。
//
// 事实（2026-11-12 用节点令牌实读 Hub）：agent A 发给别的节点 B 的任务，其 `result` 是 **B 回 A 的话**，
// 但这行的 `to_name` 是 B。对话页过去只拉 `to_name=A`，于是这些「A 发出去 / B 回过来」的行永远不出现，
// 用户看到的就是「自己发的在，节点的回复不在」。
//
// 所以：对话 = 入站（to_name=A）+ 出站（from_name=A）合并。这里只做纯数据合并，渲染层另判方向。
export interface ConversationRow {
  task_id?: string;
  from_name?: string;
  to_name?: string;
  content?: string;
  created_at?: string;
}

/** 同一行可能同时出现在两侧（A→A 不该有，但脏数据防一手）。task_id 优先，缺 id 用内容指纹。 */
export function mergeConversationSides<T extends ConversationRow>(inbound: T[], outgoing: T[], limit: number): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const row of [...inbound, ...outgoing]) {
    const key = row.task_id
      ? `id:${row.task_id}`
      : `c:${row.from_name ?? ''}|${row.to_name ?? ''}|${row.created_at ?? ''}|${(row.content ?? '').slice(0, 40)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }
  // Hub 的列表是 created_at DESC；合并后自己再排一次，别依赖两次请求的返回顺序。
  merged.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  return merged.slice(0, Math.max(1, limit));
}

/**
 * 2026-11-14 admin「消息一直在跳和闪,最后一条一直显示一直消失」:每次刷新先只画入站,
 * 出站行(本 agent 发给别的节点)被整源替换掉;几百毫秒后出站补拉回来再画回去 → 每轮刷新闪一次。
 * 先画的那一帧要带上**上一轮已知的出站行**(同一个 agent 的),补拉回来再换成新的。
 */
export type OutgoingCache<T> = { alias: string; rows: T[] };

/** 上一轮补拉到的出站行;换了 agent 就不算(别把 A 的出站画进 B 的对话)。 */
export function cachedOutgoing<T>(cache: OutgoingCache<T> | null, alias: string): T[] {
  return cache && cache.alias === alias ? cache.rows : [];
}

/** 入站先画的那一帧:有已知出站就一起合并,没有就原样。 */
export function firstPaintRows<T extends ConversationRow>(inbound: T[], cache: OutgoingCache<T> | null, alias: string, limit: number): T[] {
  const known = cachedOutgoing(cache, alias);
  return known.length ? mergeConversationSides(inbound, known, limit) : inbound;
}

/** 这行是不是「本 agent 发给别的节点」——用于把它画在发送侧，作者写「A → B」。 */
export function isOutgoingRow(row: ConversationRow, alias: string): boolean {
  return (row.from_name ?? '') === alias && (row.to_name ?? '') !== alias;
}

/** 出站行的回复气泡该署名给谁：收件人；拿不到就退回 agent 自己（宁可少信息，不认错人）。 */
export function outgoingReplyAuthor(row: ConversationRow, alias: string): string {
  const to = (row.to_name ?? '').trim();
  return to && to !== alias ? to : alias;
}
