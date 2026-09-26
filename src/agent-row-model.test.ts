// Agent list row model (0.2.106 WeChat-style rows) — run: bun src/agent-row-model.test.ts
//
// Pins: the row dimensions; status → dot / label (no 「在线」 word); the right-column time
// format; the preview line; and that the time never comes from session.updated_at (the hub
// bumps it on every heartbeat).

import {
  AGENT_ROW_AVATAR, AGENT_ROW_DOT, AGENT_ROW_GAP, AGENT_ROW_HEIGHT, AGENT_ROW_PAD_X, AGENT_ROW_SEPARATOR_INSET,
  agentRowModel, formatRowTime, latestMessageByAgent, previewText, rowActivity, rowStatus,
} from './agent-row-model';
import { latestMessageAtByAgent } from './agent-unread-counts';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n} ${extra}`); };

// ── dimensions ──
ck('row height is within the 64–72 dp target', AGENT_ROW_HEIGHT >= 64 && AGENT_ROW_HEIGHT <= 72, String(AGENT_ROW_HEIGHT));
ck('avatar is 44 dp', AGENT_ROW_AVATAR === 44);
ck('avatar + vertical padding fits the row', AGENT_ROW_AVATAR + 2 * 12 === AGENT_ROW_HEIGHT);
ck('online dot is small (≤ 14 dp)', AGENT_ROW_DOT > 0 && AGENT_ROW_DOT <= 14);
ck('separator starts under the text (after avatar + gap)', AGENT_ROW_SEPARATOR_INSET === AGENT_ROW_PAD_X + AGENT_ROW_AVATAR + AGENT_ROW_GAP);
ck('row side padding ≥ 16 (the divider strip covers 16 dp of the list edge)', AGENT_ROW_PAD_X >= 16);

// ── status → dot / label ──
const idle = rowStatus('idle');
ck('idle: online, green dot, NO word (the dot already says online)', idle.online && idle.dot === 'running' && idle.label === null);
ck('no status ever produces the word 在线', ['idle', 'working', 'running', 'error', 'failed', 'blocked', 'offline', '', 'weird'].every(s => rowStatus(s).label !== '在线'));
const working = rowStatus('working');
ck('working: 工作中 label in the running tone', working.online && working.label === '工作中' && working.labelTone === 'running');
ck('running is the same as working', JSON.stringify(rowStatus('running')) === JSON.stringify(working));
ck('error / failed: 异常 in the failed tone, red dot', rowStatus('error').label === '异常' && rowStatus('failed').dot === 'failed' && rowStatus('error').labelTone === 'failed');
ck('blocked: 阻塞, amber dot', rowStatus('blocked').label === '阻塞' && rowStatus('blocked').dot === 'blocked');
const off = rowStatus('offline');
ck('offline: not online, grey dot, no word (dimmed avatar says it)', !off.online && off.dot === 'rest' && off.label === null);
ck('missing status reads as offline', !rowStatus(undefined).online && !rowStatus('').online && !rowStatus(null).online);
ck('unknown live status reads as online, no word', rowStatus('thinking').online && rowStatus('thinking').label === null);

// ── time: device-local calendar, built with the local Date constructor so any TZ passes ──
const now = new Date(2026, 8, 26, 15, 30, 0).getTime();   // Sat 2026-09-26 15:30 local
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
ck('0 / NaN / negative → empty column', formatRowTime(0, now) === '' && formatRowTime(NaN, now) === '' && formatRowTime(-1, now) === '');
ck('< 1 min → 刚刚', formatRowTime(now - 30_000, now) === '刚刚');
ck('clock skew (slightly in the future) → 刚刚', formatRowTime(now + 90_000, now) === '刚刚');
ck('today → HH:MM (zero-padded)', formatRowTime(at(2026, 9, 26, 9, 5), now) === '09:05');
ck('today just after midnight → HH:MM, not 昨天', formatRowTime(at(2026, 9, 26, 0, 1), now) === '00:01');
ck('yesterday late evening → 昨天', formatRowTime(at(2026, 9, 25, 23, 59), now) === '昨天');
ck('yesterday early → 昨天', formatRowTime(at(2026, 9, 25, 0, 0), now) === '昨天');
ck('3 days ago (Wed) → 周三', formatRowTime(at(2026, 9, 23, 10), now) === '周三', formatRowTime(at(2026, 9, 23, 10), now));
ck('6 days ago (Sun) → 周日', formatRowTime(at(2026, 9, 20, 10), now) === '周日');
ck('7 days ago → M/D', formatRowTime(at(2026, 9, 19, 10), now) === '9/19');
ck('earlier this year → M/D', formatRowTime(at(2026, 1, 3, 10), now) === '1/3');
ck('previous year → YYYY/M/D', formatRowTime(at(2025, 12, 31, 23), now) === '2025/12/31');
ck('previous year but within the week → still weekday (Jan 2 vs Dec 30)', formatRowTime(at(2026, 12, 30, 10), at(2027, 1, 2, 10)) === '周三');

// ── preview + latest message ──
ck('preview collapses whitespace / newlines', previewText('  第一行\n\n第二行\t尾  ') === '第一行 第二行 尾');
ck('preview is capped', previewText('x'.repeat(200)).length === 80);
ck('non-string preview → empty', previewText(undefined) === '' && previewText(42) === '');

const serverBody = { messages: [
  { from_session: '节点A', created_at: '2026-09-26 06:00:00', content: '旧的' },
  { from_session: '节点A', created_at: '2026-09-26 07:00:00', content: '新的\n一条' },
  { from_session: '节点B', created_at: '2026-09-26 05:00:00', title: '只有标题' },
  { from_session: '', created_at: '2026-09-26 07:00:00', content: '无主' },
] };
const replyRows = [
  { id: 'r1', from_alias: '节点B', to_alias: 'tester', created_at: '2026-09-26 08:00:00', content: '回给我的' },
  { id: 'r2', from_alias: '节点C', to_alias: '别人', created_at: '2026-09-26 09:00:00', content: '不是给我的' },
];
const latest = latestMessageByAgent({ serverBody, replyRows, replyUsername: 'tester' });
ck('latest per agent = newest message text', latest['节点A']?.text === '新的 一条');
ck('reply rows to me count (and win when newer)', latest['节点B']?.text === '回给我的');
ck('reply rows to someone else are ignored', !latest['节点C']);
ck('rows without a sender are ignored', !('' in latest));
ck('title is used when a message has no content', latestMessageByAgent({ serverBody: { messages: [serverBody.messages[2]] } })['节点B']?.text === '只有标题');
const atByAgent = latestMessageAtByAgent({ serverBody, replyRows: replyRows as any, replyUsername: 'tester' });
ck('same times as the 新消息 group sort (latestMessageAtByAgent)', Object.keys(atByAgent).every(a => atByAgent[a] === latest[a]?.at) && Object.keys(latest).length === Object.keys(atByAgent).length);
ck('garbage body → empty map', Object.keys(latestMessageByAgent({ serverBody: null })).length === 0 && Object.keys(latestMessageByAgent({ serverBody: { messages: 'x' } })).length === 0);

// ── row model ──
const heartbeat = { alias: '节点A', status: 'idle', task: '在跑 CI', updated_at: new Date(now).toISOString() } as any;
const noMsg = agentRowModel(heartbeat, { nowMs: now });
ck('no message → time column empty even though updated_at is "now" (heartbeat)', noMsg.time === '', noMsg.time);
ck('no message → preview falls back to the reported task', noMsg.preview === '在跑 CI');
const withMsg = agentRowModel(heartbeat, { latest: { at: at(2026, 9, 26, 14, 2), text: '好的，已经处理' }, nowMs: now, pinned: true });
ck('message → preview is its text, time is its time', withMsg.preview === '好的，已经处理' && withMsg.time === '14:02');
ck('pinned flag carried', withMsg.pinned && !noMsg.pinned);
ck('nothing at all → empty preview (not "undefined")', agentRowModel({ alias: 'x', status: 'offline' }, { nowMs: now }).preview === '');
ck('model status is rowStatus(status)', JSON.stringify(agentRowModel({ alias: 'w', status: 'working' }).status) === JSON.stringify(rowStatus('working')));

// ── preview ↔ time pairing (0.2.114: every row whose preview has a source gets that source's time) ──
const taskAt = at(2026, 9, 26, 8, 13);
const taskRow = agentRowModel(heartbeat, { taskAt, nowMs: now });
ck('task text preview → time is that task\'s time', taskRow.preview === '在跑 CI' && taskRow.time === '08:13' && taskRow.source === 'task', JSON.stringify(taskRow));
const msgWins = agentRowModel(heartbeat, { latest: { at: at(2026, 9, 24, 9), text: '旧消息' }, taskAt, nowMs: now });
ck('message preview → message time, never the task time', msgWins.preview === '旧消息' && msgWins.time === '周四' && msgWins.source === 'message', JSON.stringify(msgWins));
const emptyMsg = agentRowModel(heartbeat, { latest: { at: at(2026, 9, 24, 9), text: '' }, taskAt, nowMs: now });
ck('message with no text → preview is the task, and so is the time', emptyMsg.preview === '在跑 CI' && emptyMsg.time === '08:13' && emptyMsg.source === 'task', JSON.stringify(emptyMsg));
const emptyMsgNoTask = agentRowModel({ alias: 'q', status: 'idle' }, { latest: { at: at(2026, 9, 24, 9), text: '' }, nowMs: now });
ck('message with no text and no task → no preview, message time', emptyMsgNoTask.preview === '' && emptyMsgNoTask.time === '周四');
const unmatchedEmptyMsg = agentRowModel(heartbeat, { latest: { at: at(2026, 9, 24, 9), text: '' }, taskAt: 0, nowMs: now });
ck('task text preview with no task time never borrows a (textless) message time', unmatchedEmptyMsg.preview === '在跑 CI' && unmatchedEmptyMsg.time === '', JSON.stringify(unmatchedEmptyMsg));
const unmatched = agentRowModel(heartbeat, { taskAt: 0, nowMs: now });
ck('task text with no task row behind it → no time (not a borrowed one)', unmatched.time === '' && unmatched.source === null && unmatched.activityAt === 0);
ck('no data at all → no preview, no time', (() => { const m = agentRowModel({ alias: 'z', status: 'idle' }, { taskAt, nowMs: now }); return m.preview === '' && m.time === '' && m.activityAt === 0; })());
// heartbeat immunity: updated_at moves, activity stays
const hb1 = agentRowModel({ ...heartbeat, updated_at: new Date(now - 3600_000).toISOString() }, { taskAt, nowMs: now });
const hb2 = agentRowModel({ ...heartbeat, updated_at: new Date(now).toISOString() }, { taskAt, nowMs: now });
ck('heartbeat (updated_at moves) → same time and activityAt', hb1.time === hb2.time && hb1.activityAt === hb2.activityAt && hb2.time === '08:13');
ck('activityAt is the shown event\'s ms', taskRow.activityAt === taskAt && msgWins.activityAt === at(2026, 9, 24, 9));
ck('rowActivity is what agentRowModel shows', JSON.stringify(rowActivity(heartbeat, undefined, taskAt)) === JSON.stringify({ preview: '在跑 CI', source: 'task', at: taskAt }));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
