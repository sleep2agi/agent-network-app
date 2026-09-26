// Last-activity time for rows whose preview is the task text — run: bun src/agent-task-time.test.ts
//
// Pins: the text↔task match (incl. the hub's light-status 160 + 「…」 trim); the time is the
// created_at of the LATEST task row and only when that row is the shown text; the resolver's
// read policy (heartbeats never re-read or move the time; a text change does; an online row is
// re-read after refreshMs so a same-text re-dispatch is picked up); failures keep the old answer.

import { normTaskText, taskMatchesText, taskTimeForText, TaskTimeResolver } from './agent-task-time';
import { hubTimeMs } from './agent-unread-counts';
import type { HubTask } from './api';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n} ${extra}`); };

// ── matching ──
const long = '【TMAI鲸 → 收件节点】' + '请核对这一批数据并回报结果。'.repeat(30);
// what /api/status?light=1 returns for sessions.task = content.slice(0, 200)
const lightOf = (content: string) => {
  const s = content.slice(0, 200).replace(/\s+/g, ' ').trim();
  return s.length > 160 ? `${s.slice(0, 160)}…` : s;
};
ck('normTaskText collapses whitespace and drops the trailing …', normTaskText('  a\n\tb … ') === 'a b' && normTaskText('x…') === 'x');
ck('normTaskText: non-string → empty', normTaskText(undefined) === '' && normTaskText(3) === '');
ck('light-trimmed session text matches its long task', taskMatchesText({ content: long }, lightOf(long)));
ck('full-status session text (slice 200) matches too', taskMatchesText({ content: long }, long.slice(0, 200)));
ck('multi-line task content matches its whitespace-collapsed text', taskMatchesText({ content: '[巡检探针]\n只做一件事:\n  回 OK' }, '[巡检探针] 只做一件事: 回 OK'));
ck('a different text does not match', !taskMatchesText({ content: '派给你的任务 A' }, '在跑 CI'));
ck('empty shown text never matches (would startsWith(\'\') everything)', !taskMatchesText({ content: 'anything' }, '') && !taskMatchesText({ content: 'anything' }, ' … '));
ck('missing content never matches', !taskMatchesText({}, 'x') && !taskMatchesText(null, 'x'));

const T = (content: string, created_at: string): HubTask => ({ content, created_at });
ck('time = created_at of the latest task when it is the shown text',
  taskTimeForText([T('派活 B', '2026-09-26 08:13:00')], '派活 B') === hubTimeMs('2026-09-26 08:13:00'));
ck('latest task is a different text (report_status overwrote it) → no time',
  taskTimeForText([T('派活 B', '2026-09-26 08:13:00')], '我自己上报的状态') === 0);
ck('no task rows → no time', taskTimeForText([], '派活 B') === 0 && taskTimeForText(null, '派活 B') === 0);

// ── resolver ──
let clock = 1_000_000;
const calls: string[] = [];
let rows: Record<string, HubTask[]> = {
  A: [T('派活 A', '2026-09-26 07:00:00')],
  B: [T('派活 B-new', '2026-09-26 09:00:00')],
};
let fail = false;
const r = new TaskTimeResolver(async alias => {
  calls.push(alias);
  if (fail) throw new Error('offline');
  return rows[alias] ?? [];
}, { now: () => clock, refreshMs: 60_000, concurrency: 2 });
let notified = 0;
r.subscribe(() => { notified++; });

(async () => {
  await r.request([
    { alias: 'A', text: '派活 A', online: true },
    { alias: 'B', text: '我自己的状态', online: true },
    { alias: 'C', text: '', online: true },
  ]);
  ck('A resolves to its task time', r.timeFor('A', '派活 A') === hubTimeMs('2026-09-26 07:00:00'));
  ck('B (text is not its latest task) resolves to 0', r.timeFor('B', '我自己的状态') === 0);
  ck('empty text is never looked up', !calls.includes('C'));
  ck('one read per alias', calls.filter(a => a === 'A').length === 1 && calls.filter(a => a === 'B').length === 1);
  ck('listeners hear about new answers', notified >= 1);

  // heartbeat: same text, time passes but < refreshMs, session.updated_at would have moved — nothing to see here
  clock += 30_000;
  const before = calls.length;
  await r.request([{ alias: 'A', text: '派活 A', online: true }]);
  ck('heartbeat (same text, within refreshMs) → no read', calls.length === before);
  ck('heartbeat → time unchanged', r.timeFor('A', '派活 A') === hubTimeMs('2026-09-26 07:00:00'));

  // timeFor asks about a different text than the cached one → 0 until it is resolved
  ck('a text the resolver has not seen yet has no time (never the old text\'s time)', r.timeFor('A', '派活 A2') === 0);

  // text changes → read again
  rows.A = [T('派活 A2', '2026-09-26 10:00:00')];
  await r.request([{ alias: 'A', text: '派活 A2', online: true }]);
  ck('text change → re-read, new time', r.timeFor('A', '派活 A2') === hubTimeMs('2026-09-26 10:00:00'));

  // same text re-dispatched later (hourly probe): picked up only after refreshMs, and only online
  rows.A = [T('派活 A2', '2026-09-26 11:00:00')];
  clock += 61_000;
  await r.request([{ alias: 'A', text: '派活 A2', online: true }]);
  ck('online + older than refreshMs → re-read picks up the re-dispatch', r.timeFor('A', '派活 A2') === hubTimeMs('2026-09-26 11:00:00'));
  const offBefore = calls.length;
  clock += 61_000;
  await r.request([{ alias: 'A', text: '派活 A2', online: false }]);
  ck('offline rows are not re-read for the same text', calls.length === offBefore);

  // a failed read keeps the previous answer and is retried later
  fail = true;
  clock += 61_000;
  await r.request([{ alias: 'A', text: '派活 A2', online: true }]);
  ck('failed read keeps the last good time', r.timeFor('A', '派活 A2') === hubTimeMs('2026-09-26 11:00:00'));
  fail = false;
  const retryBefore = calls.length;
  await r.request([{ alias: 'A', text: '派活 A2', online: true }]);
  ck('after a failure the next poll retries', calls.length === retryBefore + 1);

  // concurrent duplicate requests share one read
  const dupBefore = calls.length;
  await Promise.all([
    r.request([{ alias: 'D', text: 'x', online: true }]),
    r.request([{ alias: 'D', text: 'x', online: true }]),
  ]);
  ck('duplicate in-flight lookups are coalesced', calls.length === dupBefore + 1);

  console.log(`${p}/${t} passed`);
  process.exit(p === t ? 0 : 1);
})();
