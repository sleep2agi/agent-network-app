// 「对话页看不到别的节点回给这个 agent 的那半」—— 数据层合并 + 方向判定。
// 场景（2026-11-12 实读 Hub）：A 发给 B 的行，to_name=B、result 是 B 回 A 的话；
// 对话页只拉 to_name=A ⇒ 这批行永不出现。修复 = 入站 + 出站合并，出站行画在发送侧。
import { cachedOutgoing, firstPaintRows, isOutgoingRow, mergeConversationSides, outgoingReplyAuthor } from './chat-outgoing';

let pass = 0;
const fails: string[] = [];
const ck = (name: string, ok: boolean) => { if (ok) pass += 1; else fails.push(name); };

const row = (id: string, from: string, to: string, at: string, content = 'c', result?: string) =>
  ({ task_id: id, from_name: from, to_name: to, created_at: at, content, result });

const A = '知识库欧';
const B = '基建牛';

// 1) 出站行必须被合并进来（这就是「缺的那半」）
{
  const inbound = [row('1', 'chuqi', A, '2026-11-12 10:00:00')];
  const outgoing = [row('2', A, B, '2026-11-12 09:55:00', '派单', '(B) 回复')];
  const merged = mergeConversationSides(inbound, outgoing, 20);
  ck('outgoing rows are merged into the conversation', merged.some(r => r.task_id === '2'));
  ck('newest first', merged[0].task_id === '1');
}

// 2) 同一行两侧都返回时不能重复
{
  const dup = row('9', A, A, '2026-11-12 10:00:00');
  ck('same task_id returned by both sides is deduped',
    mergeConversationSides([dup], [dup], 20).length === 1);
}

// 3) 没有 task_id 的脏数据用内容指纹去重，不能把两条真实不同的消息吃掉
{
  const a = { from_name: A, to_name: B, created_at: 't1', content: 'same' };
  const b = { from_name: A, to_name: B, created_at: 't1', content: 'same' };
  const c = { from_name: A, to_name: B, created_at: 't1', content: 'different' };
  ck('content fingerprint dedupes real duplicates', mergeConversationSides([a], [b], 20).length === 1);
  ck('content fingerprint keeps distinct messages', mergeConversationSides([a], [c], 20).length === 2);
}

// 4) 方向判定：只有「本 agent 发出去、收件人是别人」才算出站
ck('outgoing: alias -> other', isOutgoingRow({ from_name: A, to_name: B }, A));
ck('inbound is not outgoing', !isOutgoingRow({ from_name: B, to_name: A }, A));
ck('self row is not outgoing', !isOutgoingRow({ from_name: A, to_name: A }, A));

// 5) 出站行的回复要署名给收件人（不能继续写成本 agent 自己说的话）
ck('reply author is the recipient', outgoingReplyAuthor({ from_name: A, to_name: B }, A) === B);
ck('reply author falls back to alias without to_name', outgoingReplyAuthor({ from_name: A }, A) === A);
ck('reply author falls back when to_name equals alias', outgoingReplyAuthor({ from_name: A, to_name: A }, A) === A);

// 6) limit 生效（合并后仍受一页上限约束，避免一次画几百条）
{
  const many = Array.from({ length: 50 }, (_, i) => row(`m${i}`, A, B, `2026-11-12 09:${String(i).padStart(2, '0')}:00`));
  ck('merged page respects the limit', mergeConversationSides([], many, 20).length === 20);
}

// 7) 源码守护：只拉入站的老写法不许回来（否则这个可见性 bug 会静默复发）
{
  const screen = require('node:fs').readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
  ck('screen fetches both directions', /from_name: alias/.test(screen) && /to_name: alias|newestPageParams\(alias/.test(screen));
  ck('screen merges the two sides', screen.includes('mergeConversationSides('));
  ck('screen renders outgoing rows on the sent side', screen.includes('isOutgoingRow(item, alias)') && screen.includes('outgoingReplyAuthor(item, alias)'));
}

// 8) 2026-11-14 admin「最后一条一直显示一直消失」:每轮刷新入站先画会把出站行冲掉,补拉回来再画回 → 闪。
{
  const inbound = [row('i1', 'admin', A, '2026-11-14 09:00:00')];
  const out = [row('o1', A, B, '2026-11-14 09:05:00', '收到 950 档告警')];
  const ids = (rows: { task_id?: string }[]) => rows.map(r => r.task_id).join(',');
  ck('🔴 first paint keeps last known outgoing rows (no vanish-then-reappear)', ids(firstPaintRows(inbound, { alias: A, rows: out }, A, 20)) === 'o1,i1');
  ck('first paint with no cache = inbound only (first open is unchanged)', ids(firstPaintRows(inbound, null, A, 20)) === 'i1');
  ck('🔴 cache from another agent is never painted into this conversation', ids(firstPaintRows(inbound, { alias: B, rows: out }, A, 20)) === 'i1' && cachedOutgoing({ alias: B, rows: out }, A).length === 0);
  ck('first paint respects the limit', firstPaintRows(inbound, { alias: A, rows: Array.from({ length: 30 }, (_, i) => row(`x${i}`, A, B, `2026-11-14 08:${String(i).padStart(2, '0')}:00`)) }, A, 20).length === 20);
  const screen = require('node:fs').readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
  ck('screen paints inbound together with cached outgoing', screen.includes("paint('tasks', firstPaintRows(rows, outgoingCacheRef.current, alias, params.limit), fetched, confirmed);"));
  ck('screen updates the cache when the outgoing refetch lands', screen.includes('outgoingCacheRef.current = { alias, rows: outgoingRows };'));
  ck('rows that really disappeared are still removed (repaint when cache had rows)', screen.includes('if (!outgoingRows.length && !hadOutgoing) return;'));
}

console.log(`chat-outgoing: ${pass}/${pass + fails.length}`);
if (fails.length) { console.error('FAILED:', fails.join(' | ')); process.exit(1); }
