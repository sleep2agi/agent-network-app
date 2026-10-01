// 成员编辑器重设计(#417)的状态:保存 payload 与重设计前逐字相同、「保存」可不可点(dirty)、分组头三态、已选 chip。
// ck 风格,自执行。
import { readFileSync } from 'node:fs';
import {
  aliasOnlyGrants, grantsEditable, grantsPayload, groupGrantsPayload, memberSavePlan, selectionFromGrants, setCanMessage, toggleAgent, toggleAgents,
  type AgentAccess, type AgentGrant, type GrantSelection, type HubAgentGroup, type MemberRole, type PickableAgent,
} from './user-admin';
import { taskGrantsChanged, taskGrantsPayload, type TaskAccess } from './task-access';
import {
  accessEditableFor, agentMeta, filterAgentGroups, memberEditorDirty, memberSaveRequests, pickerSections, pickerTabs, roleHintKey, sectionCount, selectGroups, selectedChips,
  type MemberDraft,
} from './member-editor';
import { t } from './i18n';
import './i18n-users';

let p = 0, n = 0;
const ck = (name: string, ok: boolean) => { n++; if (ok) { p++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}`); };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// —— 重设计前的保存逻辑(UserManagementPanel.tsx @ 566c74c 的 useMemberEditor + useTaskAccessState,逐行照抄)——
// 新编辑器对同样的选择必须发出同样的请求、同样的顺序、同样的 body。
type Legacy = { kind: string; body: unknown };
function legacySave(d: MemberDraft): Legacy[] {
  const role = d.nextRole, mode = d.nextMode, mode0 = d.mode, selection = d.selection, original = d.original;
  const groupsSupported = !!d.groups;
  const groupsBefore = d.groups?.before ?? new Map(), groupSel = d.groups?.after ?? new Map();
  const before = selectionFromGrants(original);
  const plan = memberSavePlan({ role: d.role, nextRole: role, mode: mode0, nextMode: mode, before, after: selection, ...(groupsSupported ? { beforeGroups: groupsBefore, afterGroups: groupSel } : {}) });
  const accessEditable = d.canEditAccess && grantsEditable({ role });
  // useTaskAccessState
  const tasks = d.tasks;
  const supported = !!tasks;
  const normalized = tasks ? new Map(taskGrantsPayload(tasks.mode, tasks.selection, role).project_grants.map(g => [g.project_id, g.can_edit] as [string, boolean])) : new Map();
  const changed = supported && taskGrantsChanged(tasks!.before, { mode: tasks!.mode, selection: normalized });
  const tasksDirty = accessEditable && supported && changed;
  const out: Legacy[] = [];
  if (plan.role) out.push({ kind: 'role', body: { role } });
  if (tasksDirty) out.push({ kind: 'tasks', body: taskGrantsPayload(tasks!.mode, tasks!.selection, role) });
  if (plan.grants) {
    out.push({ kind: 'grants', body: {
      ...grantsPayload(selection, aliasOnlyGrants(original), { mode, role }),
      ...(groupsSupported ? { group_grants: groupGrantsPayload(groupSel, role) } : {}),
    } });
  }
  const legacyChanged = plan.role || plan.grants || tasksDirty;
  if (legacyChanged !== out.length > 0) throw new Error('legacy changed/requests disagree');
  return out;
}

// —— 1. payload 等价:一批有名字的场景 + 一大批种子随机场景 ——
const original: AgentGrant[] = [
  { node_id: 'n_a', alias: 'a', can_message: true },
  { node_id: 'n_b', alias: 'b', can_message: false },
  { node_id: null, alias: 'legacy-alias', can_message: true },
];
const base = (over: Partial<MemberDraft> = {}): MemberDraft => ({
  role: 'member', nextRole: 'member', mode: 'granted', nextMode: 'granted', original, selection: selectionFromGrants(original), canEditAccess: true, ...over,
});
const named: Array<[string, MemberDraft]> = [
  ['什么都没改', base()],
  ['勾一个新的', base({ selection: toggleAgent(selectionFromGrants(original), 'n_c') })],
  ['关掉一个的可对话', base({ selection: setCanMessage(selectionFromGrants(original), 'n_a', false) })],
  ['切到全部 Agent(勾选照带)', base({ nextMode: 'all' })],
  ['从全部切回仅指定', base({ mode: 'all', nextMode: 'granted' })],
  ['改成只读成员(授权按只读重写)', base({ nextRole: 'viewer' })],
  ['改成管理员(不写授权)', base({ nextRole: 'admin' })],
  ['只读成员改回成员', base({ role: 'viewer', nextRole: 'member' })],
  ['分组:加一个组', base({ groups: { before: new Map(), after: new Map([['g1', true]]) } })],
  ['分组:没改但 Hub 支持(照样不发)', base({ groups: { before: new Map([['g1', false]]), after: new Map([['g1', false]]) } })],
  ['分组支持 + 改了 Agent(group_grants 一起发)', base({ groups: { before: new Map([['g1', true]]), after: new Map([['g1', true]]) }, selection: new Map() })],
  ['任务:切到仅相关 + 两个项目', base({ tasks: { before: { mode: 'all', selection: new Map() }, mode: 'scoped', selection: new Map([['p1', false], ['p2', true]]) } })],
  ['任务:没改', base({ tasks: { before: { mode: 'scoped', selection: new Map([['p1', true]]) }, mode: 'scoped', selection: new Map([['p1', true]]) } })],
  ['任务:改成只读成员 ⇒ 可编辑被清掉也算改动', base({ nextRole: 'viewer', tasks: { before: { mode: 'scoped', selection: new Map([['p1', true]]) }, mode: 'scoped', selection: new Map([['p1', true]]) } })],
  ['任务:改成管理员 ⇒ 任务权限不发', base({ nextRole: 'admin', tasks: { before: { mode: 'all', selection: new Map() }, mode: 'scoped', selection: new Map() } })],
  ['没有授权权限(只能改角色)', base({ canEditAccess: false, nextRole: 'viewer', tasks: { before: { mode: 'all', selection: new Map() }, mode: 'scoped', selection: new Map() } })],
  ['全部一起改', base({ nextRole: 'viewer', nextMode: 'all', selection: new Map([['n_z', true]]), groups: { before: new Map(), after: new Map([['g2', true]]) }, tasks: { before: { mode: 'all', selection: new Map() }, mode: 'scoped', selection: new Map([['p9', true]]) } })],
];
for (const [name, d] of named) {
  const a = memberSaveRequests(d), b = legacySave(d);
  ck(`payload 与旧编辑器相同:${name}(${b.map(x => x.kind).join(' → ') || '不发'})`, same(a, b));
}
{
  // 种子随机:角色 × 模式 × 勾选 × 可对话 × 分组 × 任务 × 权限,全部组合里抽 600 个。
  let seed = 417;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
  const sel = (ids: readonly string[]) => new Map(ids.filter(() => rnd() < 0.5).map(id => [id, rnd() < 0.6] as [string, boolean]));
  const roles: MemberRole[] = ['member', 'viewer', 'admin'];
  const modes: AgentAccess[] = ['all', 'granted'];
  const tmodes: TaskAccess[] = ['all', 'scoped'];
  let bad = 0, dirty = 0;
  for (let i = 0; i < 600; i++) {
    const orig: AgentGrant[] = [...sel(['n_a', 'n_b', 'n_c'])].map(([node_id, can_message]) => ({ node_id, alias: node_id, can_message }));
    if (rnd() < 0.3) orig.push({ node_id: null, alias: 'old', can_message: rnd() < 0.5 });
    const d: MemberDraft = {
      role: pick(['member', 'viewer'] as MemberRole[]), nextRole: pick(roles), mode: pick(modes), nextMode: pick(modes), original: orig,
      selection: rnd() < 0.3 ? selectionFromGrants(orig) : sel(['n_a', 'n_b', 'n_c', 'n_d']), canEditAccess: rnd() < 0.85,
      ...(rnd() < 0.5 ? { groups: rnd() < 0.3 ? (() => { const g = sel(['g1', 'g2']); return { before: g, after: new Map(g) }; })() : { before: sel(['g1', 'g2']), after: sel(['g1', 'g2']) } } : {}),
      ...(rnd() < 0.6 ? { tasks: (() => { const b = { mode: pick(tmodes), selection: sel(['p1', 'p2']) }; return rnd() < 0.3 ? { before: b, mode: b.mode, selection: new Map(b.selection) } : { before: b, mode: pick(tmodes), selection: sel(['p1', 'p2']) }; })() } : {}),
    };
    if (!same(memberSaveRequests(d), legacySave(d))) bad++;
    if (memberEditorDirty(d)) dirty++;
  }
  ck(`payload 与旧编辑器相同:600 个种子随机场景全部一致(其中 ${dirty} 个有改动)`, bad === 0 && dirty > 100 && dirty < 600);
}

// —— 2. dirty(「保存」可不可点)——
{
  const d0 = base();
  ck('dirty:原样不可保存', !memberEditorDirty(d0));
  const on = toggleAgent(d0.selection, 'n_c');
  ck('dirty:勾一个 → 可保存', memberEditorDirty({ ...d0, selection: on }));
  ck('dirty:勾了再取消 → 回到不可保存', !memberEditorDirty({ ...d0, selection: toggleAgent(on, 'n_c') }));
  ck('dirty:只翻可对话也算', memberEditorDirty({ ...d0, selection: setCanMessage(d0.selection, 'n_b', true) }));
  ck('dirty:翻过去再翻回来不算', !memberEditorDirty({ ...d0, selection: setCanMessage(setCanMessage(d0.selection, 'n_b', true), 'n_b', false) }));
  ck('dirty:切模式算', memberEditorDirty({ ...d0, nextMode: 'all' }));
  ck('dirty:改角色算', memberEditorDirty({ ...d0, nextRole: 'admin' }));
  ck('dirty:分组勾了又取消不算', !memberEditorDirty({ ...d0, groups: { before: new Map([['g1', true]]), after: toggleAgent(toggleAgent(new Map([['g1', true]]), 'g1'), 'g1') } }));
  ck('dirty:分组可对话翻了算', memberEditorDirty({ ...d0, groups: { before: new Map([['g1', true]]), after: new Map([['g1', false]]) } }));
  const t0 = { before: { mode: 'scoped' as TaskAccess, selection: new Map([['p1', false]]) }, mode: 'scoped' as TaskAccess, selection: new Map([['p1', false]]) };
  ck('dirty:任务权限原样不算', !memberEditorDirty({ ...d0, tasks: t0 }));
  ck('dirty:任务项目打开可编辑算', memberEditorDirty({ ...d0, tasks: { ...t0, selection: new Map([['p1', true]]) } }));
  ck('dirty:没有授权权限时任务权限改动不算(区块不画)', !memberEditorDirty({ ...d0, canEditAccess: false, tasks: { ...t0, selection: new Map([['p1', true]]) } }));
  ck('授权区块:我有权 + 新角色是成员 → 画', accessEditableFor({ canEditAccess: true, nextRole: 'member' }));
  ck('授权区块:新角色是管理员 → 不画', !accessEditableFor({ canEditAccess: true, nextRole: 'admin' }));
  ck('授权区块:我没权 → 不画', !accessEditableFor({ canEditAccess: false, nextRole: 'member' }));
  const req = memberSaveRequests({ ...d0, nextRole: 'viewer', tasks: { ...t0, selection: new Map([['p1', false], ['p2', false]]) } });
  ck('顺序:角色 → 任务 → 授权', same(req.map(r => r.kind), ['role', 'tasks', 'grants']));
  const g = req.find(r => r.kind === 'grants')!.body as { grants: Array<{ can_message: boolean; alias?: string }>; agent_access: string };
  ck('改成只读成员:授权一律只读,老的按 alias 授权原样带回', g.grants.every(x => x.can_message === false) && g.grants.some(x => x.alias === 'legacy-alias') && g.agent_access === 'granted');
}

// —— 3. 分组头三态(按机器 / 按类型)——
{
  const agents: PickableAgent[] = [
    { node_id: 'n1', alias: '示例-甲', hostname: 'host-a', runtime: 'claude-code' },
    { node_id: 'n2', alias: '示例-乙', hostname: 'host-a', runtime: 'codex' },
    { node_id: 'n3', alias: '示例-丙', hostname: 'host-b', runtime: 'codex' },
    { node_id: 'n4', alias: '示例-丁', hostname: null, runtime: null },
  ];
  const secs = pickerSections(agents, 'host');
  ck('按机器:三段(host-a / host-b / 未知排最后)', same(secs.map(s => s.key), ['host-a', 'host-b', '']));
  ck('全部页签:一段无标题', pickerSections(agents, 'none').length === 1 && pickerSections(agents, 'none')[0].label === null);
  const hostA = secs[0].agents;
  let sel: GrantSelection = new Map();
  ck('三态:没选 → none,0 / 2', same(sectionCount(sel, hostA), { on: 0, total: 2, state: 'none' }));
  sel = toggleAgent(sel, 'n1');
  ck('三态:选一个 → some,1 / 2', same(sectionCount(sel, hostA), { on: 1, total: 2, state: 'some' }));
  sel = setCanMessage(sel, 'n1', false);
  sel = toggleAgents(sel, hostA, 'member');
  ck('点部分选中的组头 → 全选,已选的可对话不动、新补的默认可对话', same(sectionCount(sel, hostA), { on: 2, total: 2, state: 'all' }) && sel.get('n1') === false && sel.get('n2') === true);
  sel = toggleAgents(sel, hostA, 'member');
  ck('点全选的组头 → 这组全取消', same(sectionCount(sel, hostA), { on: 0, total: 2, state: 'none' }) && sel.size === 0);
  ck('只读成员:组头补上的一律只读', [...toggleAgents(new Map(), hostA, 'viewer').values()].every(v => v === false));
  ck('空组算 none', sectionCount(sel, []).state === 'none');
  ck('按类型:codex 一组两个', pickerSections(agents, 'runtime').find(s => s.key === 'codex')?.agents.length === 2);
  ck('行副标题「机器 · 类型」,都没有就空', agentMeta(agents[0]) === 'host-a · claude-code' && agentMeta(agents[3]) === '');
}

// —— 4. 已选 chip、分组页签 ——
{
  const agents: PickableAgent[] = [{ node_id: 'n2', alias: 'b-agent', display_name: '示例乙' }, { node_id: 'n1', alias: 'a-agent' }];
  const groups: HubAgentGroup[] = [{ group_id: 'g2', name: 'group-b', node_ids: [], member_count: 3, granted_user_count: 0 }, { group_id: 'g1', name: 'group-a', node_ids: [], member_count: 1, granted_user_count: 0 }];
  const chips = selectedChips(agents, new Map([['n2', true], ['n1', false], ['n_gone', true]]), groups, new Map([['g2', false]]));
  ck('chip:分组在前,Agent 按 alias 排;显示名优先', same(chips.map(c => c.label), ['group-b', 'a-agent', '示例乙', 'n_gone']));
  ck('chip:节点已删的授权也列出来(标签 = node_id),能移掉', chips.some(c => c.id === 'n_gone' && c.kind === 'agent'));
  ck('chip:带着可对话', chips.find(c => c.id === 'n1')?.canMessage === false && chips.find(c => c.id === 'g2')?.canMessage === false);
  ck('chip:节点清单还没读回来也不崩', selectedChips(null, new Map([['n1', true]]), [], new Map()).length === 1);
  ck('页签:Hub 有分组 → 四格', same(pickerTabs(true), ['none', 'host', 'runtime', 'groups']));
  ck('页签:旧 Hub / 没有分组 → 三格', same(pickerTabs(false), ['none', 'host', 'runtime']));
  ck('分组页签搜索:按名字、按名字排', same(filterAgentGroups(groups, '').map(g => g.name), ['group-a', 'group-b']) && same(filterAgentGroups(groups, 'B').map(g => g.group_id), ['g2']));
  const gs = selectGroups(new Map([['g1', false]]), groups, 'member');
  ck('分组全选:已选的不动,新加的可对话', gs.get('g1') === false && gs.get('g2') === true);
  ck('分组全选:只读成员一律只读', [...selectGroups(new Map(), groups, 'viewer').values()].every(v => v === false));
}

// —— 5. 文案 ——
{
  for (const r of ['member', 'viewer', 'admin']) ck(`角色说明有字:${r}`, t(roleHintKey(r)) !== roleHintKey(r) && t(roleHintKey(r)).length > 4);
  ck('完成(N)', t('users.doneCount', { count: 4 }) === '完成(4)' || t('users.doneCount', { count: 4 }) === 'Done (4)');
}

// —— 6. 接线(源码级:函数有测试但没人调)——
{
  const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
  const ed = read('./MemberEditor.tsx');
  ck('保存按 memberSaveRequests 的顺序逐个发,只用原有的三个接口', ed.includes('memberSaveRequests(draft)') && ed.includes('updateMemberRole(cfg, networkId, member.user_id, r.body.role)') && ed.includes('saveTaskGrants(cfg, networkId, member.user_id, r.body)') && ed.includes('saveAgentGrants(cfg, networkId, member.user_id, r.body)'));
  ck('「保存」可点 = 有请求要发', ed.includes('changed: requests.length > 0'));
  ck('两端都画:宽屏双栏弹窗 + 手机成员页', ed.includes('export function MemberDialog(') && ed.includes('export function MemberPage(') && ed.includes('testID="member-cols"'));
  ck('宽屏与手机各有自己的清单(不是同一个组件移植)', ed.includes('function DesktopPickerList(') && ed.includes('function PhoneAgentPickerPage('));
  ck('手机:保存在顶栏、选择页 / 项目页推入', ed.includes("testID: 'grants-confirm'") && ed.includes("setSub('agents')") && ed.includes("setSub('projects')"));
  ck('宽屏:移出网络要确认(点了换成确认条)', ed.includes('testID="member-remove-open"') && ed.includes('testID="member-remove-box"'));
  const settings = read('./SettingsScreen.tsx');
  ck('设置页顶栏:三级页可接管(标题 / 右上按钮 / 返回先退推入页)', settings.includes('setHeader: setHeaderOverride') && settings.includes('headerBackRef.current()'));
}

console.log(`\n${p}/${n} passed`);
process.exit(p === n ? 0 : 1);
