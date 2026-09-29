// 甘特图(任务页第三个视图)的纯逻辑。ck 风格自执行(scripts/run-tests.mjs 逐个跑),不是 bun:test。
// 时区用固定偏移时钟(东八区),结果不随跑测试的机器变。
import { readFileSync } from 'node:fs';
import { fixedOffsetClock } from './due-time';
import {
  GANTT_DAY_PX, GANTT_MAX_BACK_DAYS, GANTT_START_SOURCE, NO_AGENT_GROUP, NO_PROJECT_GROUP,
  agentOf, barGeometry, barOverdue, dayDiff, firstCurrentWeek, ganttBar, ganttEnd, ganttGroups, ganttRange, ganttStart, ganttTicks, ganttWeeks,
  mondayOf, plusDays, todayX, weekStrip, weekdayOf,
} from './task-gantt-model';
import type { Requirement, RequirementProject } from './requirements-model';
import { t, setLanguagePreference } from './i18n';
import './i18n-tasks';

let p = 0, tt = 0;
const ck = (n: string, c: boolean, extra = '') => { tt++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}${extra ? ` (${extra})` : ''}`); };
const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const cst = fixedOffsetClock(480);
const R = (id: string, o: Partial<Requirement> = {}): Requirement => ({
  id, name: `任务${id}`, priority: 'normal', assignee: '', due: '', column: 'pool', createdAt: '2026-09-20T02:00:00Z', owner: null, participants: [], ...o,
});

console.log('\n日期运算');
ck('dayDiff 跨月', dayDiff('2026-09-28', '2026-10-02') === 4);
ck('plusDays 跨年', plusDays('2026-12-30', 3) === '2027-01-02');
ck('2026-09-30 是周三(周一 = 0)', weekdayOf('2026-09-30') === 2);
ck('mondayOf 周日 → 前一个周一', mondayOf('2026-10-04') === '2026-09-28');
ck('mondayOf 周一 → 自己', mondayOf('2026-09-28') === '2026-09-28');

console.log('\n开始 / 结束');
ck('开始来源写明是创建时间(STEP 1:Hub 没有开始字段)', GANTT_START_SOURCE === 'createdAt');
ck('开始 = 创建时间的本地日期(UTC 16:30 = 东八区次日)', ganttStart(R('a', { createdAt: '2026-09-20T16:30:00Z' }), cst) === '2026-09-21');
ck('创建时间读不出 = null', ganttStart(R('a', { createdAt: '' }), cst) === null);
ck('全天期限 = 那一天', ganttEnd(R('a', { due: '2026-10-01' }), cst) === '2026-10-01');
ck('带时刻的期限按本地日期', ganttEnd(R('a', { due: '2026-09-30T17:00:00Z' }), cst) === '2026-10-01');
ck('没有期限 = null', ganttEnd(R('a'), cst) === null && ganttBar(R('a'), cst) === null);
const normal = ganttBar(R('a', { due: '2026-10-01' }), cst)!;
ck('正常的条:创建日 → 期限日', normal.start === '2026-09-20' && normal.end === '2026-10-01' && !normal.collapsed);
const late = ganttBar(R('a', { createdAt: '2026-10-05T00:00:00Z', due: '2026-10-01' }), cst)!;
ck('创建晚于期限:只画期限那一天,不画倒着的条', late.start === '2026-10-01' && late.end === '2026-10-01' && late.collapsed);
const noCreated = ganttBar(R('a', { createdAt: '', due: '2026-10-01' }), cst)!;
ck('没有创建时间:只画期限那一天', noCreated.start === noCreated.end && noCreated.collapsed);

console.log('\n分组');
const projects: RequirementProject[] = [
  { id: 'p2', name: '乙', color: '#22aa55', sort: 2, archived: false },
  { id: 'p1', name: '甲', color: '#2255aa', sort: 1, archived: false },
];
const items: Requirement[] = [
  R('a', { due: '2026-10-03', projectId: 'p2', agentOwner: { kind: 'node', id: 'n_b' } }),
  R('b', { due: '2026-10-01', projectId: 'p1', createdAt: '2026-09-25T00:00:00Z', agentOwner: { kind: 'node', id: 'n_a' } }),
  R('c', { due: '2026-10-02', projectId: null, owner: { kind: 'node', id: 'n_a' } }),
  R('d', { due: '2026-10-01', projectId: 'p1', createdAt: '2026-09-10T00:00:00Z' }),
  R('e', { projectId: 'p1', createdAt: '2026-09-01T00:00:00Z' }),
  R('f', { projectId: 'p1', createdAt: '2026-09-02T00:00:00Z' }),
  R('g', { due: '2026-10-04', projectId: 'gone' }),
];
const byProject = ganttGroups(items, { groupBy: 'project', projects, clock: cst });
ck('按项目:项目排序 → 已删项目 → 无项目最后', byProject.groups.map(g => g.key).join(',') === `p1,p2,gone,${NO_PROJECT_GROUP}`, byProject.groups.map(g => g.key).join(','));
ck('组内按开始 → 结束', byProject.groups[0].bars.map(b => b.item.id).join('') === 'db');
ck('已删项目的组没有 project 对象(界面按「无项目」的名字画)', byProject.groups[2].kind === 'project' && byProject.groups[2].project === undefined);
ck('没有期限的不进组,进「未设期限」,新建的在前', byProject.undated.map(i => i.id).join('') === 'fe');
ck('每张有期限的卡正好出现一次', byProject.groups.flatMap(g => g.bars).length === 5);
const names: Record<string, string> = { n_a: '乙节点', n_b: '甲节点' };
const byAgent = ganttGroups(items, { groupBy: 'agent', projects, clock: cst, nameOf: ref => names[ref.id] ?? ref.id });
ck('按 Agent:按名字排,无负责 Agent 最后', byAgent.groups.map(g => g.key).join(',') === `node:n_b,node:n_a,${NO_AGENT_GROUP}`, byAgent.groups.map(g => g.key).join(','));
ck('旧 Hub(负责人是节点)也归到那个 Agent', byAgent.groups[1].bars.map(b => b.item.id).sort().join('') === 'bc');
ck('agentOf:负责 Agent 优先;人类负责人不算 Agent', agentOf(R('x', { owner: { kind: 'user', id: 'u' } })) === null && agentOf(R('x', { owner: { kind: 'node', id: 'n' }, agentOwner: { kind: 'node', id: 'm' } }))?.id === 'm');
const oldHub = ganttGroups(items, { groupBy: 'project', projects: null, clock: cst });
ck('旧 Hub 没有项目:按项目分组退化成一整组', oldHub.groups.length === 1 && oldHub.groups[0].kind === 'none' && oldHub.groups[0].bars.length === 5);

console.log('\n范围 / 位置');
const today = '2026-09-30';
const bars = byProject.groups.flatMap(g => g.bars);
const range = ganttRange(bars, today);
ck('范围从周一开始、到周日结束', weekdayOf(range.start) === 0 && weekdayOf(plusDays(range.start, range.days - 1)) === 6, `${range.start}+${range.days}`);
ck('范围包含最早的开始和今天', range.start <= '2026-09-10' && dayDiff(range.start, today) > 0);
ck('今天之后至少留三周', dayDiff(today, plusDays(range.start, range.days - 1)) >= 21);
const ancient = ganttBar(R('z', { createdAt: '2025-01-01T00:00:00Z', due: '2026-10-01' }), cst)!;
const r2 = ganttRange([ancient], today);
ck(`很早建的卡:最多往回 ${GANTT_MAX_BACK_DAYS} 天(+对齐)`, dayDiff(r2.start, today) <= GANTT_MAX_BACK_DAYS + 10 && dayDiff(r2.start, today) >= GANTT_MAX_BACK_DAYS);
const geoA = barGeometry(ancient, r2, 10);
ck('被截断的条从 0 画起并标记', geoA.x === 0 && geoA.clippedLeft && geoA.w === (dayDiff(r2.start, '2026-10-01') + 1) * 10);
const geo = barGeometry(normal, range, GANTT_DAY_PX.day);
ck('条宽 = 天数(含两头) × 每天宽', geo.w === 12 * GANTT_DAY_PX.day && geo.x === dayDiff(range.start, '2026-09-20') * GANTT_DAY_PX.day && !geo.clippedLeft);
ck('一天的条也有一整天宽', barGeometry(late, range, 32).w === 32);
ck('今天线在那一天的中间', todayX(range, today, 32) === dayDiff(range.start, today) * 32 + 16);
ck('今天不在范围里 = null', todayX({ start: '2026-01-05', days: 7 }, today, 32) === null);

console.log('\n刻度');
const days = ganttTicks(range, 'day');
ck('日刻度:每天一格', days.length === range.days && days[1].x === 32);
ck('日刻度:第一格和每月 1 日标月份', days[0].monthStart && days.filter(t => t.monthStart).every((t, i) => i === 0 || t.day === 1));
ck('日刻度:周六周日标周末', days.filter(t => t.weekend).every(t => weekdayOf(t.date) >= 5) && days.filter(t => t.weekend).length === range.days / 7 * 2);
const weeks = ganttTicks(range, 'week');
ck('周刻度:每个周一一格,x 间隔 7 × 10', weeks.length === range.days / 7 && weeks.every(t => weekdayOf(t.date) === 0) && weeks[1].x - weeks[0].x === 70);
ck('周刻度:换月的那一周标月份(且只有它)', weeks.every((t, i) => t.monthStart === (i === 0 || weeks[i - 1].month !== t.month)) && weeks.some((t, i) => i > 0 && t.monthStart));

console.log('\n逾期');
ck('期限已过且没完成 = 逾期', barOverdue(ganttBar(R('o', { due: '2026-09-29' }), cst)!, today));
ck('期限是今天不算逾期', !barOverdue(ganttBar(R('o', { due: today }), cst)!, today));
ck('完成的不算逾期', !barOverdue(ganttBar(R('o', { due: '2026-09-29', column: 'done' }), cst)!, today));

console.log('\n手机:按周列表');
const wk = ganttWeeks([
  R('a', { due: '2026-10-06' }),
  R('b', { due: '2026-09-22' }),
  R('c', { due: '2026-10-01' }),
  R('d', { due: '2026-09-28', createdAt: '2026-09-27T00:00:00Z' }),
  R('e'),
], today, cst);
ck('按期限所在的周分组,按时间先后', wk.weeks.map(w => `${w.monday}:${w.offset}`).join(' ') === '2026-09-21:-1 2026-09-28:0 2026-10-05:1', wk.weeks.map(w => `${w.monday}:${w.offset}`).join(' '));
ck('周内按期限', wk.weeks[1].bars.map(b => b.item.id).join('') === 'dc');
ck('没有期限的单独一组', wk.undated.map(i => i.id).join('') === 'e');
ck('打开时先到本周', firstCurrentWeek(wk.weeks) === 1);
ck('都在过去就停在最后一组', firstCurrentWeek(wk.weeks.slice(0, 1)) === 0 && firstCurrentWeek([]) === 0);
const d = wk.weeks[1].bars[0];
ck('七格小条:周日开始、周一结束 → 只亮周一', weekStrip(d, '2026-09-28').map(Number).join('') === '1000000');
ck('七格小条:跨整周 → 全亮', weekStrip(ganttBar(R('x', { due: '2026-10-20' }), cst)!, '2026-09-28').every(Boolean));

console.log('\n接线');
const board = src('./RequirementBoard.tsx');
const store = src('./task-board-store.ts');
ck('任务页分段有第三项「甘特图」,紧跟看板', /key: 'board'[^\n]*\n[^\n]*\n\s*\{ key: 'gantt', label: tr\('gantt\.view'\) \}/.test(board));
ck('TaskSection 有 gantt', /TaskSection = [^;]*'gantt'/.test(store));
ck('甘特图吃筛选后的 visible、点条打开现有详情、手机走 narrow', /<TaskGantt items=\{visible\}[^>]*onOpen=\{openDetail\}[^>]*phone=\{narrow\}/.test(board));
const gantt = src('./TaskGantt.tsx');
ck('只读:甘特图里没有写 Hub 的调用', !/updateRequirementOnHub|moveRequirementOnHub|PATCH/.test(gantt));
ck('工具栏写明开始 = 创建时间', /gantt\.startNote/.test(gantt));
for (const lang of ['zh', 'en'] as const) {
  setLanguagePreference(lang);
  ck(`${lang}:甘特图文案都有翻译`, ['gantt.view', 'gantt.startNote', 'gantt.undated', 'gantt.byProject', 'gantt.byAgent', 'gantt.thisWeek'].every(k => t(k) !== k));
}
setLanguagePreference('zh');
ck('中文分段名就是「甘特图」', t('gantt.view') === '甘特图');

console.log(`\n${p}/${tt} passed`);
if (p !== tt) process.exit(1);
