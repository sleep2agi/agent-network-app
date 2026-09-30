// 日历视图(任务页第四个视图)的纯逻辑。ck 风格自执行(scripts/run-tests.mjs 逐个跑),不是 bun:test。
// 时区用固定偏移时钟,结果不随跑测试的机器变。
import { readFileSync } from 'node:fs';
import { fixedOffsetClock } from './due-time';
import {
  byDayOrder, calendarBuckets, calendarCells, calendarEntry, cellCapacity, cellOverflow, dayDot, entryOverdue, mondayOfDate, monthAnchorOf, shiftAnchor, swipeDelta,
} from './task-calendar-model';
import type { Requirement } from './requirements-model';
import { t, setLanguagePreference } from './i18n';
import './i18n-tasks';

let p = 0, tt = 0;
const ck = (n: string, c: boolean, extra = '') => { tt++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}${extra ? ` (${extra})` : ''}`); };
const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const cst = fixedOffsetClock(480);
const pst = fixedOffsetClock(-420);
const R = (id: string, o: Partial<Requirement> = {}): Requirement => ({
  id, name: `任务${id}`, priority: 'normal', assignee: '', due: '', column: 'pool', createdAt: '2026-09-20T02:00:00Z', owner: null, participants: [], ...o,
});

console.log('\n落在哪天(本地时区)');
ck('全天期限 = 那天,没有时刻', JSON.stringify(calendarEntry(R('a', { due: '2026-10-01' }), cst)?.time) === 'null' && calendarEntry(R('a', { due: '2026-10-01' }), cst)?.date === '2026-10-01');
ck('全天期限不随时区挪(西八区看也是 10-01)', calendarEntry(R('a', { due: '2026-10-01' }), pst)?.date === '2026-10-01');
const timed = R('b', { due: '2026-09-30T17:30:00Z' });
ck('带时刻:东八区是 10-01 01:30', calendarEntry(timed, cst)?.date === '2026-10-01' && calendarEntry(timed, cst)?.time === '01:30');
ck('带时刻:西七区是 09-30 10:30', calendarEntry(timed, pst)?.date === '2026-09-30' && calendarEntry(timed, pst)?.time === '10:30');
ck('没有期限 = null', calendarEntry(R('c'), cst) === null);

console.log('\n分天 / 排序');
const items = [
  R('t2', { due: '2026-10-01T06:00:00Z' }), // 14:00
  R('t1', { due: '2026-10-01T01:00:00Z' }), // 09:00
  R('d1', { due: '2026-10-01', priority: 'low' }),
  R('d0', { due: '2026-10-01', priority: 'high' }),
  R('dn', { due: '2026-10-01', column: 'done', priority: 'high' }),
  R('x', { due: '2026-10-02' }),
  R('u1', { createdAt: '2026-09-01T00:00:00Z' }),
  R('u2', { createdAt: '2026-09-05T00:00:00Z' }),
];
const b = calendarBuckets(items, cst);
ck('一天里:全天(按优先级)→ 按时刻 → 完成的最后', (b.days.get('2026-10-01') ?? []).map(e => e.item.id).join(',') === 'd0,d1,t1,t2,dn', (b.days.get('2026-10-01') ?? []).map(e => e.item.id).join(','));
ck('每张有期限的卡正好出现一次', [...b.days.values()].flat().length === 6);
ck('没有期限的单独给出,新建的在前', b.undated.map(i => i.id).join(',') === 'u2,u1');
ck('byDayOrder 同一时刻按优先级', byDayOrder({ item: R('h', { priority: 'high' }), date: 'd', time: '09:00' }, { item: R('n'), date: 'd', time: '09:00' }) < 0);

console.log('\n格子放不下');
ck('放得下全放', JSON.stringify(cellOverflow(3, 4)) === '{"shown":3,"more":0}');
ck('正好放满不出 +N', JSON.stringify(cellOverflow(4, 4)) === '{"shown":4,"more":0}');
ck('多一条:留一行给「+N」', JSON.stringify(cellOverflow(5, 4)) === '{"shown":3,"more":2}');
ck('一行都放不下:全进 +N', JSON.stringify(cellOverflow(2, 1)) === '{"shown":0,"more":2}' && JSON.stringify(cellOverflow(2, 0)) === '{"shown":0,"more":2}');
ck('格子高 → 行数', cellCapacity(100, 28, 22) === 3 && cellCapacity(20, 28, 22) === 0 && cellCapacity(NaN, 28, 22) === 0);

console.log('\n格子 / 翻页');
const month = calendarCells('2026-09-30', 'month');
ck('月:42 格,周一开头,包含整个 9 月', month.length === 42 && month[0].date === '2026-08-31' && month.filter(c => c.inMonth).length === 30);
const week = calendarCells('2026-09-30', 'week');
ck('周:锚点所在周一 → 周日', week.length === 7 && week[0].date === '2026-09-28' && week[6].date === '2026-10-04');
ck('周里跨月的日子标出不在本月', week.filter(c => !c.inMonth).map(c => c.date).join(',') === '2026-10-01,2026-10-02,2026-10-03,2026-10-04');
ck('mondayOfDate 周日 → 前一个周一', mondayOfDate('2026-10-04') === '2026-09-28');
ck('月翻页停在 1 日,跨年', shiftAnchor('2026-12-15', 'month', 1) === '2027-01-01' && shiftAnchor('2026-01-31', 'month', -1) === '2025-12-01');
ck('周翻页 ±7 天', shiftAnchor('2026-09-30', 'week', 1) === '2026-10-07' && shiftAnchor('2026-09-30', 'week', -1) === '2026-09-23');
ck('monthAnchorOf', monthAnchorOf('2026-10-04') === '2026-10-01');

console.log('\n手机');
ck('有没完成的 = 实心点;只有完成的 = 空心点;没有 = null',
  dayDot(b.days.get('2026-10-01')) === 'open' && dayDot([{ item: R('z', { column: 'done' }), date: '', time: null }]) === 'done' && dayDot(undefined) === null && dayDot([]) === null);
ck('横滑:左滑 = 下个月,右滑 = 上个月', swipeDelta(-80, 5) === 1 && swipeDelta(90, -10) === -1);
ck('横滑:位移太小或主要是竖着滚 = 不翻', swipeDelta(30, 0) === 0 && swipeDelta(-80, 70) === 0 && swipeDelta(NaN, 0) === 0);
ck('逾期:那天过了且没完成', entryOverdue({ item: R('o'), date: '2026-09-29', time: null }, '2026-09-30') && !entryOverdue({ item: R('o', { column: 'done' }), date: '2026-09-29', time: null }, '2026-09-30') && !entryOverdue({ item: R('o'), date: '2026-09-30', time: '01:00' }, '2026-09-30'));

console.log('\n接线');
const board = src('./RequirementBoard.tsx');
const store = src('./task-board-store.ts');
const cal = src('./TaskCalendar.tsx');
ck('分段里有「日历」,在甘特图后面', /\{ key: 'gantt', label: tr\('gantt\.view'\) \},\n[^\n]*\n\s*\{ key: 'calendar', label: tr\('cal\.view'\) \}/.test(board));
ck('TaskSection 有 calendar', /TaskSection = [^;]*'calendar'/.test(store));
ck('日历吃筛选后的 visible、点任务打开现有详情、手机走 narrow', /<TaskCalendar items=\{visible\}[^>]*onOpen=\{openDetail\}[^>]*phone=\{narrow\}/.test(board));
ck('只读:日历里没有写 Hub 的调用', !/updateRequirementOnHub|moveRequirementOnHub|onDue|saveEdit/.test(cal));
ck('周一开头(和期限选择器的月历同一组星期文案)', /const WEEK = \['tasks\.copy\.167'/.test(cal));
for (const lang of ['zh', 'en'] as const) {
  setLanguagePreference(lang);
  ck(`${lang}:日历文案都有翻译`, ['cal.view', 'cal.month', 'cal.week', 'cal.undatedChip', 'cal.emptyDay', 'cal.dayTitle'].every(k => t(k) !== k));
}
setLanguagePreference('zh');
ck('中文分段名就是「日历」;某天标题「9月30日 周三」', t('cal.view') === '日历' && t('cal.dayTitle', { md: '9月30日', wd: '三' }) === '9月30日 周三');

console.log(`\n${p}/${tt} passed`);
if (p !== tt) process.exit(1);
