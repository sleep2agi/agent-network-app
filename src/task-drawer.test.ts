// @ts-nocheck -- repository test scripts run directly under Bun; the app
// tsconfig intentionally excludes Node ambient types.
// #701 任务详情抽屉:打开方式、宽度 / 分栏、属性自动保存发的字段、标题 / 描述失焦保存与 Esc、链接、主题色。
// 组件级的行为(点卡片 → 抽屉 / 推入页、pill 选项、失焦只发一次、Esc 不发)在 tests/requirement-details(Docker)里。
import { readFileSync } from 'node:fs';
import {
  blurPatch, clampDrawerWidth, detailMode, dragDrawerWidth, drawerColumns, drawerTokens, DRAWER_DEFAULT_WIDTH, DRAWER_MIN_WIDTH,
  escapeDraft, openTaskDrawer, parseDrawerWidth, parseTaskLink, propertyPatch, taskLink, loadDrawerWidth, saveDrawerWidth, DRAWER_WIDTH_KEY,
} from './task-drawer-model';
import { editDraftOf } from './task-board-model';
import { takeOpenTaskRequest } from './task-open-request';
import { ACCENT, colors, setThemePreference } from './theme';

let passed = 0;
let total = 0;
const ck = (name: string, condition: boolean) => {
  total++;
  if (condition) { passed++; console.log('✅', name); }
  else console.log('❌', name);
};
const R = (extra = {}) => ({ id: 'req_1', name: '登录页', assignee: '', priority: 'normal', due: '', column: 'pool', createdAt: '', description: '## 目标', projectId: 'p1', ...extra });

// ── 从列表打开:桌面一律抽屉 ────────────────────────────────────────────────────────────────
ck('desktop (pointer) opens the drawer even on a narrow board (no more full-window page)', detailMode({ pointer: true, boardWidth: 700 }) === 'drawer' && detailMode({ pointer: true, boardWidth: 1400 }) === 'drawer');
ck('phone opens the full-screen page', detailMode({ pointer: false, boardWidth: 390 }) === 'page');
ck('touch tablet wide enough keeps the drawer', detailMode({ pointer: false, boardWidth: 1000 }) === 'drawer');
const board = readFileSync(new URL('./RequirementBoard.tsx', import.meta.url), 'utf8');
const list = readFileSync(new URL('./TaskListTable.tsx', import.meta.url), 'utf8');
ck('list rows open the detail by id (onOpen → openDetail → selectedId)', /<TaskListTable[^\n]*onOpen=\{openDetail\}/.test(board) && /const openDetail = \(id: string\) => \{ if \(!swallow\.current\) setSelectedId\(id\); \};/.test(board) && list.includes('onOpen(item.id)'));
ck('board renders the selected task inside TaskDrawer when the mode is drawer', /drawer \? \(\s*<TaskDrawer taskId=\{selected\.id\}[^>]*>\s*\{detail\('drawer'\)\}\s*<\/TaskDrawer>\s*\) : detail\('page'\)/.test(board));
ck('the mode comes from detailMode(pointer, board width)', board.includes("const drawer = detailMode({ pointer: pointer, boardWidth: width }) === 'drawer';"));
ck('「在新窗口打开」 stays in the drawer header (desktop shell only)', board.includes('onOpenWindow={tauriShell && pointer && !single ?') && readFileSync(new URL('./TaskDetailPanel.tsx', import.meta.url), 'utf8').includes("mode === 'drawer' && onOpenWindow ? iconButton('req-detail-open-window'"));
openTaskDrawer('req_9', 'net_a');
ck('openTaskDrawer(id) leaves a request the task page takes (deep links, #700)', takeOpenTaskRequest('net_a') === 'req_9' && takeOpenTaskRequest('net_a') === null);
openTaskDrawer('req_8', 'net_b');
ck('a request for another network is not taken by this board', takeOpenTaskRequest('net_a') === null && takeOpenTaskRequest('net_b') === 'req_8');

