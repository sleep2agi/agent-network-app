import {
  FEED_EMPTY_TITLE,
  clickTarget,
  feedRowModel,
  historyFromTasks,
  isTransportEvent,
  liveFrameToFeedEvent,
  mergeHistory,
  relativeTime,
  statusChip,
  streamStatusLine,
  taskRowToFeedEvent,
} from './event-feed-model';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n}`); };

const NOW = Date.parse('2026-09-27T12:00:00Z');

// ── history rows carry routing only ──
const row = {
  task_id: 'task_demo_1', from_name: 'tester', to_name: 'demo-node', status: 'replied', priority: 'high',
  created_at: '2026-09-27 11:57:00', content: 'SECRET BODY', result: 'SECRET REPLY', meta_json: '{"x":1}',
};
const h = taskRowToFeedEvent(row)!;
ck('history: task row maps', h.taskId === 'task_demo_1' && h.from === 'tester' && h.to === 'demo-node' && h.status === 'replied');
ck('history: hub UTC created_at parsed as UTC', h.atMs === Date.parse('2026-09-27T11:57:00Z'));
const serialized = JSON.stringify(h);
ck('history: content never copied', !serialized.includes('SECRET BODY'));
ck('history: result never copied', !serialized.includes('SECRET REPLY'));
ck('history: meta_json never copied', !serialized.includes('"x"'));
ck('history: only routing keys', Object.keys(h).sort().join(',') === 'atMs,from,key,kind,priority,source,status,taskId,to,type');
ck('history: row without task id dropped', taskRowToFeedEvent({ from_name: 'a', to_name: 'b' }) === null);

const hist = historyFromTasks([
  { task_id: 'b', from_name: 'x', to_name: 'y', created_at: '2026-09-27 11:00:00' },
  { task_id: 'a', from_name: 'x', to_name: 'y', created_at: '2026-09-27 10:00:00' },
  { task_id: 'b', from_name: 'x', to_name: 'y', created_at: '2026-09-27 11:00:00' },
  { from_name: 'x' },
]);
ck('history: oldest first (hub returns newest first)', hist.map(e => e.taskId).join(',') === 'a,b');
ck('history: duplicates collapse', hist.length === 2);
ck('history: null body → empty', historyFromTasks(undefined).length === 0);

// ── live frames ──
ck('transport: connected is transport', isTransportEvent({ type: 'connected' }));
ck('transport: case-insensitive', isTransportEvent({ type: 'Connected' }));
ck('transport: new_task is not', !isTransportEvent({ type: 'new_task' }));
ck('live: connected frame → no row', liveFrameToFeedEvent({ type: 'connected', observer: true }, NOW, 1) === null);
const lt = liveFrameToFeedEvent({ type: 'new_task', task_id: 'task_live', from: 'tester', to: 'demo-node', status: 'delivered', priority: 'normal' }, NOW, 2)!;
ck('live: new_task maps', lt.kind === 'task' && lt.from === 'tester' && lt.to === 'demo-node' && lt.status === 'delivered' && lt.atMs === NOW);
const lr = liveFrameToFeedEvent({ type: 'new_reply', task_id: 'task_live', message_id: 'm1', from: 'demo-node', to: 'tester', status: 'replied' }, NOW, 3)!;
ck('live: new_reply is a reply (was an "unknown" chip)', lr.kind === 'reply');
const ln = liveFrameToFeedEvent({ type: 'node_deleted', alias: 'demo-node' }, NOW, 4)!;
ck('live: node event names the node', ln.kind === 'node' && ln.to === 'demo-node' && statusChip(ln).label === '节点已删除');
const lu = liveFrameToFeedEvent({ type: 'brand_new_type' }, NOW, 5)!;
ck('live: unknown type stays visible (verbatim)', lu.kind === 'other' && statusChip(lu).label === 'brand_new_type');
ck('live: keys unique per frame', lt.key !== lr.key);

// ── merge ──
const histLive = historyFromTasks([{ task_id: 'task_live', from_name: 'tester', to_name: 'demo-node', status: 'queued', created_at: '2026-09-27 11:59:00' }]);
const merged = mergeHistory(histLive, [lt, lr], 500);
ck('merge: a live new_task supersedes the same task in history', merged.length === 2 && merged[0] === lt);
ck('merge: live reply for a history task keeps the history row', mergeHistory(histLive, [lr], 500).length === 2);
ck('merge: capped to max (newest kept)', mergeHistory(hist, [lt, lr], 3).map(e => e.key).join(',') === ['task:b', lt.key, lr.key].join(','));

// ── row text ──
ck('chip: replied', statusChip({ kind: 'task', type: 'new_task', status: 'replied' }).label === '已回复');
ck('chip: delivered', statusChip({ kind: 'task', type: 'new_task', status: 'delivered' }).label === '已送达');
ck('chip: failed tone', statusChip({ kind: 'task', type: 'new_task', status: 'failed' }).tone === 'failed');
ck('chip: unknown status verbatim, neutral', (() => { const c = statusChip({ kind: 'task', type: 'new_task', status: 'weird' }); return c.label === 'weird' && c.tone === 'rest'; })());
ck('chip: reply without status', statusChip({ kind: 'reply', type: 'new_reply', status: '' }).label === '回复');

ck('time: <1 min', relativeTime(NOW - 30_000, NOW) === '刚刚');
ck('time: minutes', relativeTime(NOW - 3 * 60_000, NOW) === '3 分钟前');
ck('time: hours', relativeTime(NOW - 2 * 3600_000, NOW) === '2 小时前');
ck('time: days', relativeTime(NOW - 4 * 86400_000, NOW) === '4 天前');
ck('time: > a week → absolute MM-DD HH:MM', /^\d\d-\d\d \d\d:\d\d$/.test(relativeTime(NOW - 30 * 86400_000, NOW)));
ck('time: missing → empty', relativeTime(0, NOW) === '');
ck('time: clock skew (future) reads 刚刚', relativeTime(NOW + 5000, NOW) === '刚刚');

const m = feedRowModel(h, NOW);
ck('row: 发起 → 接收', m.from === 'tester' && m.to === 'demo-node');
ck('row: chip + relative time', m.chip.label === '已回复' && m.time === '3 分钟前');
ck('row: task id kept for the small line', m.taskId === 'task_demo_1');
ck('row: high priority flagged', m.high);
ck('row: a11y sentence', m.a11y === 'tester 发给 demo-node，已回复，3 分钟前');
const blank = feedRowModel({ ...lu, from: '', to: '' }, NOW);
ck('row: missing ends are labelled, not blank', blank.from === '（未知）' && blank.to === '（未指定）');

// ── click target ──
ck('click: I sent → chat with recipient, focused on that task (#463)', JSON.stringify(clickTarget(h, 'tester')) === JSON.stringify({ kind: 'chat', alias: 'demo-node', taskId: h.taskId }) && !!h.taskId);
ck('click: sent to me → chat with sender, focused on that task (#463)', JSON.stringify(clickTarget(lr, 'tester')) === JSON.stringify({ kind: 'chat', alias: 'demo-node', taskId: 'task_live' }));
ck('click: chat without a task id → no focus field', JSON.stringify(clickTarget({ ...lr, taskId: '' }, 'tester')) === JSON.stringify({ kind: 'chat', alias: 'demo-node' }));
ck('click: agent ↔ agent → task detail', JSON.stringify(clickTarget({ from: 'node-a', to: 'node-b', taskId: 't1' }, 'tester')) === JSON.stringify({ kind: 'task', taskId: 't1' }));
ck('click: identity unknown → task detail', clickTarget(h, undefined)?.kind === 'task');
ck('click: nothing to open → null', clickTarget({ from: 'node-a', to: 'node-b', taskId: '' }, 'tester') === null);

// ── status line + empty state ──
ck('status: connected + history', streamStatusLine({ conn: 'connected', historyCount: 12, liveCount: 0 }) === '实时连接中 · 最近 12 条任务');
ck('status: live count', streamStatusLine({ conn: 'connected', historyCount: 0, liveCount: 3 }) === '实时连接中 · 实时新增 3 条');
ck('status: history error said', streamStatusLine({ conn: 'disconnected', historyCount: 0, liveCount: 0, historyError: 'HTTP 500' }).includes('最近记录加载失败'));
ck('empty title', FEED_EMPTY_TITLE === '最近没有任务流转');

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
