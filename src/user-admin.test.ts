// 多用户账号与 Agent 权限(hub agent-network#2084)—— 客户端纯逻辑。ck 风格,自执行。
import { readFileSync } from 'node:fs';
import {
  agentsEmptyKind, aliasOnlyGrants, canManageUsers, filterPickable, grantsChanged, grantsEditable, grantsPayload,
  isRestrictedIn, memberAccessSummary, pickDefaultNetworkId, selectionFromGrants, setCanMessage, toggleAgent, validateNewUser,
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
  ck('payload 按 node_id 排序并带回 alias 授权', JSON.stringify(body) === JSON.stringify({ grants: [{ node_id: 'node_a', can_message: true }, { node_id: 'node_b', can_message: false }, { alias: 'legacy-x', can_message: true }] }));
  ck('未改动 → 不算变化', !grantsChanged(sel, selectionFromGrants(grants)));
  const added = toggleAgent(sel, 'node_c');
  ck('新勾上的默认可对话', added.get('node_c') === true && grantsChanged(sel, added));
  ck('再点一次取消', !toggleAgent(added, 'node_c').has('node_c'));
  ck('toggle 不改原 Map', !sel.has('node_c'));
  const muted = setCanMessage(sel, 'node_a', false);
  ck('关掉可对话算变化', muted.get('node_a') === false && grantsChanged(sel, muted));
  ck('没勾选的 Agent 设可对话无效', !setCanMessage(sel, 'node_z', true).has('node_z'));
  ck('全部取消 → 空授权(PUT grants: [])', JSON.stringify(grantsPayload(new Map())) === JSON.stringify({ grants: [] }));
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
  const app = read('../App.tsx');
  ck('登录页有注册入口并调 /api/auth/register', app.includes('registerHubAccount(') && app.includes('login-mode-toggle'));
}

console.log(`\n${p}/${n} passed`);
if (p !== n) process.exit(1);
