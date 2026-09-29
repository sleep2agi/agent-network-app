// 任务页「状态」筛选(owner 09-29「筛选不能对那个状态进行筛选吗？」):
// 列表里按状态藏行,看板里只画选中的列,「隐藏已完成」= 需求池 + 进行中。
// ck 风格自执行(scripts/run-tests.mjs 逐个跑),不是 bun:test。
import { readFileSync } from 'node:fs';
import { applyFilter, boardColumns, EMPTY_FILTER, filterActive, HIDE_DONE, hidesDone, matchesFilter, projectCounts, toggleHideDone, type BoardFilter } from './task-board-model';
import { taskTranslations } from './i18n-tasks';
import { t, setLanguagePreference } from './i18n';
import type { Requirement } from './requirements-model';

let p = 0, tt = 0;
const ck = (n: string, c: boolean, extra = '') => { tt++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}${extra ? ` (${extra})` : ''}`); };
const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

const R = (id: string, o: Partial<Requirement> = {}): Requirement => ({
  id, name: `任务${id}`, priority: 'normal', assignee: '', due: '', column: 'pool', createdAt: `2026-09-2${id.length}T00:00:00Z`, owner: null, participants: [], ...o,
});
const items: Requirement[] = [
  R('a', { priority: 'high' }),
  R('b', { column: 'doing' }),
  R('c', { column: 'doing', priority: 'high', projectId: 'p1' }),
  R('d', { column: 'done', priority: 'high' }),
  R('e', { projectId: 'p1' }),
];
const ids = (rows: readonly Requirement[]) => rows.map(r => r.id).sort().join(',');
const cols = (f: BoardFilter) => boardColumns(items, f).map(c => `${c.column}:${c.items.map(i => i.id).sort().join('')}`).join(' ');

console.log('\n列表:按状态藏行');
ck('不选状态 = 全部', ids(applyFilter(items, EMPTY_FILTER)) === 'a,b,c,d,e');
ck('只选进行中', ids(applyFilter(items, { ...EMPTY_FILTER, statuses: ['doing'] })) === 'b,c');
ck('多选需求池 + 完成', ids(applyFilter(items, { ...EMPTY_FILTER, statuses: ['pool', 'done'] })) === 'a,d,e');
ck('空数组 = 不筛', ids(applyFilter(items, { ...EMPTY_FILTER, statuses: [] })) === 'a,b,c,d,e');
ck('和优先级叠加(与)', ids(applyFilter(items, { ...EMPTY_FILTER, priorities: ['high'], statuses: ['doing', 'done'] })) === 'c,d');
ck('和项目叠加(与)', ids(applyFilter(items, { ...EMPTY_FILTER, project: 'p1', statuses: ['pool'] })) === 'e');
ck('matchesFilter 单条', !matchesFilter(items[3], { ...EMPTY_FILTER, statuses: ['pool', 'doing'] }) && matchesFilter(items[1], { ...EMPTY_FILTER, statuses: ['doing'] }));

console.log('\n看板:只画选中的列');
ck('不筛:三列都在', cols(EMPTY_FILTER) === 'pool:ae doing:bc done:d', cols(EMPTY_FILTER));
ck('只选进行中:只剩一列', cols({ ...EMPTY_FILTER, statuses: ['doing'] }) === 'doing:bc', cols({ ...EMPTY_FILTER, statuses: ['doing'] }));
ck('选完成 + 需求池:两列,顺序按看板而不是点选顺序', cols({ ...EMPTY_FILTER, statuses: ['done', 'pool'] }) === 'pool:ae done:d');
ck('选中的列没有卡也要画出来(空列)', cols({ ...EMPTY_FILTER, priorities: ['low'], statuses: ['doing'] }) === 'doing:');
ck('别的筛选让某列变空时不藏列(只按状态藏)', cols({ ...EMPTY_FILTER, priorities: ['low'] }) === 'pool: doing: done:');

console.log('\n隐藏已完成');
ck('HIDE_DONE = 需求池 + 进行中', HIDE_DONE.join(',') === 'pool,doing');
ck('hidesDone 认顺序无关的同一组合', hidesDone(['doing', 'pool']) && hidesDone(['pool', 'doing']));
ck('hidesDone 其它组合为假', !hidesDone(undefined) && !hidesDone([]) && !hidesDone(['pool']) && !hidesDone(['pool', 'doing', 'done']));
ck('点一次:任意 → 需求池 + 进行中', toggleHideDone([]).join(',') === 'pool,doing' && toggleHideDone(['done']).join(',') === 'pool,doing');
ck('再点一次:清空', toggleHideDone(['pool', 'doing']).length === 0);
ck('看板只剩两列', cols({ ...EMPTY_FILTER, statuses: toggleHideDone(undefined) }) === 'pool:ae doing:bc');

console.log('\n筛选状态');
ck('选了状态算「有筛选」(清除按钮 / 空列文案)', filterActive({ ...EMPTY_FILTER, statuses: ['done'] }) && !filterActive({ ...EMPTY_FILTER, statuses: [] }) && !filterActive(EMPTY_FILTER));
ck('项目计数跟着状态筛选', projectCounts(items, { ...EMPTY_FILTER, statuses: ['doing'] }).get('p1') === 1);

console.log('\n界面接线(源码)');
const board = src('./RequirementBoard.tsx');
const at = (s: string) => board.indexOf(s);
ck('状态 chip 在项目 chip 之后', at('testID="task-filter-project"') > 0 && at('testID="task-filter-status"') > at('testID="task-filter-project"'));
ck('状态 chip 用同一个 Chip 组件', /<Chip[\s\S]{0,400}testID="task-filter-status"/.test(board));
ck('「清除筛选」也清状态', /setTaskFilter\(\{ owners: \[\], priorities: \[\], project: '', statuses: \[\]/.test(board));
ck('弹层里有「隐藏已完成」', board.includes("tr('tasks.hideDone')") && board.includes('status-hide-done'));
ck('看板和手机列表都走 boardColumns', board.includes('boardColumns(items, filter)'));

console.log('\n文案');
ck('三条新文案都有中英', ['tasks.filterStatus', 'tasks.filterStatusA11y', 'tasks.hideDone'].every(k => { setLanguagePreference('en'); const en = t(k); setLanguagePreference('zh'); const zh = t(k); return en !== k && zh !== k && en !== zh; }));
ck('不占用 append-only 编号', !Object.values(taskTranslations).some(([zh]) => zh === '隐藏已完成'));

console.log(`\n${p}/${tt} passed`);
if (p !== tt) process.exit(1);