// ── 宽度 / 分栏 ──────────────────────────────────────────────────────────────────────────────
ck('default width is 560', DRAWER_DEFAULT_WIDTH === 560 && clampDrawerWidth(DRAWER_DEFAULT_WIDTH, 1400) === 560);
ck('never narrower than the minimum', clampDrawerWidth(100, 1400) === DRAWER_MIN_WIDTH);
ck('never wider than 85% of the board', clampDrawerWidth(5000, 1000) === 850);
ck('board narrower than the minimum: the drawer is the board width', clampDrawerWidth(560, 380) === 380);
ck('dragging the left edge left widens, right narrows', dragDrawerWidth(560, -100, 1400) === 660 && dragDrawerWidth(560, 60, 1400) === 500);
ck('two columns from 520 up, one below', drawerColumns(560) === 2 && drawerColumns(480) === 1);
ck('stored width: only sane numbers are read back', parseDrawerWidth('640') === 640 && parseDrawerWidth('12') === null && parseDrawerWidth('abc') === null && parseDrawerWidth(null) === null);
{
  const g = globalThis as any; const had = 'localStorage' in g; const orig = g.localStorage; const m = new Map();
  g.localStorage = { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  try {
    ck('no stored width → 560', loadDrawerWidth() === 560);
    saveDrawerWidth(700.4);
    ck('dragged width is remembered on this device', m.get(DRAWER_WIDTH_KEY) === '700' && loadDrawerWidth() === 700);
  } finally { if (had) g.localStorage = orig; else delete g.localStorage; }
}

// ── 属性自动保存:只发那一个字段 ─────────────────────────────────────────────────────────────
{
  const item = R();
  const d = editDraftOf(item);
  ck('project change → { project_id } only', JSON.stringify(propertyPatch(item, d, { field: 'project', projectId: 'p2' })) === '{"project_id":"p2"}');
  ck('clearing the project → { project_id: null }', JSON.stringify(propertyPatch(item, d, { field: 'project', projectId: null })) === '{"project_id":null}');
  ck('due change → { due } only', JSON.stringify(propertyPatch(item, d, { field: 'due', due: '2026-10-09' })) === '{"due":"2026-10-09"}');
  ck('priority change → { priority } only', JSON.stringify(propertyPatch(item, d, { field: 'priority', priority: 'high' })) === '{"priority":"high"}');
  ck('picking the current value sends nothing', propertyPatch(item, d, { field: 'due', due: '' }) === null);
  ck('an unrelated typed title is not carried along with a property', JSON.stringify(propertyPatch(item, { ...d, name: '还在打字' }, { field: 'due', due: '2026-10-09' })) === '{"due":"2026-10-09"}');
  const panel = readFileSync(new URL('./TaskDetailPanel.tsx', import.meta.url), 'utf8');
  ck('detail wires each property to an immediate one-field save', ["onChange={projectId => { void saveField({ projectId }); }}", "onChange={due => { void saveField({ due }); }}", "void saveField({ priority });", 'onChange={p => { void assignRole(p); }}'].every(x => panel.includes(x)));
  ck('no 保存修改 button any more', !panel.includes('req-edit-save') && !panel.includes("tr('tasks.copy.143')"));
  ck('a successful save shows the 已保存 toast', panel.includes('testID="req-saved-toast"') && (panel.match(/showSaved\(\)/g) ?? []).length >= 4);
}

// ── 标题 / 描述:失焦保存,Esc 取消 ────────────────────────────────────────────────────────────
{
  const item = R();
  const d = { ...editDraftOf(item), name: '  新标题 ', description: '## 目标\r\n- 验收' };
  ck('blur on the title sends { name } only (trimmed)', JSON.stringify(blurPatch(item, d, 'name')) === '{"name":"新标题"}');
  ck('blur on the description sends { description } only (line endings normalised)', JSON.stringify(blurPatch(item, d, 'description')) === JSON.stringify({ description: '## 目标\n- 验收' }));
  ck('blur without a change sends nothing', blurPatch(item, editDraftOf(item), 'name') === null && blurPatch(item, editDraftOf(item), 'description') === null);
  const back = escapeDraft(item, d, 'name');
  ck('Esc on the title puts the card value back and keeps the description draft', back.name === '登录页' && back.description === d.description);
  ck('Esc on the description puts it back and keeps the title draft', escapeDraft(item, d, 'description').description === '## 目标' && escapeDraft(item, d, 'description').name === d.name);
  const panel = readFileSync(new URL('./TaskDetailPanel.tsx', import.meta.url), 'utf8');
  ck('title input: onBlur saves, Escape cancels', panel.includes("onBlur={() => { void saveText('name'); }}") && /key === 'Escape' \|\| key === 'Esc'\) \{ cancelText\('name'\)/.test(panel));
  ck('description box: focus leaving the block saves, Escape cancels (web); inline blur saves (native)', panel.includes("textHandlers.current.saveText('description')") && panel.includes("textHandlers.current.cancelText('description')") && panel.includes("onInlineBlur={Platform.OS === 'web' ? undefined : () => { void saveText('description'); }}"));
  ck('a field already sent on blur is not sent again on close', panel.includes('sent.current.has(sentKey(item.id, f, p[f]))'));
}

// ── 链接 ──────────────────────────────────────────────────────────────────────────────────────
ck('copy link = anet://task/<network>/<id>', taskLink({ id: 'req_1' }, 'net a') === 'anet://task/net%20a/req_1' && taskLink({ id: 'req_1' }) === 'anet://task/_/req_1');
ck('the link parses back', JSON.stringify(parseTaskLink('anet://task/net%20a/req_1')) === JSON.stringify({ networkId: 'net a', taskId: 'req_1' }) && parseTaskLink('anet://task/_/req_1')?.networkId === null && parseTaskLink('https://x') === null);

// ── 主题 ──────────────────────────────────────────────────────────────────────────────────────
setThemePreference('light');
const light = drawerTokens();
ck('light: accent is the brand blue #1b65db', light.accent === '#1b65db' && light.accent === ACCENT.light.accent);
ck('light: every token is a live theme colour', light.bg === colors.bg && light.border === colors.border && light.text === colors.text && light.pillBg === colors.subtleFill);
setThemePreference('dark');
const dark = drawerTokens();
ck('dark: accent follows the dark theme', dark.accent === ACCENT.dark.accent && dark.accent !== light.accent);
ck('dark: surfaces change with the theme', dark.bg === colors.card && dark.bg !== light.bg && dark.text !== light.text);
setThemePreference('system');
for (const f of ['./task-drawer-model.ts', './TaskDrawer.tsx']) {
  ck(`${f.slice(2)} has no hard-coded colours`, !/#[0-9a-fA-F]{3,8}\b/.test(readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '')));
}

console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
