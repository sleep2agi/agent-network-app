// 左栏项目 / 标签菜单(#760)—— run: bun src/task-side-menu.test.ts
// 行为:纯函数(task-side-menu.ts)直接调,写 Hub 用假的 ManagerOps 记下调用。
// 接线:屏幕 import react-native,这里读源码文本证明 右键 → 菜单、菜单「改名」→ 行内输入框、手机长按 → 同一份菜单、
//       菜单用的就是对话框那一对处理函数(onUpdate / onOp 同一个名字)。
import { readFileSync } from 'node:fs';
import { canEditProject, commitSideRename, renameKey, runSideAction, sideItemActions } from './task-side-menu';
import type { ManagerOps } from './task-board-store';
import type { RequirementProject } from './requirements-model';

let p = 0, total = 0;
const ck = (name: string, ok: boolean) => { total++; if (ok) p++; else console.error(`FAIL ${name}`); };
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

const calls: unknown[][] = [];
const fake = (reply: string | null = null): ManagerOps => ({
  updateProject: async (id, patch) => { calls.push(['updateProject', id, patch]); return reply; },
  tagOp: async op => { calls.push(['tagOp', op]); return reply; },
});
const projects: RequirementProject[] = [
  { id: 'p_a', name: '军团基建', color: '#2563eb', sort: 1, archived: false },
  { id: 'p_b', name: 'TMAI', color: '#16a34a', sort: 2, archived: false },
  { id: 'p_ro', name: '只读', color: '#16a34a', sort: 3, archived: false, canEdit: false },
];

// ── 有哪些项 / 权限 ──
ck('project menu: rename, color, archive', eq(sideItemActions('project', true, fake()), ['rename', 'color', 'archive']));
ck('tag menu: rename, color, delete', eq(sideItemActions('tag', true, fake()), ['rename', 'color', 'delete']));
ck('no permission → no rename (no menu at all)', eq(sideItemActions('project', false, fake()), []) && eq(sideItemActions('tag', false, fake()), []));
ck('board not mounted (no ops) → no menu', eq(sideItemActions('project', true, null), []));
ck('viewer_can.edit=false project cannot be edited', !canEditProject(projects[2]) && canEditProject(projects[0]) && !canEditProject(undefined));
ck('archived project cannot be edited from the sidebar', !canEditProject({ ...projects[0], archived: true }));

// ── 按键 ──
ck('Enter saves', renameKey('Enter') === 'save');
ck('Esc cancels', renameKey('Escape') === 'cancel' && renameKey('Esc') === 'cancel');
ck('other keys ignored', renameKey('a') === null && renameKey(undefined) === null);

// ── 改名走对话框同一条路 ──
calls.length = 0;
ck('project rename ok', (await commitSideRename('project', 'p_a', '  军团  基建2 ', fake(), projects)) === null);
ck('project rename = updateProject(id, { name }) (same as the dialog)', eq(calls, [['updateProject', 'p_a', { name: '军团 基建2' }]]));
calls.length = 0;
ck('tag rename ok', (await commitSideRename('tag', 'UI', '界面', fake(), projects)) === null);
ck('tag rename = tags/ops { op: rename, from, to }', eq(calls, [['tagOp', { op: 'rename', from: 'UI', to: '界面' }]]));
calls.length = 0;
ck('unchanged name: no call', (await commitSideRename('project', 'p_a', '军团基建', fake(), projects)) === null && (await commitSideRename('tag', 'UI', ' UI ', fake(), projects)) === null && calls.length === 0);
const dup = await commitSideRename('project', 'p_a', 'TMAI', fake(), projects);
ck('duplicate project name caught locally, no call', !!dup && !dup.i18n && calls.length === 0);
const empty = await commitSideRename('tag', 'UI', '   ', fake(), projects);
ck('empty tag → tags.invalidName (existing i18n key)', eq(empty, { error: 'tags.invalidName', i18n: true }) && calls.length === 0);
const taken = await commitSideRename('project', 'p_a', '新名字', fake('已经有同名的项目'), projects);
ck('hub 409 text passed through unchanged (same as the dialog)', eq(taken, { error: '已经有同名的项目', i18n: false }));
const tagFail = await commitSideRename('tag', 'UI', 'X', fake('tags.noPermission'), projects);
ck('tag hub error stays an i18n key', eq(tagFail, { error: 'tags.noPermission', i18n: true }));

