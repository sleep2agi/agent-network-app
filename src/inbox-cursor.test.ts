// 纯逻辑单测(bun/node 可跑·无 RN 依赖)。run: bun src/inbox-cursor.test.ts
// 回复未读的 inbox 增量读:任何时刻合并出来的行,必须和那一刻整读(7 天 × 300)逐行相同。
import type { HubMessage } from './api';
import {
  createReplyInboxReader,
  hubTs,
  INBOX_LIMIT,
  INBOX_OVERLAP_MS,
  INBOX_RESYNC_MS,
  INBOX_WINDOW_MS,
  inboxCursorOf,
  inboxReadPlan,
  mergeInboxRows,
  windowStart,
} from './inbox-cursor';

let p = 0, t = 0;
const ck = (n: string, c: boolean, detail?: unknown) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n, detail ?? ''); };

const T0 = Date.parse('2026-09-30T10:00:00Z');
const ts = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
let seq = 0;
const row = (at: number, to = 'admin', from = 'A'): HubMessage => ({ id: `ib-${String(++seq).padStart(6, '0')}`, to_alias: to, from_alias: from, type: 'reply', content: `m${seq}`, acked: 0, created_at: ts(at) } as HubMessage);

// 假 hub:alias 分支的 SQL 语义 —— created_at >= since ORDER BY created_at DESC LIMIT n。
// 同一秒内的顺序 hub 不保证;这里按 id 降序,与 mergeInboxRows 的同秒次序一致,方便逐行比。
function hubPage(rows: HubMessage[], limit: number, since: string): HubMessage[] {
  return rows
    .filter(r => r.created_at! >= since)
    .sort((a, b) => (a.created_at! !== b.created_at! ? (a.created_at! < b.created_at! ? 1 : -1) : a.id! < b.id! ? 1 : -1))
    .slice(0, limit);
}
const ids = (rows: readonly HubMessage[]) => rows.map(r => r.id).join(',');

// ── 纯函数 ──
ck('hubTs 把 ISO 归一成 hub 的 `YYYY-MM-DD HH:MM:SS`', hubTs('2026-09-30T10:00:05.123Z') === '2026-09-30 10:00:05' && hubTs('2026-09-30 10:00:05') === '2026-09-30 10:00:05' && hubTs(null) === null);
ck('窗口起点 = 7 天前(与原 replyUnreadSince 同格式)', windowStart(T0) === '2026-09-23 10:00:00');
ck('游标 = 手里最新一条的 created_at;空 → null', inboxCursorOf([row(T0), row(T0 + 5000), row(T0 - 5000)]) === ts(T0 + 5000) && inboxCursorOf([]) === null);

const KEY = 'hub\u0000tok\u0000net';
ck('没有缓存 → 整读 7 天', JSON.stringify(inboxReadPlan(null, KEY, T0)) === JSON.stringify({ full: true, since: windowStart(T0) }));
const cache = { key: KEY, rows: [row(T0)], fullAt: T0 };
ck('有缓存 → 增量,since = 游标往回 INBOX_OVERLAP_MS', JSON.stringify(inboxReadPlan(cache, KEY, T0 + 10_000)) === JSON.stringify({ full: false, since: ts(T0 - INBOX_OVERLAP_MS) }));
ck('换了 hub / 令牌 / 网络 → 整读', inboxReadPlan(cache, 'other', T0 + 10_000).full);
ck('距上次整读满 INBOX_RESYNC_MS → 整读(拿 acked 变化和被删的行)', inboxReadPlan(cache, KEY, T0 + INBOX_RESYNC_MS).full && !inboxReadPlan(cache, KEY, T0 + INBOX_RESYNC_MS - 1).full);
ck('手里一行都没有 → 只能整读', inboxReadPlan({ ...cache, rows: [] }, KEY, T0 + 1000).full);

const a = row(T0), b = row(T0 + 1000);
const merged = mergeInboxRows([a, b], [{ ...b, acked: 1 } as HubMessage, row(T0 + 2000)], T0 + 3000);
ck('合并:按 id 去重,新读到的覆盖旧的', merged.length === 3 && merged.find(r => r.id === b.id)!.acked === 1);
ck('合并:created_at 新→旧', merged.map(r => r.created_at).join() === [ts(T0 + 2000), ts(T0 + 1000), ts(T0)].join());
ck('合并:裁掉 7 天窗口外的行', mergeInboxRows([row(T0 - INBOX_WINDOW_MS - 1000), a], [], T0).length === 1);
{ const c = row(T0 + 2000); ck('合并:最多 limit 条,留最新的', ids(mergeInboxRows([a, b, c], [], T0 + 3000, 2)) === ids([c, b])); }

