// @ts-nocheck -- repository test scripts run directly under Bun.
// #485 —— 「管理本部门」(RFC-040,Hub ≥ .91):入口只给部门负责人;负责人模式下 Hub 会拒的操作不出现。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { managedDepartmentIds, managedRoots, orgPerms } from './org-model';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };

// 研发(rd)› 前端(fe,我负责)› 前端一组(fe1);研发 › 后端(be);销售(sales)。
const D = (id: string, parent: string | null, viewer_can?: Record<string, boolean>) => ({ id, name: id, parent_id: parent, leader_user_id: null, sort: 0, member_count: 0, ...(viewer_can ? { viewer_can } : {}) });
const org = {
  departments: [D('rd', null), D('fe', 'rd'), D('fe1', 'fe'), D('be', 'rd'), D('sales', null)],
  members: [{ user_id: 'u_head', department_id: 'fe' }, { user_id: 'u_m', department_id: 'fe1' }, { user_id: 'u_be', department_id: 'be' }, { user_id: 'u_free', department_id: null }],
};
const people = ['u_head', 'u_m', 'u_be', 'u_free'].map(id => ({ user_id: id, username: id }));
const managed = new Set(['fe', 'fe1']);

// ── 入口:auth/me ──
const me = { networks: [{ network_id: 'n1', managed_department_ids: ['fe', 'fe1'] }, { network_id: 'n2' }] };
ck('managed ids come from /api/auth/me for the current network', JSON.stringify(managedDepartmentIds(me, 'n1')) === '["fe","fe1"]');
ck('old Hub (no field) / other network / not a head → [] (no entry)', managedDepartmentIds(me, 'n2').length === 0 && managedDepartmentIds(null, 'n1').length === 0 && managedDepartmentIds({ networks: [{ network_id: 'n1', managed_department_ids: [] }] }, 'n1').length === 0);
ck('junk in the field is ignored', JSON.stringify(managedDepartmentIds({ networks: [{ network_id: 'n1', managed_department_ids: ['fe', 3, '', null] }] }, 'n1')) === '["fe"]');
ck('entry points: only the top-most managed departments', JSON.stringify(managedRoots(org, managed).map(d => d.id)) === '["fe"]'
  && JSON.stringify(managedRoots(org, new Set(['fe', 'fe1', 'sales'])).map(d => d.id)) === '["fe","sales"]');

// ── 管理员:和以前一样什么都能做 ──
const admin = orgPerms(org, null);
ck('admin perms are unchanged (everything allowed, root pickable, unassign allowed)', !admin.head && admin.canCreateUnder(null) && admin.canManage('sales') && admin.canMoveMember('u_free') && admin.canUnassign && admin.rootPickable && admin.pickDisabled === undefined && admin.candidates(people).length === 4);

// ── 负责人:按 Hub 规则推(没有 viewer_can 时)──
const head = orgPerms(org, managed);
ck('head: create under the own department and below, not elsewhere or at the root', head.canCreateUnder('fe') && head.canCreateUnder('fe1') && !head.canCreateUnder('be') && !head.canCreateUnder(null));
ck('head: manage only strict sub-departments (own department belongs to the parent head)', head.canManage('fe1') && !head.canManage('fe') && !head.canManage('be'));
ck('head: move only people inside the subtree; never unassign', head.canMoveMember('u_m') && head.canMoveMember('u_head') && !head.canMoveMember('u_be') && !head.canMoveMember('u_free') && !head.canUnassign);
ck('head: pickers grey out everything outside the subtree, and the network root', !head.rootPickable && head.pickDisabled.has('be') && head.pickDisabled.has('rd') && head.pickDisabled.has('sales') && !head.pickDisabled.has('fe') && !head.pickDisabled.has('fe1'));
ck('head: leader / add-member candidates are subtree people only', JSON.stringify(head.candidates(people).map(x => x.user_id)) === '["u_head","u_m"]');

