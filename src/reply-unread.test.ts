import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const values = new Map<string, string>();
(globalThis as any).__TAURI_INTERNALS__ = {};
(globalThis as any).localStorage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v) };
const { replyUnreadByAgent, watermarkAfterRender, advanceWatermark, isReplyToUser, parseStoredWatermarks, loadReplyWatermarks, saveReplyWatermarks, hubNowTimestamp, REPLY_WATERMARK_KEY } = await import('./reply-unread');
let ck = 0;
const check = (cond: boolean, msg: string) => { assert.ok(cond, msg); ck++; };

// 生产 hub 的真实形状:inbox 表里 agent → admin 的 reply 行(alias 分支返回 to_alias/from_alias/type/created_at)
const rows = [
  { id: 'a1', from_alias: '通信龙', to_alias: 'admin', type: 'reply', created_at: '2026-09-06 03:59:44' },
  { id: 'a2', from_alias: '通信龙', to_alias: 'admin', type: 'reply', created_at: '2026-09-06 02:10:27' },
  { id: 'b1', from_alias: 'TMAI负责人', to_alias: 'admin', type: 'reply', created_at: '2026-09-06 02:18:42' },
  { id: 'c1', from_alias: 'admin', to_alias: '通信龙', type: 'task', created_at: '2026-09-06 03:00:00' },      // 用户自己发的
  { id: 'd1', from_alias: '通信牛', to_alias: 'TMHR', type: 'reply', created_at: '2026-09-06 03:30:00' },       // 别人之间的
  { id: 'e1', from_alias: 'TMHR', to_alias: 'admin', type: 'status', created_at: '2026-09-06 03:40:00' },       // 状态类不算
  { id: 'f1', from_alias: 'TMHR', to_alias: 'admin', type: 'reply' },                                           // 没时间戳不算
];
check(isReplyToUser(rows[0] as any, 'admin') && !isReplyToUser(rows[3] as any, 'admin') && !isReplyToUser(rows[4] as any, 'admin') && !isReplyToUser(rows[5] as any, 'admin'), 'only agent→user reply/task/message rows count');
const fresh = replyUnreadByAgent(rows as any, 'admin', {});
check(JSON.stringify(fresh) === JSON.stringify({ '通信龙': 2, 'TMAI负责人': 1 }), `fresh watermarks → per-agent counts: ${JSON.stringify(fresh)}`);
check(Object.keys(replyUnreadByAgent(rows as any, '', {})).length === 0, 'no username → nothing');
// 看过通信龙 02:10 那条之后,只剩 03:59 那条
const partial = replyUnreadByAgent(rows as any, 'admin', { '通信龙': '2026-09-06 02:10:27' });
check(partial['通信龙'] === 1 && partial['TMAI负责人'] === 1, 'watermark excludes rows at or before it');
// 渲染到最新:水位线 = 该 agent 最新一条 created_at(hub 时间)与本地 now 的较大者
const now = new Date('2026-09-06T03:50:00Z');
check(watermarkAfterRender(rows as any, 'admin', '通信龙', now) === '2026-09-06 03:59:44', 'watermark takes the newest hub timestamp when it is ahead of local now');
check(watermarkAfterRender(rows as any, 'admin', 'TMAI负责人', now) === '2026-09-06 03:50:00', 'watermark takes local now when hub rows are older');
check(watermarkAfterRender([], 'admin', 'nobody', now) === '2026-09-06 03:50:00' && hubNowTimestamp(now) === '2026-09-06 03:50:00', 'no rows → now, hub format');
check(replyUnreadByAgent(rows as any, 'admin', { '通信龙': watermarkAfterRender(rows as any, 'admin', '通信龙', now) })['通信龙'] === undefined, 'after render the agent has no unread');
// 水位线只前进不后退
const w1 = advanceWatermark({}, '通信龙', '2026-09-06 03:59:44');
check(advanceWatermark(w1, '通信龙', '2026-09-06 01:00:00') === w1, 'older timestamp does not move the watermark back');
check(advanceWatermark(w1, '', 'x') === w1 && advanceWatermark(w1, 'a', '') === w1, 'empty agent/ts ignored');
// 持久化:桌面 localStorage 往返;坏值过滤;非桌面不存
check(saveReplyWatermarks(w1) === true && values.get(REPLY_WATERMARK_KEY)?.includes('通信龙') === true, 'saved to localStorage');
check(loadReplyWatermarks()['通信龙'] === '2026-09-06 03:59:44', 'roundtrip');
check(Object.keys(parseStoredWatermarks('{"a":"2026-09-06 03:59:44","b":"nope","c":5}')).join(',') === 'a', 'bad entries dropped');
check(Object.keys(parseStoredWatermarks('garbage')).length === 0 && Object.keys(parseStoredWatermarks(null)).length === 0, 'garbage → empty');
delete (globalThis as any).__TAURI_INTERNALS__;
check(saveReplyWatermarks(w1) === false && Object.keys(loadReplyWatermarks()).length === 0, 'non-desktop: no persistence');

// 接线契约
const agents = readFileSync(new URL('./AgentsScreen.tsx', import.meta.url), 'utf8');
check(agents.includes('ingestInboxMessagesBody(await fetchMessages(cfg, 300, replyUnreadSince()), cfg.username)'), 'agents list polls the alias-branch messages (7-day window, not the hub default 1h) into the store');
const { replyUnreadSince } = await import('./api');
check(replyUnreadSince(new Date('2026-09-06T04:00:00Z')) === '2026-08-30 04:00:00', 'since window = 7 days in hub timestamp format');
const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
check(api.includes('&since=${encodeURIComponent(since)}'), 'fetchMessages forwards since');
check(agents.includes('replyUnreadCounts(unreadSnap)'), 'badge count includes reply unread');
const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
const idx = chat.indexOf("dispatchUnread({ kind: 'rendered_to_latest', agent: alias });");
check(idx > 0 && chat.slice(idx, idx + 300).includes('markAgentRepliesSeen(alias)'), 'rendering to latest advances the reply watermark');
const badge = readFileSync(new URL('./unread-badge.ts', import.meta.url), 'utf8');
check(badge.includes('const replyPart = replyUnread?.[agentId] ?? 0;') && badge.includes('return userInboxPart +'), 'row count = user_inbox part + reply part');
console.log(`reply unread: ${ck} checks passed`);
