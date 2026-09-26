// 「发送中…」卡死回归(Vincent 2026-09-26,0.2.113 展开的折叠屏:最后两条一直「发送中…」,对方其实
// 已经收到并回复了;更早的一条是「已送达 ✓」)。ck style: self-executing, exit 1 on any failure.
//
// Mechanism (reproduced in the web harness, two-pane, 3 s request latency): a ChatScreen remount
// while a send is in flight — tapping another agent in the two-pane and back (the detail pane is
// keyed `chat:${alias}`), fold/unfold, a theme / density re-key. The new instance restores the
// echo as 「发送中」 from the outbox; the old instance's doSend then succeeds, removes the outbox
// entry and only touches the cache. The new instance's echo has lost both ways out:
//   - load()'s confirmedOutboxIds needs the outbox entry (gone);
//   - echoSupersededByFetched returned false for every _pending echo.
// ⇒ 「发送中…」 forever, next to the hub's own copy of the same message.
//
// This file replays that sequence through the same outbox module and the same two functions,
// composed exactly as ChatScreen's load() composes them (anchored below). It only imports what
// origin/main already exports, so on main it runs and fails on the behaviour, not on an import.
// The phone is east of UTC (the owner is in UTC+8); pin it so a hub time read as device-local is
// caught on a UTC CI runner too (bun honours a runtime TZ change).
process.env.TZ = 'Asia/Shanghai';
import fs from 'node:fs';
import path from 'node:path';
import { __resetOutboxForTest, initOutbox, outboxAdd, outboxForAlias, outboxRemove } from './outbox';
import { confirmedOutboxIds, mergeMessagesNewestFirst } from './chat-actions';
import { echoSupersededByFetched } from './chat-echo';
import { createDashboardRequestId } from './api';

