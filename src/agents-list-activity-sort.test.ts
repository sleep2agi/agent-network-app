// Sort by activity (SORT_BY_ACTIVITY, ON since the owner's 2026-09-26 call) — run: bun src/agents-list-activity-sort.test.ts
//
// Pins, with the flag ON: pinned rows stay on top; groups (and their order) are kept; inside a group
// rows go most recent activity first; rows with no time go after every timed row, in the old order
// minus updated_at (online > alias); a heartbeat (updated_at moving) never reorders anything.
// With the flag OFF the old comparator (pinned > online > updated_at > alias) is untouched.

import { buildSections, compareInTeam, SORT_BY_ACTIVITY, type SortContext } from './agents-list';
import type { Session } from './api';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n} ${extra}`); };

const S = (alias: string, status: string, updated_at: string): Session => ({ alias, status, updated_at } as Session);
const ms = (iso: string) => Date.parse(iso);

// Team 演示: 甲 heartbeats most recently but its activity is old; 乙 had the latest activity;
// 丙 / 丁 / 戊 have no activity at all (戊 offline, 丁 heartbeating hardest).
const a = S('演示甲', 'idle', '2026-09-26T10:00:00Z');
const b = S('演示乙', 'idle', '2026-09-26T09:00:00Z');
const c = S('演示丙', 'idle', '2026-09-26T08:00:00Z');
const d = S('演示丁', 'idle', '2026-09-26T11:00:00Z');
const e = S('演示戊', 'offline', '2026-09-26T07:00:00Z');
// An offline row with recent activity: activity outranks online when both rows have a time.
const f = S('演示己', 'offline', '2026-09-20T00:00:00Z');
// Team 工程 (a second group).
const g = S('工程一', 'idle', '2026-09-26T01:00:00Z');
const h = S('工程二', 'idle', '2026-09-26T01:00:00Z');
const act: Record<string, number> = {
  演示甲: ms('2026-09-20T00:00:00Z'), 演示乙: ms('2026-09-26T08:30:00Z'), 演示己: ms('2026-09-25T12:00:00Z'),
  工程一: ms('2026-09-24T00:00:00Z'), 工程二: ms('2026-09-26T09:59:00Z'),
};
const activityAt = (alias: string) => act[alias] ?? 0;
const ON: SortContext = { sortByActivity: true, activityAt };
const all = [e, c, a, d, g, b, f, h];
const layout = (list: Session[], sort: SortContext) =>
  buildSections(list, '', { sort }).map(s => `${s.title}:${s.data.map(x => x.alias).join(',')}`).join(' | ');

// ── the flag ──
ck('flag is ON (owner 2026-09-26)', SORT_BY_ACTIVITY === true);

// ── ON: order inside a group ──
const on = layout(all, ON);
ck('ON: timed rows most recent first, then untimed rows (online > alias), groups kept',
  on === '演示:演示乙,演示己,演示甲,演示丁,演示丙,演示戊 | 工程:工程二,工程一', on);
ck('ON: every timed row is above every untimed row in its group', (() => {
  const rows = buildSections(all, '', { sort: ON })[0].data.map(x => activityAt(x.alias) > 0);
  return rows.indexOf(false) > 0 && rows.slice(rows.indexOf(false)).every(x => !x);
})());
ck('ON: untimed rows ignore updated_at (丁 is the freshest heartbeat but sorts by name after online peers)',
  compareInTeam(c, d, ON) > 0 && compareInTeam(d, c, ON) < 0);
ck('ON: untimed online row above untimed offline row (old order level kept)', compareInTeam(c, e, ON) < 0);
const early = S('演示一', 'offline', '2026-09-26T12:00:00Z'); // name sorts before every other 演示 row
ck('ON: untimed offline row sorts after untimed online rows even when its name sorts first', compareInTeam(early, c, ON) > 0 && compareInTeam(c, early, ON) < 0);
ck('ON: a NaN / negative activity time counts as no time', compareInTeam(S('演示N', 'idle', ''), b, { sortByActivity: true, activityAt: x => (x === '演示N' ? NaN : activityAt(x)) }) > 0);

// ── ON: pinned stays on top ──
const pinnedCtx: SortContext = { ...ON, pinned: x => x === '演示丙' || x === '工程一' };
const secs = buildSections(all, '', { sort: pinnedCtx });
ck('ON: pinned rows go to the 置顶 group, first', secs[0].title === '置顶' && secs[0].data.map(x => x.alias).join(',') === '工程一,演示丙', secs.map(s => s.title).join(','));
ck('ON: pinned (untimed) still ranks above a timed row in the comparator', compareInTeam(c, b, pinnedCtx) < 0);

// ── ON: heartbeat immunity ──
const beat = (s: Session, iso: string) => ({ ...s, updated_at: iso });
const beaten = [beat(e, '2026-09-26T12:00:00Z'), beat(c, '2026-09-26T12:00:01Z'), a, beat(d, '2026-09-20T00:00:00Z'), g, beat(b, '2020-01-01T00:00:00Z'), f, beat(h, '2026-09-26T12:00:00Z')];
ck('ON: heartbeats (every updated_at moved) do not reorder anything', layout(beaten, ON) === on, layout(beaten, ON));
ck('ON: input order does not matter', layout([...all].reverse(), ON) === on);

// ── group order is independent of the flag ──
const titles = (sort: SortContext) => buildSections(all, '', { sort }).map(s => s.title).join(',');
ck('group order is the same with the flag on or off', titles(ON) === titles({ activityAt }), `${titles(ON)} vs ${titles({ activityAt })}`);

// ── OFF: the old comparator, untouched ──
const off = layout(all, { activityAt });
ck('OFF: in-team order is online > updated_at > alias (old behaviour)', off === '演示:演示丁,演示甲,演示乙,演示丙,演示戊,演示己 | 工程:工程一,工程二', off);
ck('OFF explicitly → same as omitted', layout(all, { sortByActivity: false, activityAt }) === off);
ck('ON without activityAt → falls back to the old order', layout(all, { sortByActivity: true }) === off);
ck('OFF: a heartbeat does reorder (what the flag fixes)', layout(beaten, { activityAt }) !== off);

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
