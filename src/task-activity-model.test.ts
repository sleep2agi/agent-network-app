// 「动态」视图的纯逻辑。ck 风格自执行(scripts/run-tests.mjs 逐个跑),不是 bun:test。
// 「哪一天」按本机时区:固定成东八区,结果不随跑测试的机器变。
process.env.TZ = 'Asia/Shanghai';
import {
  COLLAPSE_MS, activityFilterCount, activityType, collapseEvents, countBy, dayLabel, describe, fieldSummary, filterEvents, groupByDay, isMyCard,
  localDay, mergeEvents, parseEvents, tally, EMPTY_ACTIVITY_FILTER, type ActivityEvent, type Part,
} from './task-activity-model';
import type { Requirement } from './requirements-model';

let p = 0, tt = 0;
const ck = (n: string, c: boolean, extra = '') => { tt++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}${extra ? ` (${extra})` : ''}`); };

// 2026-09-30 周三 17:45 东八区
const NOW = Date.parse('2026-09-30T09:45:00Z');
const min = (m: number) => new Date(NOW - m * 60_000).toISOString();
let seq = 1000;
const ev = (o: Partial<ActivityEvent> & { minAgo: number }): ActivityEvent => {
  const at = min(o.minAgo);
  return { id: String(seq--), requirementId: 'r1', seq: 1, title: '示例', actor: { kind: 'user', id: 'u_a' }, kind: 'changed', field: 'priority', old: 'normal', new: 'high', at, ms: Date.parse(at), ...o };
};
const card = (id: string, o: Partial<Requirement> = {}): Requirement => ({ id, name: id, priority: 'normal', assignee: '', due: '', column: 'pool', createdAt: '2026-09-01T00:00:00Z', owner: null, participants: [], projectId: null, ...o });
const keys = (ps: Part[]) => ps.map(x => (x.t === 'text' ? x.key : x.t)).join(' ');

// ── parse ──
{
  const r = parseEvents({ events: [
    { id: '9', requirement_id: 'r1', seq: 3, title: 'T', actor: { kind: 'node', id: 'n1' }, kind: 'changed', field: 'priority', old: 'low', new: 'high', at: '2026-09-30T09:00:00.000Z' },
    { id: '8', requirement_id: 'r1', kind: 'bogus', at: '2026-09-30T09:00:00.000Z' },
    { id: '7', requirement_id: 'r1', kind: 'created', at: 'nope' },
    { id: '6', requirement_id: 'r2', kind: 'deleted', actor: { kind: 'robot', id: 'x' }, at: '2026-09-30T08:00:00.000Z' },
  ], next_cursor: '6', server_time: '2026-09-30T09:45:00.000Z', has_more: true });
  ck('parse keeps well-formed rows, drops bad kind / bad time', r.events.map(e => e.id).join() === '9,6');
  ck('parse: actor of an unknown kind reads as null', r.events[1].actor === null);
  ck('parse: cursor / server_time / has_more', r.nextCursor === '6' && r.serverTime === '2026-09-30T09:45:00.000Z' && r.hasMore);
  ck('parse: garbage → empty', parseEvents(null).events.length === 0 && parseEvents({ events: 'x' }).nextCursor === null);
}

// ── merge ──
{
  const a = ev({ id: '5', minAgo: 10 }), b = ev({ id: '6', minAgo: 5 }), b2 = { ...b, title: '改了' };
  const m = mergeEvents([a, b], [b2, ev({ id: '7', minAgo: 1 })]);
  ck('merge dedupes by id (later read wins) and sorts newest first', m.map(e => e.id).join() === '7,6,5' && m[1].title === '改了');
  const same = mergeEvents([], [ev({ id: '10', minAgo: 1 }), ev({ id: '11', minAgo: 1 })]);
  ck('merge: same instant → larger id first', same[0].id === '11');
}

// ── types ──
ck('type: column → done is 完成', activityType({ kind: 'changed', field: 'column', new: 'done' }) === 'done');
ck('type: column → doing is 状态', activityType({ kind: 'changed', field: 'column', new: 'doing' }) === 'status');
ck('type: agent_owner is 负责人/参与人', activityType({ kind: 'changed', field: 'agent_owner', new: null }) === 'people');
ck('type: due and priority share one type', activityType({ kind: 'changed', field: 'due', new: '' }) === 'schedule' && activityType({ kind: 'changed', field: 'priority', new: 'high' }) === 'schedule');
ck('type: checklist_item is 检查项', activityType({ kind: 'changed', field: 'checklist_item', new: {} }) === 'checklist');
ck('type: deleted and archived are one type', activityType({ kind: 'deleted', field: null, new: null }) === 'archive' && activityType({ kind: 'changed', field: 'archived', new: true }) === 'archive');

// ── collapse ──
{
  seq = 500;
  const events = [
    ev({ minAgo: 3, field: 'tags', old: [], new: ['a'] }),
    ev({ minAgo: 4, field: 'priority' }),
    ev({ minAgo: 5, actor: { kind: 'node', id: 'n1' }, field: 'column', old: 'pool', new: 'doing' }), // someone else in between
    ev({ minAgo: 6, field: 'column', old: 'pool', new: 'doing' }),
    ev({ minAgo: 7, field: 'title', old: 'x', new: 'y' }),
    ev({ minAgo: 7 + 6, field: 'due', old: '', new: '2026-10-03' }), // 6 min gap → new row
    ev({ minAgo: 20, kind: 'created', field: null, old: null, new: null }),
    ev({ minAgo: 21, requirementId: 'r2', field: 'priority' }),
  ];
  const rows = collapseEvents(events);
  ck('collapse: same actor + card within 5 min → one row, even with someone else in between', rows[0].events.length === 4, String(rows[0].events.length));
  ck('collapse: the other actor is its own row, placed by its time', rows[1].actor?.kind === 'node' && rows[1].events.length === 1);
  ck('collapse: a gap over 5 min between neighbours starts a new row', rows[2].events.length === 1 && rows[2].events[0].field === 'due');
  ck('collapse: created is always its own row', rows[3].events[0].kind === 'created' && rows[3].events.length === 1);
  ck('collapse: a different card is a different row', rows[4].requirementId === 'r2');
  ck('collapse: row at = newest, from = oldest', rows[0].at === events[0].at && rows[0].from === events[4].at);
  ck('collapse: boundary — exactly 5 min apart still joins', collapseEvents([ev({ minAgo: 0 }), ev({ minAgo: COLLAPSE_MS / 60_000 })]).length === 1);
  ck('collapse: 5 min + 1 s apart does not', collapseEvents([ev({ minAgo: 0 }), ev({ minAgo: COLLAPSE_MS / 60_000 + 1 / 60 })]).length === 2);
  const sum = fieldSummary(collapseEvents([
    ev({ minAgo: 1, field: 'checklist_item', new: { done: true } }), ev({ minAgo: 2, field: 'checklist_item', new: { done: true } }), ev({ minAgo: 3, field: 'description' }),
  ])[0]);
  ck('fieldSummary: oldest first, checklist ticks counted ×2', JSON.stringify(sum) === JSON.stringify([{ field: 'description', n: 1 }, { field: 'checklist', n: 2 }]));
}

// ── filter ──
{
  seq = 300;
  const cards = new Map<string, Requirement>([
    ['r1', card('r1', { owner: { kind: 'user', id: 'u_me' }, projectId: 'p1' })],
    ['r2', card('r2', { participants: [{ kind: 'user', id: 'u_me' }] })],
    ['r3', card('r3', { projectId: 'p2' })],
  ]);
  const events = [
    ev({ minAgo: 1, requirementId: 'r1', actor: { kind: 'node', id: 'n1' } }),
    ev({ minAgo: 2, requirementId: 'r2', field: 'column', new: 'done' }),
    ev({ minAgo: 3, requirementId: 'r3', field: 'tags', old: [], new: ['x'] }),
    ev({ minAgo: 4, requirementId: 'gone', kind: 'deleted', field: null }),
  ];
  const f = (o: Partial<typeof EMPTY_ACTIVITY_FILTER>) => filterEvents(events, { ...EMPTY_ACTIVITY_FILTER, ...o }, cards, 'u_me').map(e => e.requirementId).join();
  ck('filter: none → all', f({}) === 'r1,r2,r3,gone');
  ck('filter: 我的任务 = I own it or participate; deleted cards are not mine', f({ mine: true }) === 'r1,r2');
  ck('filter: project', f({ project: 'p2' }) === 'r3');
  ck('filter: 未分项目 = on the board with no project', f({ project: 'none' }) === 'r2');
  ck('filter: actor', f({ actors: ['node:n1'] }) === 'r1');
  ck('filter: types', f({ types: ['done', 'tags'] }) === 'r2,r3');
  ck('filter count', activityFilterCount({ mine: true, project: 'p1', actors: ['a'], types: [] }) === 2);
  ck('isMyCard: no meId → false', !isMyCard(cards.get('r1'), null));
  ck('countBy', countBy(events, e => activityType(e)).get('schedule') === 1);
}

// ── days ──
{
  seq = 200;
  const rows = collapseEvents([ev({ minAgo: 1 }), ev({ minAgo: 60 * 24, requirementId: 'r9' }), ev({ minAgo: 60 * 24 * 3, requirementId: 'r8' })]);
  const days = groupByDay(rows);
  ck('days: three local days, newest first', days.map(d => d.day).join() === '2026-09-30,2026-09-29,2026-09-27');
  ck('days: today / yesterday / older', dayLabel(days[0].day, NOW) === 'today' && dayLabel(days[1].day, NOW) === 'yesterday' && dayLabel(days[2].day, NOW) === null);
  ck('days: the local day of 23:59 UTC+8 is still that day', localDay(Date.parse('2026-09-30T15:59:00Z')) === '2026-09-30' && localDay(Date.parse('2026-09-30T16:00:00Z')) === '2026-10-01');
  ck('days: count = events, not rows', groupByDay(collapseEvents([ev({ minAgo: 1 }), ev({ minAgo: 2 })]))[0].count === 2);
}

// ── describe ──
{
  seq = 100;
  const d = (o: Partial<ActivityEvent>) => describe(ev({ minAgo: 1, ...o }));
  ck('describe: priority → 将优先级 P → P', keys(d({ field: 'priority', old: 'low', new: 'high' }).lead) === 'act.setField priority arrow priority');
  ck('describe: priority detail starts with the field name', keys(d({ field: 'priority', old: 'low', new: 'high' }).detail) === 'act.f.priority priority arrow priority');
  const done = d({ field: 'column', old: 'doing', new: 'done' });
  ck('describe: → done is 完成了任务 (with the done mark)', keys(done.lead) === 'act.done' && done.done === true);
  ck('describe: out of done is 重新打开', keys(d({ field: 'column', old: 'done', new: 'doing' }).lead) === 'act.reopened status');
  ck('describe: title shows old struck through', (() => { const l = d({ field: 'title', old: 'a', new: 'b' }).lead; return l[1].t === 'quote' && (l[1] as any).strike === true && (l[3] as any).v === 'b'; })());
  ck('describe: due cleared → 无', keys(d({ field: 'due', old: '2026-10-08', new: '' }).lead) === 'act.setField date arrow act.none');
  ck('describe: tags added + removed', keys(d({ field: 'tags', old: ['a', 'b'], new: ['b', 'c'] }).lead) === 'act.tagsAdded tag act.andRemoved tag');
  ck('describe: participants added', keys(d({ field: 'participants', old: [], new: [{ kind: 'user', id: 'u1' }] }).lead) === 'act.participantsAdded person');
  ck('describe: agent owner set', keys(d({ field: 'agent_owner', old: null, new: { kind: 'node', id: 'n1' } }).lead) === 'act.set.agentOwner person');
  ck('describe: owner cleared', keys(d({ field: 'owner', old: { kind: 'user', id: 'u1' }, new: null }).lead) === 'act.clear.owner');
  ck('describe: checklist tick', keys(d({ field: 'checklist_item', old: { id: 'a', text: 'x', done: false }, new: { id: 'a', text: 'x', done: true } }).lead) === 'act.checked check quote');
  ck('describe: project move', keys(d({ field: 'project', old: 'p1', new: 'p2' }).lead) === 'act.movedFrom project act.movedTo project');
  ck('describe: archived', keys(d({ field: 'archived', old: false, new: true }).lead) === 'act.archived');
  ck('describe: unknown field does not throw', keys(d({ field: 'mystery' }).lead) === 'act.changedOther');
  ck('describe: bad values do not throw', (() => { try { d({ field: 'participants', old: 'x', new: 5 }); d({ field: 'column', old: 7, new: {} }); return true; } catch { return false; } })());
}

// ── tally ──
ck('tally: members vs agents', JSON.stringify(tally([ev({ minAgo: 1 }), ev({ minAgo: 1, actor: { kind: 'node', id: 'n' } }), ev({ minAgo: 1, actor: null })])) === JSON.stringify({ total: 3, members: 1, agents: 1 }));

console.log(`${p}/${tt} passed`);
process.exit(p === tt ? 0 : 1);
