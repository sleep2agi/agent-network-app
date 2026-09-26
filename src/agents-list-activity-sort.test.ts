// sortByActivity flag (off by default) — run: bun src/agents-list-activity-sort.test.ts
//
// Pins: with the flag off the in-team recency is still session.updated_at (today's order is
// unchanged); with it on, recency is the row's activity time (message / task), a heartbeat that
// moves updated_at does not reorder, rows with no activity sink below rows with activity, and the
// group order and the pinned / online levels above recency are untouched.

import { buildSections, compareInTeam, SORT_BY_ACTIVITY } from './agents-list';
import type { Session } from './api';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n} ${extra}`); };

const S = (alias: string, status: string, updated_at: string): Session => ({ alias, status, updated_at } as Session);
// 甲 heartbeats most recently; 乙 had the most recent real activity.
const a = S('TM甲', 'idle', '2026-09-26T10:00:00Z');
const b = S('TM乙', 'idle', '2026-09-26T09:00:00Z');
const c = S('TM丙', 'idle', '2026-09-26T08:00:00Z');
const act: Record<string, number> = { TM甲: Date.parse('2026-09-20T00:00:00Z'), TM乙: Date.parse('2026-09-26T08:30:00Z'), TM丙: 0 };
const activityAt = (alias: string) => act[alias] ?? 0;
const order = (sort: Parameters<typeof buildSections>[2]) =>
  buildSections([c, a, b], '', sort).map(s => `${s.title}:${s.data.map(x => x.alias).join(',')}`).join(' | ');

ck('flag is off by default', SORT_BY_ACTIVITY === false);
ck('flag off → in-team order by updated_at (unchanged behaviour)', order({ sort: { activityAt } }) === 'TM:TM甲,TM乙,TM丙', order({ sort: { activityAt } }));
ck('flag off explicitly → same', order({ sort: { sortByActivity: false, activityAt } }) === 'TM:TM甲,TM乙,TM丙');
ck('flag on → in-team order by activity, no-activity last', order({ sort: { sortByActivity: true, activityAt } }) === 'TM:TM乙,TM甲,TM丙', order({ sort: { sortByActivity: true, activityAt } }));
ck('flag on but no activityAt given → falls back to updated_at', order({ sort: { sortByActivity: true } }) === 'TM:TM甲,TM乙,TM丙');

// heartbeat immunity: bump 丙's updated_at to "now"; with the flag on it must not move up
const c2 = { ...c, updated_at: '2026-09-26T12:00:00Z' };
ck('flag on: a heartbeat (updated_at → now) does not reorder', buildSections([c2, a, b], '', { sort: { sortByActivity: true, activityAt } })[0].data.map(x => x.alias).join(',') === 'TM乙,TM甲,TM丙');
ck('flag off: the same heartbeat does reorder (what the flag exists to fix)', buildSections([c2, a, b], '', { sort: { activityAt } })[0].data[0].alias === 'TM丙');

// levels above recency still win
const off = S('TM丁', 'offline', '2026-09-26T11:00:00Z');
act['TM丁'] = Date.parse('2026-09-26T11:59:00Z');
ck('flag on: online still ranks above a more recent offline row', compareInTeam(b, off, { sortByActivity: true, activityAt }) < 0);
ck('flag on: pinned still ranks first', compareInTeam(c, b, { sortByActivity: true, activityAt, pinned: x => x === 'TM丙' }) < 0);
// group order unchanged by the flag
const x1 = S('工程A', 'idle', '2026-09-26T01:00:00Z'), x2 = S('工程B', 'idle', '2026-09-26T01:00:00Z');
const titles = (on: boolean) => buildSections([a, b, x1, x2], '', { sort: { sortByActivity: on, activityAt } }).map(s => s.title).join(',');
ck('group order is the same with the flag on or off', titles(true) === titles(false), `${titles(true)} vs ${titles(false)}`);

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