// ── Hub 的 viewer_can 优先 ──
const fromHub = orgPerms({ ...org, departments: org.departments.map(d => d.id === 'fe' ? { ...d, viewer_can: { manage: true, create_child: true } } : d.id === 'fe1' ? { ...d, viewer_can: { manage: false, create_child: false } } : d) }, managed);
ck("Hub's viewer_can wins over the local rule", fromHub.canManage('fe') && !fromHub.canManage('fe1') && !fromHub.canCreateUnder('fe1'));

// ── 接线(源码)──
const src = (f: string) => readFileSync(join(import.meta.dir, f), 'utf8');
const agents = src('AgentsScreen.tsx');
ck('desktop: sidebar entry only in the compact sidebar and only with managed ids', agents.includes('{compact && managedDepts.ids.length ? (') && agents.includes('testID="manage-dept-entry"') && agents.includes('managedDepartmentIds(me, cfg.networkId)'));
ck('desktop: the entry opens the head-mode dialog', agents.includes('<ManageDepartmentDesktop cfg={cfg} networkId={cfg.networkId}'));
ck('desktop: the entry sits above 人员 (inside the list header, before people-section)', agents.indexOf('testID="manage-dept-entry"') < agents.indexOf('testID="people-section"'));
const settings = src('SettingsScreen.tsx');
ck('phone: 设置 gets a 管理本部门 group only with managed ids', settings.includes('{managedDepts.length && me.networkId ? (') && settings.includes('testID="settings-row-manageDepartment"'));
ck('phone: it opens the full-screen head mode', settings.includes('<ManageDepartmentPhone cfg={cfg} networkId={me.networkId}'));
const chart = src('OrgChart.tsx');
ck('org chart: every write button is gated by perms', ['perms.canManage(dept.id) ?', 'perms.canCreateUnder(sel) ?', 'perms.canMoveMember(p.user_id) ?', 'perms.canUnassign ?', 'perms.inScope(sel) ?'].every(x => chart.includes(x)));
ck('org chart: phone sheet / bottom bar only list allowed actions', chart.includes("...(perms.canMoveMember(p.user_id) ? [{ label: '调动到其他部门…'") && chart.includes('if (items.length) setSheet(') && chart.includes('{bar.length ? ('));
const count = (re: RegExp) => (chart.match(re) ?? []).length;
ck('org chart: every picker call site uses the head limits', count(/<DeptPickList org=/g) === count(/rootDisabled=\{!perms\.rootPickable\}/g) && count(/<PersonPickList org=/g) === count(/people=\{perms\.candidates\(people\)\}/g) && count(/<PersonPickList org=/g) >= 4);
ck('org chart: desktop head tabs 成员 / 任务 / Agent', chart.includes('testID="org-head-tabs"') && chart.includes("head.renderTasks(sel) : head.renderAgents(sel)"));
ck('org chart: phone head links 本部门任务 / 本部门 Agent', chart.includes('testID="org-head-tasks"') && chart.includes('testID="org-head-agents"'));
const md = src('ManageDepartment.tsx');
ck('tasks tab reads department_id; agents tab reads …/nodes', src('org-api.ts').includes('department_id=${encodeURIComponent(departmentId)}') && src('org-api.ts').includes('/departments/${encodeURIComponent(departmentId)}/nodes') && md.includes('fetchDepartmentRequirements(cfg, networkId, deptId)') && md.includes('fetchDepartmentNodes(cfg, networkId, deptId)'));
ck('heads read people from /humans (not the admin member list)', md.includes('fetchHumans(cfg, networkId)') && !md.includes('fetchNetworkMembers'));
const i18n = src('i18n-users.ts');
ck('i18n: zh + en for the new strings', ['dept.manage', 'dept.tasks.empty', 'dept.agents.empty', 'dept.agents.note', 'dept.col.doing'].every(k => new RegExp(`'${k.replace(/\./g, '\\.')}': \\['[^']+', '[^']+'\\]`).test(i18n)));
ck('error text for department_scope_denied', src('org-api.ts').includes("case 'department_scope_denied':"));

console.log(`\nmanage-department: ${p}/${t}`);
if (p !== t) process.exit(1);