// ── 其余项 ──
calls.length = 0;
await runSideAction('project', 'p_a', 'archive', fake(), {});
await runSideAction('project', 'p_a', 'color', fake(), { projectColor: '#2563eb' });
await runSideAction('tag', 'UI', 'delete', fake(), {});
await runSideAction('tag', 'UI', 'color', fake(), { tagColor: '#dc2626' });
ck('archive / color / delete use the dialog calls', eq(calls[0], ['updateProject', 'p_a', { archived: true }]) && (calls[1] as any)[2].color && (calls[1] as any)[2].color !== '#2563eb'
  && eq(calls[2], ['tagOp', { op: 'delete', tag: 'UI' }]) && eq(calls[3], ['tagOp', { op: 'color', tag: 'UI', color: '#dc2626' }]));

// ── 接线 ──
const side = read('./TaskFilterSidebar.tsx');
const menu = read('./TaskSideItemMenu.tsx');
const board = read('./RequirementBoard.tsx');
const tags = read('./TaskTags.tsx');
ck('right-click: capture-phase contextmenu on [data-side-item] opens the menu', /addEventListener\('contextmenu', onContext, true\)/.test(side) && /closest\?\.\('\[data-side-item\]'\)[\s\S]{0,200}setSideMenu\(\{ kind:[^}]*touch: false \}\)/.test(side));
ck('project rows carry data-side-item only when editable', side.includes('dataSet: { sideItem: `p:${id}` }') && side.includes("p.canEdit !== false))"));
ck('tag rows carry data-side-item only when tags are manageable', side.includes('tag && manageTags ? { dataSet: { sideItem: `t:${tag}` } }'));
ck('menu rename on desktop → sidebar inline input', /if \(!target\.touch && onInlineRename\) onInlineRename\(target\.kind, target\.key\)/.test(menu) && side.includes('<TaskSideItemMenu onInlineRename='));
ck('menu rename on phone → the existing rename page (manager with focus)', /setManagingProjects\(true, target\.key\)/.test(menu) && /setManagingTags\(true, target\.key\)/.test(menu) && (board.match(/focus=\{managerFocus\}/g) ?? []).length === 2);
ck('inline input: Enter saves via commitSideRename, Esc / blur cancel', /onSubmitEditing=\{\(\) => \{ void saveRename\(\); \}\}/.test(side) && /renameKey\(e\.nativeEvent\.key\) === 'cancel'\) setEditing\(null\)/.test(side) && /onBlur=\{\(\) => \{ if \(!saving\.current\) setEditing\(null\); \}\}/.test(side) && side.includes('commitSideRename(editing.kind'));
ck('dialogs and menu share the same handlers', board.includes('onUpdate={updateProjectOp}') && board.includes('onOp={tagOp}') && board.includes('managerOpsRef.current = { updateProject: updateProjectOp, tagOp }'));
ck('phone long-press opens the same menu (touch)', /setSideMenu\(\{ kind: 'project', key: p\.id,[^}]*touch: true \}\)/.test(board) && /onLongPress=\{!pointerUi\(\) \? \(tag && manage \? e => \{[^}]*setSideMenu\(\{ kind: 'tag', key: tag,[^}]*touch: true \}\)/.test(tags) && board.includes('onLongPress={touch ? onLongPress : undefined}') && board.includes('{!desktop ? <TaskSideItemMenu /> : null}'));
ck('menu items come from sideItemActions (permission gate)', /const actions = sideItemActions\(/.test(menu) && /if \(!actions\.length \|\| !ops\) return null;/.test(menu));

console.log(`task side menu: ${p}/${total}`);
if (p !== total) process.exit(1);
