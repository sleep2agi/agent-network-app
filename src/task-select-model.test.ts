// 项目 / 母任务下拉、桌面多选与批量改、检查项改名(task-select-model.ts + 接线)。
import { readdirSync, readFileSync } from 'node:fs';
import { anchorSelectMenu, descendantIds, filterSelectOptions, isSelectClick, NO_SELECTION, parentCandidates, pruneSelection, runBulk, selectClick, toggleSelected, type BulkProgress } from './task-select-model';
import { editDraftOf, editPatch } from './task-board-model';
import { patchApplied } from './task-board-model';
import { t as translate, setLanguagePreference } from './i18n';
import './i18n-tasks';
import type { Requirement } from './requirements-model';
import { duePanelPlacement } from './task-select-model';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`); };
const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const R = (id: string, parentId: string | null | undefined, extra: Partial<Requirement> = {}): Requirement => ({ id, name: `任务${id}`, assignee: '', priority: 'normal', due: '', column: 'pool', createdAt: '', parentId, ...extra } as Requirement);

console.log('# 下拉');
{
  const opts = [{ id: '', label: '无' }, { id: 'a', label: '登录页', sub: '进行中' }, { id: 'b', label: 'Hub 升级', keywords: 'github:acme/x#7' }];
  ck('空查询 = 全部', filterSelectOptions(opts, '').length === 3);
  ck('按标题 / 小字 / 关键字匹配,「无」一直在', filterSelectOptions(opts, '进行').map(o => o.id).join() === ',a' && filterSelectOptions(opts, 'ACME').map(o => o.id).join() === ',b');
  const vp = { width: 1200, height: 800 };
  const below = anchorSelectMenu({ x: 100, y: 100, w: 300, h: 40 }, vp, { rows: 5, rowH: 34, search: false });
  ck('下面放得下 = 按钮下面 4px,宽 = 按钮宽', below.top === 144 && below.width === 300 && below.left === 100);
  const flip = anchorSelectMenu({ x: 100, y: 740, w: 300, h: 40 }, vp, { rows: 8, rowH: 34, search: true });
  ck('底部按钮 = 翻到上面,底边贴按钮上沿 4px', flip.top + flip.maxHeight === 736);
  const edge = anchorSelectMenu({ x: 1100, y: 100, w: 120, h: 32 }, vp, { rows: 3, rowH: 34, search: false });
  ck('靠右 = 夹进窗口(右边留 8),最窄 240', edge.width === 240 && edge.left + edge.width === 1192);
}

{
  const W = { width: 1320, height: 754 }, P = { width: 320, height: 452 };
  ck('日历:下面放得下 = 下面', duePanelPlacement({ x: 925, y: 100, w: 380, h: 40 }, W, P).side === 'below');
  ck('日历:只有上面放得下 = 上面', duePanelPlacement({ x: 925, y: 600, w: 380, h: 40 }, W, P).side === 'above');
  const mid = duePanelPlacement({ x: 925, y: 382, w: 380, h: 40 }, W, P);
  ck('日历:上下都放不下 = 字段左边,不盖住字段', mid.side === 'left' && mid.left + P.width <= 925 - 8 && mid.top >= 8 && mid.top + P.height <= W.height - 8);
}

console.log('# 母任务候选');
{
  // a ─ b ─ c ─ d      e(顶层)     深链 f1─f2─f3─f4
  const items = [R('a', null), R('b', 'a'), R('c', 'b'), R('d', 'c'), R('e', null), R('f1', null), R('f2', 'f1'), R('f3', 'f2'), R('f4', 'f3')];
  ck('后代 = 往下整棵', [...descendantIds(items, 'a')].sort().join() === 'b,c,d');
  ck('环也不死循环', descendantIds([R('x', 'y'), R('y', 'x')], 'x').has('y'));
  const forB = parentCandidates(items, items[1]);
  ck('不含自己和后代', !forB.some(c => ['b', 'c', 'd'].includes(c.task.id)) && forB.some(c => c.task.id === 'a'));
  // b 这棵子树 3 层(b,c,d):挂到 f4(第 4 层)下 = 7 层 > 5 → 不可选;挂到 e(第 1 层)= 4 层 → 可以
  ck('超过 5 层的标不可选', forB.find(c => c.task.id === 'f4')!.tooDeep && !forB.find(c => c.task.id === 'e')!.tooDeep && forB.find(c => c.task.id === 'f2')!.tooDeep === false);
  const d = editDraftOf(items[1]);
  ck('草稿带母任务', d.parentId === 'a');
  ck('改母任务 → PATCH parent_id;清空 = null', editPatch(items[1], { ...d, parentId: 'e' })?.parent_id === 'e' && editPatch(items[1], { ...d, parentId: null })?.parent_id === null);
  ck('没改不发', editPatch(items[1], d) === null);
  ck('旧 Hub(行里没有 parent_id)不发', editPatch(R('z', undefined), { ...editDraftOf(R('z', undefined)), parentId: 'a' }) === null);
  ck('Hub 回来的行没带上 = 没生效', !patchApplied(R('b', 'a'), { parent_id: 'e' }) && patchApplied(R('b', 'e'), { parent_id: 'e' }));
}

console.log('# 多选');
{
  const order = ['a', 'b', 'c', 'd', 'e'];
  ck('普通单击不是选择(打开详情)', !isSelectClick({ toggle: false, range: false }));
  let sel = selectClick(NO_SELECTION, 'b', { toggle: true, range: false }, order);
  ck('Ctrl/⌘ 单击 = 加入', sel.ids.join() === 'b' && sel.anchor === 'b');
  sel = selectClick(sel, 'd', { toggle: false, range: true }, order);
  ck('Shift 单击 = 从上次那张连到这张', sel.ids.join() === 'b,c,d');
  sel = selectClick(sel, 'c', { toggle: true, range: false }, order);
  ck('再 Ctrl 单击 = 移出', sel.ids.join() === 'b,d');
  ck('行首勾选框只切这一行', toggleSelected(sel, 'e').ids.join() === 'b,d,e');
  ck('Shift 没有起点 = 当作单选这张', selectClick(NO_SELECTION, 'c', { toggle: false, range: true }, order).ids.join() === 'c');
  ck('刷新后不在列表里的去掉', pruneSelection({ ids: ['b', 'x'], anchor: 'x' }, order).ids.join() === 'b' && pruneSelection({ ids: ['b', 'x'], anchor: 'x' }, order).anchor === null);
}

console.log('# 批量改');
{
  const seen: string[] = [];
  const progress: BulkProgress[] = [];
  let concurrent = 0, maxConcurrent = 0;
  const r = await runBulk([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], async id => {
    concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise(res => setTimeout(res, 5));
    seen.push(id);
    concurrent--;
    if (id === 'b') throw new Error('没有权限');
  }, pr => progress.push(pr));
  ck('一张一张改(不并发),按顺序', maxConcurrent === 1 && seen.join() === 'a,b,c');
  ck('一张失败不停,记下原因', r.done === 3 && r.failed.length === 1 && r.failed[0].name === 'B' && r.failed[0].message === '没有权限');
  ck('进度:开始 0/3 … 结束 running=false', progress[0].done === 0 && progress[0].running && progress[progress.length - 1].running === false);
}

console.log('# 文案:检查项 / 子任务 / 母任务');
{
  setLanguagePreference('zh');
  ck('清单叫「检查项」,真正的子任务叫「子任务」,父级叫「母任务」', translate('tasks.copy.93') === '检查项' && translate('tasks.copy.218') === '子任务' && translate('tasks.copy.113') === '新建子任务' && translate('tasks.copy.116') === '母任务' && translate('taskSel.parent') === '母任务');
  ck('卡片进度也改了', translate('tasks.copy.60', { v0: 1, v1: 2 }) === '子任务 1/2 完成' && translate('tasks.copy.85', { v0: 1, v1: 2 }) === '检查项 1/2');
  const table = src('./i18n-tasks.ts');
  ck('中文文案里不再有「子需求」「父需求」', !/'[^']*(子需求|父需求)[^']*',\s*'/.test(table));
  ck('Hub 报错的说法也跟着改', !/子需求|父需求|'子任务不合法|'子任务没有保存/.test(src('./requirements-hub.ts').replace(/\/\/.*$/gm, '')));
  setLanguagePreference('en');
  ck('English: Checklist / Subtasks / Parent task', translate('tasks.copy.93') === 'Checklist' && translate('tasks.copy.218') === 'Subtasks' && translate('taskSel.parent') === 'Parent task');
  setLanguagePreference('system');
}

console.log('# 接线(源码)');
{
  const panel = src('./TaskDetailPanel.tsx');
  const board = src('./RequirementBoard.tsx');
  const dialog = src('./TaskCreateDialog.tsx');
  const title = panel.indexOf('testID="req-edit-name"');
  const project = panel.indexOf('<ProjectSelect');
  const parent = panel.indexOf('<ParentSelect');
  const status = panel.indexOf("<Field label={tr('tasks.copy.54')}>");
  ck('详情:项目、母任务紧跟在标题下面、状态之前', title > 0 && project > title && parent > project && status > parent);
  ck('项目是下拉(和负责人同一种按钮),不再是一排胶囊', !/ProjectPicker/.test(panel + dialog) && dialog.includes('<ProjectSelect'));
  ck('母任务被 Hub 拒绝时显示在母任务下面', panel.includes("field: patch.parent_id !== undefined && (failed === PARENT_TOO_DEEP || failed === PARENT_REJECTED) ? 'parent' : 'submit'"));
  ck('卡片 / 手机行 / 列表行都有「↳ 母任务」', (board.match(/<ParentLine item=\{item\} items=\{items\} \/>/g) ?? []).length === 3);
  ck('列表的项目格就地可改', board.includes('<ProjectSelect compact label={false}'));
  ck('多选只在鼠标界面', board.includes('if (pointer && isSelectClick(m))') && board.includes("{pointer && section !== 'dispatch' && (sel.ids.length || bulk) ? ("));
  ck('批量改走现有的 PATCH / 移列接口', board.includes('updateRequirementOnHub(cfg, id, patch)') && board.includes('moveRequirementOnHub(cfg, id, value as ReqColumn)'));
  ck('「清除筛选」不会被挤成一列字', board.includes("style={[s.iconButton, { width: 'auto', flexShrink: 0, paddingHorizontal: spacing.sm }]} testID=\"task-filter-clear\"") && /testID="task-filter-clear">\n\s*<Text style=\{s\.link\} numberOfLines=\{1\}>/.test(board));
}

console.log('# 类:`width: undefined` 覆盖不了样式数组里前面的宽');
{
  // RN / RN-web 合并样式数组时跳过值为 undefined 的键 ⇒ [s.iconButton, { width: undefined }] 仍是 32 宽,
  // 里面的文字被挤成一列(「清除筛选」、描述的「⤢ 全屏」都中过)。要放开宽度写 'auto'。
  const dir = new URL('.', import.meta.url);
  const hits: string[] = [];
  for (const f of readdirSync(dir)) {
    if (!/\.tsx?$/.test(f) || f.endsWith('.test.ts')) continue;
    const text = src(`./${f}`);
    text.split('\n').forEach((line, i) => { if (/\bwidth:\s*undefined\b/.test(line.replace(/\/\/.*$/, ''))) hits.push(`${f}:${i + 1}`); });
  }
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  app.split('\n').forEach((line, i) => { if (/\bwidth:\s*undefined\b/.test(line.replace(/\/\/.*$/, ''))) hits.push(`App.tsx:${i + 1}`); });
  ck(`src/ 和 App.tsx 里没有 width: undefined${hits.length ? ' — ' + hits.join(', ') : ''}`, hits.length === 0);
  ck('判据自检:能认出那一行', /\bwidth:\s*undefined\b/.test("style={[s.iconButton, { width: undefined, paddingHorizontal: 8 }]}"));
}

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
