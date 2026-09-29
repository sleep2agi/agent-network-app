// 需求优先级 P0–P3(owner 09-30)。存的值不变(high / normal / low),新增 lowest = P3 极低;
// 旧 Hub(列表 capabilities 没有 priority_lowest)不给选 P3,不发它会拒的值。
import { readFileSync } from 'node:fs';
import { t as translate, setLanguagePreference } from './i18n';
import './i18n-tasks';
import { requirementFromHub } from './requirements-hub';
import { REQ_PRIORITIES, sortColumn, type Requirement } from './requirements-model';
import { applyFilter, createInput, editDraftOf, editPatch, emptyDraft, sortRows, EMPTY_FILTER } from './task-board-model';
import { PRIORITY_CODE, PRIORITY_RANK, priorityChoices, priorityLabel, supportsLowest } from './task-priority';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`); };
const R = (id: string, priority: Requirement['priority'], createdAt = '2026-09-30T00:00:00Z'): Requirement => ({ id, name: `任务${id}`, assignee: '', priority, due: '', column: 'pool', createdAt });

console.log('# 值与文案');
ck('四档,顺序 P0→P3,存的值不变', JSON.stringify(REQ_PRIORITIES) === JSON.stringify(['high', 'normal', 'low', 'lowest']));
ck('代号', REQ_PRIORITIES.map(x => PRIORITY_CODE[x]).join() === 'P0,P1,P2,P3');
setLanguagePreference('zh');
ck('中文全称', REQ_PRIORITIES.map(priorityLabel).join('|') === 'P0 最高|P1 普通|P2 低|P3 极低');
setLanguagePreference('en');
ck('English labels', REQ_PRIORITIES.map(priorityLabel).join('|') === 'P0 Highest|P1 Normal|P2 Low|P3 Lowest');
ck('English a11y on the card badge', translate('tasks.copy.84', { v0: priorityLabel('lowest') }) === 'Priority P3 Lowest');
setLanguagePreference('zh');

console.log('# 读 Hub');
ck('Hub 给 lowest = 读成 P3(不再当普通)', requirementFromHub({ id: 'a', name: 'x', priority: 'lowest' })?.priority === 'lowest');
ck('不认识的值仍按普通', requirementFromHub({ id: 'a', name: 'x', priority: 'urgent' })?.priority === 'normal');

console.log('# 旧 Hub 不给选 P3');
ck('capabilities 带 priority_lowest = 收', supportsLowest(['tags', 'priority_lowest']) && !supportsLowest(['tags']) && !supportsLowest([]));
ck('新 Hub 四档', priorityChoices(true).join() === 'high,normal,low,lowest');
ck('旧 Hub 三档', priorityChoices(false).join() === 'high,normal,low');
ck('旧 Hub 上已经是 P3 的卡:当前值留在选择器里', priorityChoices(false, 'lowest').join() === 'high,normal,low,lowest');
const board = readFileSync(new URL('./RequirementBoard.tsx', import.meta.url), 'utf8');
ck('看板按 capabilities 算选项,传给新建与详情', /supportsLowest\(st\.capabilities\)/.test(board) && /priorities=\{priorityOptions\}/.test(board) && /lowestPriority=\{lowestPriority\}/.test(board));
ck('筛着 P3 在旧 Hub 上新建:不带 P3', /filter\.priorities\.length === 1 && priorityOptions\.includes\(filter\.priorities\[0\]\)/.test(board));
const dialog = readFileSync(new URL('./TaskCreateDialog.tsx', import.meta.url), 'utf8');
ck('选择器只画传进来的几档(没有默认全四档)', /choices\.map\(/.test(dialog) && !/choices = REQ_PRIORITIES/.test(dialog));

console.log('# 新建默认 P1 普通');
ck('新建草稿默认 normal', emptyDraft().priority === 'normal');
ck('选了 P3 就按 P3 建', createInput({ ...emptyDraft(), name: '极低的活', priority: 'lowest' })?.priority === 'lowest');

console.log('# 改');
const low = R('l', 'lowest');
ck('P3 卡不改优先级 = 不提交 priority', editPatch(low, { ...editDraftOf(low), name: '改个名' })?.priority === undefined);
ck('改成 P3 = 提交 lowest', editPatch(R('n', 'normal'), { ...editDraftOf(R('n', 'normal')), priority: 'lowest' })?.priority === 'lowest');

console.log('# 排序:P3 排在 P2 后面');
ck('rank', PRIORITY_RANK.low < PRIORITY_RANK.lowest && PRIORITY_RANK.high < PRIORITY_RANK.normal);
const mixed = [R('d', 'lowest'), R('b', 'normal'), R('c', 'low'), R('a', 'high')];
ck('看板列里 P0→P3', sortColumn(mixed).map(x => x.id).join('') === 'abcd');
ck('列表按优先级升序 P0→P3', sortRows(mixed, { key: 'priority', dir: 'asc' }).map(x => x.id).join('') === 'abcd');
ck('降序 P3→P0', sortRows(mixed, { key: 'priority', dir: 'desc' }).map(x => x.id).join('') === 'dcba');
ck('别的列排序时兜底也是 P0→P3', sortRows(mixed, { key: 'status', dir: 'asc' }).map(x => x.id).join('') === 'abcd');

console.log('# 筛选');
ck('只看 P3', applyFilter(mixed, { ...EMPTY_FILTER, priorities: ['lowest'] }).map(x => x.id).join() === 'd');
ck('P2 + P3', applyFilter(mixed, { ...EMPTY_FILTER, priorities: ['low', 'lowest'] }).map(x => x.id).sort().join() === 'c,d');

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
