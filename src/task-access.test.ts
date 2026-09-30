// 任务(需求卡)的人员权限(hub RFC-038 §9,agent-network#2163)—— 客户端纯逻辑 + 接线。ck 风格,自执行。
import { readFileSync } from 'node:fs';
import {
  grantableProjects, isTaskScopedIn, prefillProjectsOnScope, readOnlyFromHub, setProjectEditable, taskGrantsChanged,
  taskGrantsFromHub, taskGrantsPayload, toggleProject,
} from './task-access';
import { requirementFromHub } from './requirements-hub';
import { t } from './i18n';
import './i18n-users';

let p = 0, n = 0;
const ck = (name: string, ok: boolean) => { n++; if (ok) { p++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}`); };

// —— 读写形状 ——
{
  const g = taskGrantsFromHub({ task_access: 'scoped', project_grants: [{ project_id: 'p2', can_edit: true }, { project_id: 'p1', can_edit: false }, { project_id: '' }] });
  ck('读:scoped + 两个项目(空 id 丢掉)', g.mode === 'scoped' && g.selection.size === 2 && g.selection.get('p2') === true && g.selection.get('p1') === false);
  ck('读:all', taskGrantsFromHub({ task_access: 'all', project_grants: [] }).mode === 'all');
  ck('读:缺字段按 scoped + 无授权(fail-closed 同向)', taskGrantsFromHub({}).mode === 'scoped' && taskGrantsFromHub(null).selection.size === 0);
  const body = taskGrantsPayload('scoped', g.selection, 'member');
  ck('写:按 project_id 排序,可编辑原样', JSON.stringify(body) === JSON.stringify({ task_access: 'scoped', project_grants: [{ project_id: 'p1', can_edit: false }, { project_id: 'p2', can_edit: true }] }));
  ck('写:viewer 一律只看', taskGrantsPayload('scoped', g.selection, 'viewer').project_grants.every(x => !x.can_edit));
  ck('写:全部任务也带上项目(hub 照存,切回来不用重勾)', taskGrantsPayload('all', g.selection).task_access === 'all' && taskGrantsPayload('all', g.selection).project_grants.length === 2);
}

// —— 改动与预填 ——
{
  const before = { mode: 'all' as const, selection: new Map<string, boolean>() };
  ck('没改 → 不算', !taskGrantsChanged(before, { mode: 'all', selection: new Map() }));
  ck('切模式 → 算', taskGrantsChanged(before, { mode: 'scoped', selection: new Map() }));
  ck('改可编辑 → 算', taskGrantsChanged({ mode: 'scoped', selection: new Map([['p1', false]]) }, { mode: 'scoped', selection: new Map([['p1', true]]) }));
  const projects = [{ id: 'p1', name: '官网改版' }, { id: 'p2', name: '安卓发布' }, { id: 'p3', name: '旧项目', archived: true }];
  const pre = prefillProjectsOnScope(new Map(), projects);
  ck('切到仅相关任务:预填全部未归档项目、只看', pre.size === 2 && pre.get('p1') === false && pre.get('p2') === false && !pre.has('p3'));
  ck('已经勾过 → 不预填', prefillProjectsOnScope(new Map([['p2', true]]), projects).size === 1);
  const t1 = toggleProject(new Map(), 'p1');
  ck('新勾上的默认只看;再点取消', t1.get('p1') === false && !toggleProject(t1, 'p1').has('p1'));
  ck('可编辑只对已勾选的生效', setProjectEditable(t1, 'p1', true).get('p1') === true && !setProjectEditable(t1, 'p9', true).has('p9'));
  const list = grantableProjects(projects, new Map([['p3', false]]));
  ck('清单:已归档但已授权的也列出(不让授权消失在界面外)', list.some(x => x.id === 'p3'));
  ck('清单:已归档且没授权的不列', !grantableProjects(projects, new Map()).some(x => x.id === 'p3'));
}

// —— 看板只读 ——
{
  ck('viewer_can.edit=false → 只读', readOnlyFromHub({ viewer_can: { edit: false, delete: false } }));
  ck('viewer_can.edit=true → 能改', !readOnlyFromHub({ viewer_can: { edit: true, delete: true } }));
  ck('没有 viewer_can(旧 Hub / 全部任务的人)→ 能改', !readOnlyFromHub({}));
  ck('看不懂的值 → 按能改(最坏 hub 403,不把能改的卡锁死)', !readOnlyFromHub({ viewer_can: 'x' }) && !readOnlyFromHub({ viewer_can: { edit: 0 } }));
  const ro = requirementFromHub({ id: 'r1', name: 'a', viewer_can: { edit: false, delete: false } });
  const rw = requirementFromHub({ id: 'r2', name: 'b' });
  ck('requirementFromHub 带上 readOnly;没有就不出这个键', ro?.readOnly === true && rw !== null && !('readOnly' in rw));
  ck('当前网络是不是仅相关任务(旧 Hub 没字段 → 不是)', isTaskScopedIn({ networks: [{ network_id: 'n', task_access: 'scoped' } as any] }, 'n') && !isTaskScopedIn({ networks: [{ network_id: 'n' }] }, 'n'));
}

// —— 文案 ——
ck('仅相关任务 的标签逐字', t('users.tasks.scoped') === '仅相关任务' || t('users.tasks.scoped') === 'Related tasks only');

// —— 接线(源码级:函数有测试但没人调的那种坑)——
{
  const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
  // 成员编辑器 #417 起在 MemberEditor.tsx;保存由 member-editor.ts 的 memberSaveRequests 统一决定(member-editor.test.ts 逐场景比对旧逻辑)。
  const panel = read('./MemberEditor.tsx');
  ck('成员弹窗 / 成员页各放一个 TaskAccessSection,Hub 不支持就不画', panel.includes('<TaskAccessSection variant="desktop"') && panel.includes('<TaskAccessSection variant="phone"') && panel.includes('const tasksShown = ed.accessEditable && ed.tasks.supported;') && panel.includes('{ed.accessEditable && ed.tasks.supported ? ('));
  const model = read('./member-editor.ts');
  ck('保存:任务权限有改动才发,且计入「保存」可用', panel.includes('...(tasks.supported ? { tasks: { before: tasks.before, mode: tasks.mode, selection: tasks.selection } } : {})') && model.includes('if (accessEditableFor(d) && d.tasks && tasksChanged(d.tasks, d.nextRole))') && panel.includes('changed: requests.length > 0'));
  const section = read('./TaskAccessSection.tsx');
  ck('区块自带状态 hook(给重设计的双栏弹窗直接用)', section.includes('export function useTaskAccessState(') && section.includes('export default function TaskAccessSection('));
  ck('切到仅相关任务时预填', section.includes('prefillProjectsOnScope(s, projects ?? [])'));
  ck('viewer 不出可编辑开关', section.includes('{on && !viewer ? (') && section.includes("mode === 'scoped' && !viewer && picked.length"));
  ck('手机:授权的项目推入一页(不原地展开)', section.includes('export function TaskProjectsPage(') && section.includes('onPress={onOpenProjects ??') && panel.includes("onOpenProjects={() => setSub('projects')}"));
  const api = read('./user-admin-api.ts');
  ck('task-grants:404 → null(旧 Hub 整块隐藏)', /fetchTaskGrants[\s\S]*?e\.status === 404/.test(api));
  const board = read('./RequirementBoard.tsx');
  for (const fn of ['const move = async', 'const replaceChecklist = async', 'const toggleChecklist = async', 'const saveEdit = async', 'const setDue = async']) {
    const body = board.slice(board.indexOf(fn), board.indexOf(fn) + 600);
    ck(`看板:${fn.replace('const ', '').replace(' = async', '')} 先挡只读`, body.includes('readOnlyBlock(id)'));
  }
  ck('看板:批量里只读的卡算失败', /runBulk\(targets, async id => \{[\s\S]{0,200}readOnlyBlock\(id\)/.test(board));
  ck('看板:只读的卡不带 data-task-from(拖不动)+ 锁标签', board.includes('item.readOnly ? { taskCard: item.id } : { taskCard: item.id, taskFrom: item.column }') && board.includes('{item.readOnly ? <ReadOnlyTag /> : null}'));
  ck('看板:详情拿到 readOnly', board.includes('readOnly={!!selected.readOnly}'));
  const detail = read('./TaskDetailPanel.tsx');
  ck('详情:只读时表单整块不响应、不给保存、顶上说明', detail.includes("pointerEvents={readOnly ? 'none' : 'auto'}") && detail.includes('{readOnly ? null : (') && detail.includes('req-detail-read-only'));
  ck('列表视图也标只读', read('./TaskListTable.tsx').includes('{item.readOnly ? <ReadOnlyTag'));
}

console.log(`\n${p}/${n} passed`);
if (p !== n) process.exit(1);
