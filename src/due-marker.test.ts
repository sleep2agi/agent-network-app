// 到期提示 + 快捷筛选(#491 / #493)。ck 风格自执行。
// 所有换算都注入固定偏移时钟(东八区 / 纽约夏令时 / UTC+14 / UTC−10),结果不随跑测试的机器时区变。
import { dueDayDiff, dueLocalDate, dueMarker, dueMarkerLabel, dueSettled, isOverdue } from './due-marker';
import { fixedOffsetClock, localDateOf } from './due-time';
import {
  applyFilter, boardColumns, dueInfo, EMPTY_FILTER, filterActive, filterForScope, QUICK_FILTERS, quickFilterOn, scopeOf, toggleQuickFilter,
  type BoardFilter,
} from './task-board-model';
import type { Requirement } from './requirements-model';
import { setLanguagePreference } from './i18n';
import { dueInfo as dueInfoText } from './i18n-task-presentation';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}${extra ? ` (${extra})` : ''}`); };
const SH = fixedOffsetClock(480);    // 东八区
const NY = fixedOffsetClock(-240);   // 纽约夏令时
const KI = fixedOffsetClock(840);    // UTC+14(本地日期最常和 UTC 不同的地方)
const HI = fixedOffsetClock(-600);   // UTC−10

// 东八区 2026-10-03 09:00 = UTC 2026-10-03 01:00
const NOW = Date.parse('2026-10-03T01:00:00Z');
const at = { now: NOW, clock: SH };
const m = (due: string, column = 'pool', archived?: boolean) => dueMarker({ due, column, archived }, at);

console.log('# 全天期限');
ck('今天 → today「今天到期」', m('2026-10-03').kind === 'today' && dueMarkerLabel(m('2026-10-03')) === '今天到期');
ck('明天 → tomorrow「明天到期」', m('2026-10-04').kind === 'tomorrow' && dueMarkerLabel(m('2026-10-04')) === '明天到期');
ck('后天及以后 → 不提示', m('2026-10-05').kind === 'none' && dueMarkerLabel(m('2026-10-05')) === '');
ck('昨天 → 已逾期 1 天', m('2026-10-02').kind === 'overdue' && dueMarkerLabel(m('2026-10-02')) === '已逾期 1 天');
ck('跨月 / 跨年按日历算', dueMarkerLabel(m('2026-09-30')) === '已逾期 3 天' && dueMarker({ due: '2025-12-31', column: 'pool' }, { now: Date.parse('2026-01-01T12:00:00Z'), clock: SH }).n === 1);
ck('今天的全天期限在当天 23:59 仍不算逾期', dueMarker({ due: '2026-10-03', column: 'pool' }, { now: Date.parse('2026-10-03T15:59:00Z'), clock: SH }).kind === 'today');
ck('过了本地午夜就是逾期 1 天', dueMarker({ due: '2026-10-03', column: 'pool' }, { now: Date.parse('2026-10-03T16:00:01Z'), clock: SH }).kind === 'overdue');

console.log('# 已完成 / 已归档 / 空 / 不合法');
ck('已完成永不逾期、也不提示今天', m('2026-09-01', 'done').kind === 'none' && m('2026-10-03', 'done').kind === 'none');
ck('已归档同已完成', m('2026-09-01', 'doing', true).kind === 'none' && dueSettled({ column: 'pool', archived: true }));
ck('进行中照常逾期', m('2026-09-01', 'doing').kind === 'overdue');
ck('没有期限 → none', m('').kind === 'none' && dueLocalDate('') === null);
for (const bad of ['明天', '2026-02-30', '2026-13-01', '2026-10-03T25:00:00Z', '2026-10-03T10:00:00', '10/03/2026']) {
  ck(`不合法「${bad}」→ none、不算逾期`, m(bad).kind === 'none' && !isOverdue({ due: bad, column: 'pool' }, at));
}

console.log('# 时刻期限');
ck('今天稍后 → 今天 HH:MM 到期', m('2026-10-03T10:30:00Z').kind === 'today' && dueInfo('2026-10-03T10:30:00Z', '2026-10-03', 'pool', NOW, SH).label === '今天 18:30 到期');
ck('今天早些时候已过 → 已逾期 N 小时(按真实时刻)', dueMarkerLabel(m('2026-10-02T22:00:00Z')) === '已逾期 3 小时');
ck('刚过几分钟 → 已逾期 N 分钟(至少 1)', dueMarkerLabel(m('2026-10-03T00:59:50Z')) === '已逾期 1 分钟' && dueMarkerLabel(m('2026-10-03T00:15:00Z')) === '已逾期 45 分钟');
ck('满一天 → 已逾期 N 天', dueMarkerLabel(m('2026-09-30T01:00:00Z')) === '已逾期 3 天');
ck('明天 09:00 → 明天 HH:MM 到期', dueInfo('2026-10-04T01:00:00Z', '2026-10-03', 'pool', NOW, SH).label === '明天 09:00 到期' && m('2026-10-04T01:00:00Z').kind === 'tomorrow');

console.log('# 时区边界(UTC 日期 ≠ 本地日期)');
{
  // UTC 2026-10-03 11:30 —— UTC+14 已经是 10-04 01:30,UTC−10 还是 10-03 01:30。
  const now = Date.parse('2026-10-03T11:30:00Z');
  ck('UTC+14 的「今天」是 10-04(不是 UTC 的 10-03)', localDateOf(now, KI) === '2026-10-04');
  ck('UTC+14:全天 10-04 = 今天到期', dueMarker({ due: '2026-10-04', column: 'pool' }, { now, clock: KI }).kind === 'today');
  ck('UTC+14:全天 10-03 = 已逾期 1 天(UTC 那边还是今天)', dueMarkerLabel(dueMarker({ due: '2026-10-03', column: 'pool' }, { now, clock: KI })) === '已逾期 1 天');
  ck('UTC−10:全天 10-03 = 今天到期', dueMarker({ due: '2026-10-03', column: 'pool' }, { now, clock: HI }).kind === 'today');
  ck('UTC−10:全天 10-04 = 明天到期(不因按 UTC 解析而提前一天)', dueMarker({ due: '2026-10-04', column: 'pool' }, { now, clock: HI }).kind === 'tomorrow');
  ck('全天日期不随时区平移', dueLocalDate('2026-10-04', KI) === '2026-10-04' && dueLocalDate('2026-10-04', HI) === '2026-10-04');
  // 同一个时刻:纽约 10-02 晚上,东八区已是 10-03 上午
  const inst = '2026-10-03T02:00:00Z';
  ck('时刻按本地日期取日:纽约 10-02、东八区 10-03', dueLocalDate(inst, NY) === '2026-10-02' && dueLocalDate(inst, SH) === '2026-10-03');
  ck('日差按本地日期', dueDayDiff(inst, '2026-10-02', NY) === 0 && dueDayDiff(inst, '2026-10-02', SH) === 1);
}

console.log('# 已逾期筛选 = 红色胶囊同源');
const R = (id: string, o: Partial<Requirement>): Requirement => ({ id, name: id, priority: 'normal', assignee: '', column: 'pool', due: '', createdAt: '2026-09-01T00:00:00Z', owner: null, participants: [], ...o } as Requirement);
const me = { kind: 'user' as const, id: 'u_me' };
const other = { kind: 'user' as const, id: 'u_other' };
const items: Requirement[] = [
  R('a', { due: '2026-10-01', owner: me }),                         // 逾期 · 我负责
  R('b', { due: '2026-10-03', owner: other, participants: [me] }),  // 今天 · 我参与
  R('c', { due: '2026-09-01', column: 'done', owner: me }),         // 已完成(不算逾期)
  R('d', { due: '2026-09-20', owner: other, participants: [me] }),  // 逾期 · 我参与
  R('e', { due: '2026-09-20', owner: other, archived: true }),      // 已归档(不算逾期)
  R('f', { due: '', owner: me }),                                   // 没期限
  R('g', { due: '2026-10-02T23:00:00Z', owner: other, column: 'doing', priority: 'high' }), // 时刻已过 · 进行中
];
const ids = (rows: readonly Requirement[]) => rows.map(r => r.id).join(',');
const ov: BoardFilter = { ...EMPTY_FILTER, overdue: true };
ck('只留逾期、未完成、未归档的', ids(applyFilter(items, ov, at)) === 'a,d,g', ids(applyFilter(items, ov, at)));
ck('每张被筛出的卡胶囊都是红的;没被筛出的都不是', items.every(i => (dueInfo(i.due, '2026-10-03', i.archived ? 'done' : i.column, NOW, SH).tone === 'overdue') === applyFilter([i], ov, at).length > 0));
ck('「已逾期」算作筛选中(出现「清除筛选」)', filterActive(ov) && !filterActive(EMPTY_FILTER));
ck('和优先级取交集', ids(applyFilter(items, { ...ov, priorities: ['high'] }, at)) === 'g');
ck('和状态取交集', ids(applyFilter(items, { ...ov, statuses: ['pool'] }, at)) === 'a,d');
ck('看板的列也按它筛', boardColumns(items, ov, at).map(c => `${c.column}:${c.items.length}`).join(' ') === 'pool:2 doing:1 done:0');

console.log('# 快捷筛选:我负责 / 我参与');
{
  const meId = 'u_me';
  let f: BoardFilter = { ...EMPTY_FILTER };
  ck('三项:mine / participating / overdue', QUICK_FILTERS.join(',') === 'mine,participating,overdue');
  f = toggleQuickFilter(f, 'mine', meId);
  ck('点「我负责」= 负责人是我', quickFilterOn(f, 'mine', meId) && ids(applyFilter(items, f, at)) === 'a,c,f', ids(applyFilter(items, f, at)));
  ck('与左栏「我负责的」是同一份状态', scopeOf(f.owners, meId, f.participant) === 'mine' && JSON.stringify(f) === JSON.stringify(filterForScope(EMPTY_FILTER, 'mine', meId)));
  f = toggleQuickFilter(f, 'participating', meId);
  ck('点「我参与」:换成参与人里有我(与「我负责」互斥,同左栏)', quickFilterOn(f, 'participating', meId) && !quickFilterOn(f, 'mine', meId) && ids(applyFilter(items, f, at)) === 'b,d');
  f = toggleQuickFilter(f, 'overdue', meId);
  ck('「我参与」+「已逾期」取交集', quickFilterOn(f, 'overdue', meId) && quickFilterOn(f, 'participating', meId) && ids(applyFilter(items, f, at)) === 'd');
  f = toggleQuickFilter(f, 'participating', meId);
  ck('再点「我参与」关掉:回到全部负责人,已逾期保留', !quickFilterOn(f, 'participating', meId) && f.owners.length === 0 && !f.participant && f.overdue === true);
  f = toggleQuickFilter({ ...f, priorities: ['high'], project: 'p1' }, 'mine', meId);
  ck('快捷筛选不动其余筛选(优先级 / 项目)', f.priorities.join() === 'high' && f.project === 'p1' && f.overdue === true);
  f = toggleQuickFilter(f, 'overdue', meId);
  ck('再点「已逾期」关掉', !f.overdue && quickFilterOn(f, 'mine', meId));
  const noMe = toggleQuickFilter(EMPTY_FILTER, 'mine', null);
  ck('不知道我是谁时「我负责 / 我参与」不改筛选', noMe === EMPTY_FILTER && toggleQuickFilter(EMPTY_FILTER, 'participating', null) === EMPTY_FILTER);
  ck('不知道我是谁时「已逾期」照样能用', toggleQuickFilter(EMPTY_FILTER, 'overdue', null).overdue === true);
  ck('多选负责人时「我负责」不亮', !quickFilterOn({ ...EMPTY_FILTER, owners: ['user:u_me', 'user:u_other'] }, 'mine', meId));
}

console.log('# 英文界面');
{
  setLanguagePreference('en');
  const tx = (due: string, col = 'pool') => dueInfoText(due, '2026-10-03', col as 'pool', NOW, SH).label;
  ck('Due today / Due tomorrow', tx('2026-10-03') === 'Due today' && tx('2026-10-04') === 'Due tomorrow', `${tx('2026-10-03')} | ${tx('2026-10-04')}`);
  ck('Due today 18:30 / Due tomorrow 09:00', tx('2026-10-03T10:30:00Z') === 'Due today 18:30' && tx('2026-10-04T01:00:00Z') === 'Due tomorrow 09:00', `${tx('2026-10-03T10:30:00Z')} | ${tx('2026-10-04T01:00:00Z')}`);
  ck('3d overdue / 3h overdue', tx('2026-09-30') === '3d overdue' && tx('2026-10-02T22:00:00Z') === '3h overdue');
  setLanguagePreference('zh');
  ck('切回中文', dueInfoText('2026-10-03', '2026-10-03', 'pool', NOW, SH).label === '今天到期');
}

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