// ── 等价性:模拟真实流量,每一拍增量读的结果都要和同一时刻整读逐行相同 ──
{
  const hub: HubMessage[] = [];
  let now = T0;
  // 7 天前的历史 + 最近的流量(比 300 多得多,保证上限真的在裁)
  for (let i = 0; i < 400; i++) hub.push(row(now - INBOX_WINDOW_MS - 3_600_000 + i * 1000));
  for (let i = 0; i < 700; i++) hub.push(row(now - 3_600_000 + i * 5000, i % 7 === 0 ? 'admin' : 'B', `A${i % 5}`));
  const reader = createReplyInboxReader();
  const reads: string[] = [];
  let bytesFull = 0, bytesIncr = 0;
  let allEqual = true, firstDiff: unknown = null;
  let rng = 42;
  const rand = () => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng / 2147483648; };
  for (let tick = 0; tick < 200; tick++) {
    // 每 10 s 一拍,期间来 0–12 条(偶尔一大串,超过 limit 的突发也要对)
    const burst = tick === 77 ? 450 : Math.floor(rand() * 12);
    for (let i = 0; i < burst; i++) hub.push(row(now + Math.floor(rand() * 10_000), rand() < 0.2 ? 'admin' : 'B', `A${Math.floor(rand() * 5)}`));
    now += 10_000;
    const got = await reader.read(KEY, async (limit, since) => {
      reads.push(since);
      const page = hubPage(hub, limit, since);
      bytesIncr += JSON.stringify(page).length;
      return { ok: true, messages: page };
    }, now);
    const full = hubPage(hub, INBOX_LIMIT, windowStart(now));
    bytesFull += JSON.stringify(full).length;
    if (ids(got.messages) !== ids(full)) { allEqual = false; firstDiff ??= { tick, got: got.messages.length, full: full.length }; }
  }
  ck('200 拍(含一次 450 条的突发、越过 10 分钟整读):每一拍都与整读逐行相同', allEqual, firstDiff);
  const incremental = reads.filter(s => s !== windowStart(T0) && s > windowStart(T0 + 3_600_000)).length;
  ck('绝大多数拍走的是增量(since 在最近,不是 7 天前)', incremental >= 190, { incremental, total: reads.length });
  ck('只有第一拍和每 10 分钟一次是整读', reads.length - incremental === 1 + Math.floor((200 * 10_000 - 1) / INBOX_RESYNC_MS), reads.length - incremental);
  ck(`传输量降到整读的 1/5 以下(整读 ${bytesFull} B,增量 ${bytesIncr} B)`, bytesIncr * 5 < bytesFull);
}

// ── 失败:缓存不动,错误原样抛出,下一拍照旧增量 ──
{
  const hub = [row(T0), row(T0 + 1000)];
  const reader = createReplyInboxReader();
  await reader.read(KEY, async (l, s) => ({ messages: hubPage(hub, l, s) }), T0 + 2000);
  let threw = false;
  try { await reader.read(KEY, async () => { throw new Error('HTTP 504'); }, T0 + 12_000); } catch (e) { threw = (e as Error).message === 'HTTP 504'; }
  let since = '';
  const after = await reader.read(KEY, async (l, s) => { since = s; return { messages: hubPage(hub, l, s) }; }, T0 + 22_000);
  ck('读失败 → 错误原样抛给调用方(横幅/诊断照旧记失败)', threw);
  ck('失败后下一拍仍是增量,手里的行没丢', since === ts(T0 + 1000 - INBOX_OVERLAP_MS) && after.messages.length === 2);
}

// ── 响应里别的字段原样带回 ──
{
  const reader = createReplyInboxReader();
  const got = await reader.read(KEY, async () => ({ ok: true, messages: [row(T0)], pending_count: 3 }), T0 + 1000);
  ck('响应的其他字段(ok / pending_count)原样带回,messages 换成合并后的行', (got as any).ok === true && (got as any).pending_count === 3 && got.messages.length === 1);
}

console.log(`\n${p}/${t} passed`);
if (p !== t) { if (typeof process !== 'undefined') process.exit(1); }
