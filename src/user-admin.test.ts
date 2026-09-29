// 多用户账号与 Agent 权限(hub agent-network#2084)—— 客户端纯逻辑。ck 风格,自执行。
import { readFileSync } from 'node:fs';
import {
  ASSIGNABLE_ROLES, agentsEmptyKind, aliasOnlyGrants, canManageUsers, filterPickable, grantsChanged, grantsEditable, grantsPayload,
  initialAccessMode, isRestrictedIn, memberAccessSummary, memberActions, memberSavePlan, pickDefaultNetworkId, prefillOnRestrict,
  selectionFromGrants, setCanMessage, showsCanMessage, toggleAgent, validateNewUser,
  type AuthMe,
} from './user-admin';
import { filterSettings, phoneSettingsGroups } from './settings-model';
import { t } from './i18n';
import './i18n-users';

let p = 0, n = 0;
const ck = (name: string, ok: boolean) => { n++; if (ok) { p++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}`); };

// —— 谁能看到「用户管理」——
{
  const net = 'net_a';
  const me = (role: string, memberRole: string, access?: 'all' | 'granted'): AuthMe => ({ user: { role }, networks: [{ network_id: net, member_role: memberRole, agent_access: access }, { network_id: 'net_b', member_role: 'owner' }] });
  ck('Hub 管理员(任何网络角色)能管', canManageUsers(me('admin', 'member'), net));
  ck('当前网络 owner 能管', canManageUsers(me('user', 'owner'), net));
  ck('当前网络 admin 能管', canManageUsers(me('user', 'admin'), net));
  ck('普通成员不能管', !canManageUsers(me('user', 'member'), net));
  ck('viewer 不能管', !canManageUsers(me('user', 'viewer'), net));
  ck('看的是**当前**网络的角色:在别的网络是 owner 不算', !canManageUsers(me('user', 'member'), net) && canManageUsers(me('user', 'member'), 'net_b'));
  ck('auth/me 还没回来 → 不显示', !canManageUsers(null, net));
  ck('受限判断:agent_access=granted', isRestrictedIn(me('user', 'member', 'granted'), net));
  ck('旧 Hub 没有 agent_access → 不受限', !isRestrictedIn(me('user', 'member'), net));
  ck('agent_access=all → 不受限', !isRestrictedIn(me('user', 'member', 'all'), net));
}

// —— 「用户管理」分类只在允许时出现,且在手机分组里 ——
{
  ck('不允许 → 设置里没有用户管理', !filterSettings('', {}).some(c => c.key === 'users'));
  ck('允许 → 出现', filterSettings('', { users: true }).some(c => c.key === 'users'));
  ck('搜「权限」能搜到', filterSettings('权限', { users: true }).some(c => c.key === 'users'));
  ck('搜英文 permission 也能搜到', filterSettings('permission', { users: true }).some(c => c.key === 'users'));
  const groups = phoneSettingsGroups(filterSettings('', { users: true }));
  ck('手机:用户管理在「通用」组第一行', groups.find(g => g.title === '通用')?.rows[0]?.key === 'users');
}

// —— 新建用户表单校验(与 hub register() 同规则)——
{
  ck('合法', validateNewUser({ username: 'alice', password: '12345678' }) === null);
  ck('用户名太短', validateNewUser({ username: 'a', password: '12345678' }) === 'username');
  ck('用户名 51 位太长', validateNewUser({ username: 'a'.repeat(51), password: '12345678' }) === 'username');
  ck('用户名含空格 / 点', validateNewUser({ username: 'a b', password: '12345678' }) === 'usernameChars' && validateNewUser({ username: 'a.b', password: '12345678' }) === 'usernameChars');
  ck('中文用户名可以', validateNewUser({ username: '张三', password: '12345678' }) === null);
  ck('密码 7 位不行', validateNewUser({ username: 'alice', password: '1234567' }) === 'password');
  ck('密码恰好 8 位可以(边界)', validateNewUser({ username: 'alice', password: 'abcdefgh' }) === null);
  ck('用户名首尾空格不算进长度', validateNewUser({ username: ' ab ', password: '12345678' }) === null);
}

// —— 成员行摘要与可编辑 ——
{
  ck('owner 行:全部、不可编辑', memberAccessSummary({ user_id: 'u', username: 'o', role: 'owner' }).kind === 'all' && !grantsEditable({ role: 'owner' }));
  ck('admin 行:全部、不可编辑', !grantsEditable({ role: 'admin' }));
  ck('member + agent_access=all:全部', memberAccessSummary({ user_id: 'u', username: 'm', role: 'member', agent_access: 'all' }).kind === 'all');
  const c = memberAccessSummary({ user_id: 'u', username: 'm', role: 'member', agent_access: 'granted', agent_grant_count: 3 });
  ck('受限成员:显示个数', c.kind === 'count' && c.count === 3);
  const z = memberAccessSummary({ user_id: 'u', username: 'm', role: 'viewer', agent_access: 'granted' });
  ck('没有 count 字段 → 0 个', z.kind === 'count' && z.count === 0);
}

// —— 授权编辑:勾选、可对话、保存的形状 ——
{
  const grants = [
    { node_id: 'node_b', alias: null, can_message: false },
    { node_id: 'node_a', alias: null, can_message: true },
    { node_id: null, alias: 'legacy-x', can_message: true },
  ];
  const sel = selectionFromGrants(grants);
  ck('只取有 node_id 的进选择器', sel.size === 2 && sel.get('node_b') === false);
  ck('alias 授权另存,保存时带回', aliasOnlyGrants(grants).length === 1 && aliasOnlyGrants(grants)[0].alias === 'legacy-x');
  const body = grantsPayload(sel, aliasOnlyGrants(grants));
  ck('payload 按 node_id 排序并带回 alias 授权(默认 granted)', JSON.stringify(body) === JSON.stringify({ agent_access: 'granted', grants: [{ node_id: 'node_a', can_message: true }, { node_id: 'node_b', can_message: false }, { alias: 'legacy-x', can_message: true }] }));
  ck('未改动 → 不算变化', !grantsChanged(sel, selectionFromGrants(grants)));
  const added = toggleAgent(sel, 'node_c');
  ck('新勾上的默认可对话', added.get('node_c') === true && grantsChanged(sel, added));
  ck('再点一次取消', !toggleAgent(added, 'node_c').has('node_c'));
  ck('toggle 不改原 Map', !sel.has('node_c'));
  const muted = setCanMessage(sel, 'node_a', false);
  ck('关掉可对话算变化', muted.get('node_a') === false && grantsChanged(sel, muted));
  ck('没勾选的 Agent 设可对话无效', !setCanMessage(sel, 'node_z', true).has('node_z'));
  ck('全部取消 → 空授权(PUT grants: [])', JSON.stringify(grantsPayload(new Map())) === JSON.stringify({ agent_access: 'granted', grants: [] }));
}

// —— RFC-038 G1:保存一律带 agent_access(两种模式)——
{
  const sel = new Map([['node_a', true]]);
  const granted = grantsPayload(sel, [], { mode: 'granted' });
  ck('G1 仅指定 → agent_access=granted + 勾选', granted.agent_access === 'granted' && JSON.stringify(granted.grants) === JSON.stringify([{ node_id: 'node_a', can_message: true }]));
  const all = grantsPayload(sel, [], { mode: 'all' });
  ck('G1 全部 → agent_access=all,勾选照带(切回来不用重勾)', all.agent_access === 'all' && all.grants.length === 1);
  ck('G1 body 里永远有 agent_access 键(旧 bug:只有 grants,hub 不改模式)', 'agent_access' in grantsPayload(new Map()) && 'agent_access' in grantsPayload(sel, [], { mode: 'all' }));
  ck('G1 初始模式:all → all', initialAccessMode('all') === 'all');
  ck('G1 初始模式:granted / null / 缺字段 → granted', initialAccessMode('granted') === 'granted' && initialAccessMode(null) === 'granted' && initialAccessMode(undefined) === 'granted');
}

// —— G1 预填:从「全部」切到「仅指定」时预填此刻可见的全部 Agent ——
{
  const agents = [
    { node_id: 'n2', alias: 'beta' },
    { node_id: 'n1', alias: 'alpha' },
    { node_id: 'd1', alias: 'daemon', role: 'host_supervisor' },
  ];
  const pre = prefillOnRestrict(new Map(), agents, 'member');
  ck('预填:全部可对话 Agent,daemon 不算', pre.size === 2 && pre.get('n1') === true && pre.get('n2') === true && !pre.has('d1'));
  const preViewer = prefillOnRestrict(new Map(), agents, 'viewer');
  ck('预填:viewer 一律只读', preViewer.size === 2 && [...preViewer.values()].every(v => v === false));
  const kept = prefillOnRestrict(new Map([['n2', false]]), agents, 'member');
  ck('已有勾选(以前存下的授权)→ 原样保留不预填', kept.size === 1 && kept.get('n2') === false);
  ck('网络里没有 Agent → 预填为空', prefillOnRestrict(new Map(), [], 'member').size === 0);
  const body = grantsPayload(pre, [], { mode: 'granted', role: 'member' });
  ck('预填后保存的 body = granted + 两个可对话', body.agent_access === 'granted' && body.grants.map(g => `${g.node_id}:${g.can_message}`).join() === 'n1:true,n2:true');
}

// —— G2:viewer 不出「可对话」,授权一律只读 ——
{
  ck('viewer 不显示可对话开关', !showsCanMessage('viewer'));
  ck('member 显示可对话开关', showsCanMessage('member'));
  const body = grantsPayload(new Map([['n1', true], ['n2', true]]), [{ node_id: null, alias: 'legacy', can_message: true }], { mode: 'granted', role: 'viewer' });
  ck('viewer 的 body:node 与 alias 授权全是 can_message=false', body.grants.every(g => g.can_message === false) && body.grants.length === 3);
  const member = grantsPayload(new Map([['n1', true]]), [], { mode: 'granted', role: 'member' });
  ck('member 的 can_message 原样保留(反例)', member.grants[0].can_message === true);
}

// —— G3:改角色 / 移出 —— 谁能做什么(与 hub 路由对齐)——
{
  const net = 'net_a';
  const me = (memberRole: string, userRole = 'user'): AuthMe => ({ user: { user_id: 'me', role: userRole }, networks: [{ network_id: net, member_role: memberRole }] });
  const m = (role: string, user_id = 'u1') => ({ user_id, role });
  const o = memberActions(me('owner'), net, m('member'));
  ck('owner 对 member:授权 + 改角色 + 移出', o.editAccess && o.editRole && o.remove);
  const a = memberActions(me('admin'), net, m('member'));
  ck('网络 admin:能授权、能移出,不能改角色(hub PUT 只认 owner)', a.editAccess && !a.editRole && a.remove);
  const h = memberActions(me('member', 'admin'), net, m('member'));
  ck('Hub 管理员但网络里只是 member:能授权,不能改角色 / 移出', h.editAccess && !h.editRole && !h.remove);
  const oo = memberActions(me('admin'), net, m('owner'));
  ck('owner 行:什么都不能做', !oo.editAccess && !oo.editRole && !oo.remove);
  const self = memberActions(me('owner'), net, m('admin', 'me'));
  ck('自己那一行:不改自己的角色、不移出自己', !self.editRole && !self.remove);
  const adm = memberActions(me('owner'), net, m('admin'));
  ck('owner 对网络 admin:能改角色 / 移出,但授权不适用(admin 恒全部)', adm.editRole && adm.remove && !adm.editAccess);
  ck('可选角色:成员 / 只读成员 / 管理员(不含 owner)', ASSIGNABLE_ROLES.join() === 'member,viewer,admin');
}

// —— 保存计划:先改角色,再按新角色决定写不写授权 ——
{
  const e = new Map<string, boolean>();
  const one = new Map([['n1', true]]);
  const base = { role: 'member', nextRole: 'member', mode: 'all' as const, nextMode: 'all' as const, before: e, after: e };
  ck('什么都没改 → 两个请求都不发', JSON.stringify(memberSavePlan(base)) === JSON.stringify({ role: false, grants: false }));
  ck('只切模式 all→granted → 只写授权', JSON.stringify(memberSavePlan({ ...base, nextMode: 'granted', after: one })) === JSON.stringify({ role: false, grants: true }));
  ck('只改勾选 → 只写授权', JSON.stringify(memberSavePlan({ ...base, mode: 'granted', nextMode: 'granted', after: one })) === JSON.stringify({ role: false, grants: true }));
  ck('改成管理员 → 只改角色,不写授权', JSON.stringify(memberSavePlan({ ...base, nextRole: 'admin', nextMode: 'granted', after: one })) === JSON.stringify({ role: true, grants: false }));
  ck('改成 viewer → 改角色 + 重写授权(规整成只读)', JSON.stringify(memberSavePlan({ ...base, nextRole: 'viewer' })) === JSON.stringify({ role: true, grants: true }));
  ck('viewer 改回 member、授权没动 → 只改角色', JSON.stringify(memberSavePlan({ ...base, role: 'viewer', nextRole: 'member' })) === JSON.stringify({ role: true, grants: false }));
}

// —— 选择器过滤 ——
{
  const nodes = [
    { node_id: 'n1', alias: 'beta-agent', display_name: '贝塔' },
    { node_id: 'n2', alias: 'alpha-agent' },
    { node_id: 'n3', alias: 'daemon-x', role: 'host_supervisor' },
  ];
  ck('daemon 不出现', !filterPickable(nodes, '').some(n => n.node_id === 'n3'));
  ck('按 alias 排序', filterPickable(nodes, '').map(n => n.alias).join(',') === 'alpha-agent,beta-agent');
  ck('按显示名搜', filterPickable(nodes, '贝塔').map(n => n.node_id).join() === 'n1');
  ck('不分大小写', filterPickable(nodes, 'ALPHA').length === 1);
}

// —— Agent 列表空态 ——
{
  ck('受限且没 Agent → restricted 文案', agentsEmptyKind({ query: '', filtering: false, restricted: true }) === 'restricted');
  ck('不受限 → 原来的「还没有 agent」', agentsEmptyKind({ query: '', filtering: false, restricted: false }) === 'none');
  ck('搜索优先于受限', agentsEmptyKind({ query: 'x', filtering: false, restricted: true }) === 'search');
  ck('空格搜索词不算搜索', agentsEmptyKind({ query: '  ', filtering: false, restricted: true }) === 'restricted');
  ck('筛选优先于受限', agentsEmptyKind({ query: '', filtering: true, restricted: true }) === 'filter');
  ck('受限文案逐字', t('agents.restrictedEmpty') === '还没有被分配任何 Agent，请联系管理员' || t('agents.restrictedEmpty') === 'No agents have been assigned to you yet. Ask an admin.');
}

// —— 登录后的默认网络 ——
{
  ck('current_network 优先', pickDefaultNetworkId({ current_network: 'net_x', networks: [{ network_id: 'net_own', agent_access: 'all' }] }) === 'net_x');
  ck('current_network 对象形状', pickDefaultNetworkId({ current_network: { network_id: 'net_x' } }) === 'net_x');
  ck('旧 Hub(无 agent_access)→ networks[0](与原来逐字相同)', pickDefaultNetworkId({ networks: [{ network_id: 'net_own' }, { network_id: 'net_team' }] }) === 'net_own');
  ck('被建进团队网络的受限成员 → 落在团队网络', pickDefaultNetworkId({ networks: [{ network_id: 'net_own', member_role: 'owner', agent_access: 'all' }, { network_id: 'net_team', member_role: 'member', agent_access: 'granted' }] }) === 'net_team');
  ck('没有网络 → undefined', pickDefaultNetworkId({ networks: [] }) === undefined && pickDefaultNetworkId(null) === undefined);
}

// —— 接线:组件与入口真的用到了这些判断(源码级,防止函数有测试但没人调)——
{
  const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
  const settings = read('./SettingsScreen.tsx');
  ck('设置页按 canManageUsers 决定用户管理可见', settings.includes('canManageUsers(authMe, me.networkId)') && settings.includes('users: usersAvailable'));
  const agents = read('./AgentsScreen.tsx');
  ck('Agent 列表空态接了受限判断', agents.includes("t('agents.restrictedEmpty')") && agents.includes('isRestrictedIn('));
  const api = read('./api.ts');
  ck('登录后默认网络走 pickDefaultNetworkId', api.includes('pickDefaultNetworkId(d)'));
  const panel = read('./UserManagementPanel.tsx');
  ck('G1 保存时把模式和角色交给 grantsPayload', panel.includes('grantsPayload(selection, aliasOnlyGrants(original), { mode, role })'));
  ck('G1 切到「仅指定」走 prefillOnRestrict', panel.includes('prefillOnRestrict(s, agents ?? [], role)'));
  ck('G1 初始模式来自 hub 的 agent_access', panel.includes('initialAccessMode(grants.agent_access)'));
  ck('G2 两端的可对话都看 showsCanMessage', (panel.match(/showsCanMessage\(ed\.role\)/g) ?? []).length === 2);
  ck('G3 改角色 / 移出真的调了 hub', panel.includes('updateMemberRole(cfg, networkId, member.user_id, role)') && panel.includes('removeNetworkMember(cfg, networkId, member.user_id)'));
  ck('G3 行可点看 memberActions(不再只看 grantsEditable)', panel.includes('memberActions(me, networkId, m)'));
  const adminApi = read('./user-admin-api.ts');
  ck('G3 API:PUT /members/:uid {role}、DELETE /members/:uid', /members\/\$\{net\(userId\)\}`, \{ method: 'PUT', body: \{ role \} \}/.test(adminApi) && /members\/\$\{net\(userId\)\}`, \{ method: 'DELETE' \}/.test(adminApi));
  const phonePages = read('./SettingsPhonePages.tsx');
  ck('手机:成员是设置三级页 userMember', phonePages.includes("ctx.renderUsers(ctx.detail === 'userMember')") && settings.includes("openDetail('userMember')"));
  const app = read('../App.tsx');
  ck('登录页有注册入口并调 /api/auth/register', app.includes('registerHubAccount(') && app.includes('login-mode-toggle'));
}

console.log(`\n${p}/${n} passed`);
if (p !== n) process.exit(1);