let pass = 0;
const failures: string[] = [];
const ck = (name: string, ok: boolean, extra = '') => {
  if (ok) pass++; else failures.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`);
};

type Item = { content?: string; created_at?: string; task_id?: string; meta_json?: string | null; _localId?: string; _pending?: boolean; _failed?: boolean; _confirmedTaskId?: string };

const ALIAS = '演示负责人';
const hubTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' '); // hub: UTC, no zone
const hubRow = (localId: string, content: string, atMs: number, taskId: string): Item => ({
  task_id: taskId,
  content,
  created_at: hubTime(atMs),
  meta_json: JSON.stringify({ source: 'dashboard-chat', client_request_id: localId, auth_origin: 'user' }),
});

// ChatScreen's restore effect: outbox entries → echoes (pending / failed).
const restore = (): Item[] => outboxForAlias(ALIAS).map(e => ({
  content: e.content, created_at: new Date(e.createdAt).toISOString(), _localId: e.id, _pending: e.state === 'pending', _failed: e.state === 'failed',
})).reverse();

// ChatScreen's load(): confirm outbox entries, then keep only echoes that are not yet on the hub.
const load = (prev: Item[], fetched: Item[]): Item[] => {
  const confirmed = new Set(confirmedOutboxIds(outboxForAlias(ALIAS), fetched));
  confirmed.forEach(outboxRemove);
  return mergeMessagesNewestFirst(prev.filter(t => t._localId && !confirmed.has(t._localId) && !echoSupersededByFetched(t, fetched)), fetched);
};

const bubbles = (list: Item[], content: string) => list.filter(i => i.content === content);
const status = (i: Item) => (i._pending ? '发送中' : i._failed ? '未送达' : '已送达');

// ── 1. the owner's case: two quick sends, the pane remounts while they are in flight ──
__resetOutboxForTest();
initOutbox(null, () => {});
const t0 = Date.parse('2026-09-26T10:40:00.000Z');
const idA = createDashboardRequestId();
const idB = createDashboardRequestId();
const idC = createDashboardRequestId();
outboxAdd({ id: idA, alias: ALIAS, content: '帮我看一下这个', createdAt: t0, state: 'pending' });
outboxAdd({ id: idB, alias: ALIAS, content: '还有这个', createdAt: t0 + 800, state: 'pending' });
// remount → new instance
let screen = restore();
ck('remounted pane restores both echoes as 发送中', screen.length === 2 && screen.every(i => i._pending));
// its first poll runs before the hub has committed either (slow link)
screen = load(screen, []);
ck('nothing on the hub yet → both stay 发送中', screen.length === 2 && screen.every(i => i._pending));
// the old instance's doSend: both succeed → outbox entries removed (it cannot reach this state)
outboxRemove(idA);
outboxRemove(idB);
// a third send, still in flight, whose text equals A's (the user repeated himself on purpose)
outboxAdd({ id: idC, alias: ALIAS, content: '帮我看一下这个', createdAt: t0 + 5_000, state: 'pending' });
screen = [{ content: '帮我看一下这个', created_at: new Date(t0 + 5_000).toISOString(), _localId: idC, _pending: true }, ...screen];
// next poll: the hub has A and B (and the agent already replied to A)
const fetched = [
  { ...hubRow(idB, '还有这个', t0 + 1_000, 'task-b') },
  { ...hubRow(idA, '帮我看一下这个', t0 + 200, 'task-a'), result: '看过了' } as Item,
];
screen = load(screen, fetched);
ck('A: exactly one bubble per sent message after the poll (no stuck echo beside the hub row)', bubbles(screen, '还有这个').length === 1, JSON.stringify(bubbles(screen, '还有这个').map(status)));
ck('B: the remaining bubble is the hub row (已送达), not 发送中', bubbles(screen, '还有这个')[0]?.task_id === 'task-b' && !bubbles(screen, '还有这个')[0]?._localId);
ck('A: its echo is gone, the hub row (with the reply) stays', screen.some(i => i.task_id === 'task-a') && !screen.some(i => i._localId === idA), JSON.stringify(screen.map(i => i._localId ?? i.task_id)));
ck('nothing is left on 发送中 except the send that really is in flight (C)', screen.filter(i => i._pending).map(i => i._localId).join() === idC, JSON.stringify(screen.filter(i => i._pending).map(i => i._localId)));
ck('C (same text as A, other request id) is not swallowed by A\'s row', screen.some(i => i._localId === idC) && outboxForAlias(ALIAS).some(e => e.id === idC));
// C lands later
screen = load(screen, [hubRow(idC, '帮我看一下这个', t0 + 5_300, 'task-c'), ...fetched]);
ck('C reconciles once its own row arrives; outbox empty', !screen.some(i => i._localId) && outboxForAlias(ALIAS).length === 0 && screen.length === 3);

// ── 2. request id beats content: attachment hint, clock skew, long gap ──
__resetOutboxForTest();
initOutbox(null, () => {});
const idImg = createDashboardRequestId();
outboxAdd({ id: idImg, alias: ALIAS, content: '[附件] a.png', createdAt: t0, state: 'pending' });
ck('image send: hub content carries the attachment hint, outbox entry is still confirmed by request id',
  confirmedOutboxIds(outboxForAlias(ALIAS), [hubRow(idImg, '[附件] a.png\n[图片: a.png file_id=f1]', t0 + 300, 't')]).join() === idImg);
const idSkew = createDashboardRequestId();
ck('device clock 20 min off the hub: still confirmed by request id',
  confirmedOutboxIds([{ id: idSkew, content: 'hi', createdAt: t0 }], [hubRow(idSkew, 'hi', t0 + 20 * 60_000, 't')]).join() === idSkew);
ck('failed echo whose row the hub has (ACK lost, retry pending) yields to the row',
  echoSupersededByFetched({ _localId: idSkew, _failed: true, content: 'hi', created_at: new Date(t0).toISOString() }, [hubRow(idSkew, 'hi', t0 + 20 * 60_000, 't')]) === true);

// ── 3. precision: nothing else yields ──
const other = createDashboardRequestId();
ck('pending echo does not yield to a same-text row with another request id',
  echoSupersededByFetched({ _localId: other, _pending: true, content: 'hi', created_at: new Date(t0).toISOString() }, [hubRow(idSkew, 'hi', t0, 't')]) === false);
ck('pending echo does not yield to a row with no meta (old hub): unchanged rule',
  echoSupersededByFetched({ _localId: other, _pending: true, content: 'hi', created_at: new Date(t0).toISOString() }, [{ task_id: 't', content: 'hi', created_at: hubTime(t0) }]) === false);
ck('delivered echo, no task id: hub UTC time "YYYY-MM-DD HH:MM:SS" is read as UTC (2 min apart → yields)',
  echoSupersededByFetched({ _localId: other, content: 'hi', created_at: new Date(t0).toISOString() }, [{ content: 'hi', created_at: hubTime(t0 + 120_000) }]) === true);

// ── 4. the simulation above is the code ChatScreen runs ──
const chat = fs.readFileSync(path.join(__dirname, 'ChatScreen.tsx'), 'utf8').replace(/\r\n/g, '\n');
ck('ChatScreen load() confirms outbox entries with confirmedOutboxIds(outboxForAlias(alias), fetched)', chat.includes('const confirmed = new Set(confirmedOutboxIds(outboxForAlias(alias), fetched));'));
ck('ChatScreen load() keeps only echoes not confirmed and not superseded', chat.includes('prev.filter(t => t._localId && !confirmed.has(t._localId) && !echoSupersededByFetched(t, fetched))'));
ck('ChatScreen sends the echo id as the hub request id', chat.includes('sendTask(cfg, alias, outgoing, attachments, priority, dashboardRequestIdForLocalId(localId))'));
ck('ChatScreen restores outbox entries with their pending state', chat.includes("_pending: e.state === 'pending',"));

console.log(`\nsend-echo-remount: ${pass}/${pass + failures.length} passed`);
if (failures.length) { for (const f of failures) console.error('FAIL:', f); process.exit(1); }
