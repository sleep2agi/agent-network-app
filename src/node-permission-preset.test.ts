import { deriveReach, deriveRole, reachInbox, reachNarrows, roleSettings } from './node-permission-preset';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? '✓' : '✗'} ${name}`); };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const edit = (capability: string, scope_kind: 'network' | 'department' | 'node', scope_id = '') => ({ capability, scope_kind, scope_id, level: 'edit' as const });
const deptGrants = ['schedules', 'board', 'rules'].map(c => edit(c, 'department', 'd1'));
const netGrants = ['schedules', 'board', 'rules'].map(c => edit(c, 'network'));

ck('只读 = readonly 无授权', deriveRole('readonly', []).role === 'readonly');
ck('成员 = normal 无授权(含 null)', deriveRole('normal', []).role === 'member' && deriveRole(undefined, null).role === 'member');
ck('部门管理 = 三项 edit 同一部门', same(deriveRole('normal', deptGrants), { role: 'dept', deptId: 'd1' }));
ck('全网管理 = 三项 edit 全网', deriveRole('normal', netGrants).role === 'network');
ck('只授了一项 ⇒ 自定义', deriveRole('normal', [edit('schedules', 'network')]).role === 'custom');
ck('有 read 级别 ⇒ 自定义', deriveRole('normal', [...netGrants.slice(0, 2), { ...netGrants[2], level: 'read' as const }]).role === 'custom');
ck('两个部门混着 ⇒ 自定义', deriveRole('normal', [edit('schedules', 'department', 'd1'), edit('board', 'department', 'd2'), edit('rules', 'department', 'd1')]).role === 'custom');
ck('受限模式 ⇒ 自定义(在高级里)', deriveRole('restricted', []).role === 'custom');
ck('只读却有授权 ⇒ 自定义', deriveRole('readonly', netGrants).role === 'custom');
ck('老 Hub 没有 rules:两项也算部门管理', same(deriveRole('normal', deptGrants.slice(0, 2), ['schedules', 'board']), { role: 'dept', deptId: 'd1' }));

ck('写:部门管理给三项 edit', same(roleSettings('dept', 'd1'), { mode: 'normal', grants: deptGrants }));
ck('写:全网管理', same(roleSettings('network', undefined).grants, netGrants));
ck('写:成员 / 只读清空授权', same(roleSettings('member', undefined), { mode: 'normal', grants: [] }) && same(roleSettings('readonly', undefined), { mode: 'readonly', grants: [] }));
ck('写:老 Hub 只授它支持的', roleSettings('network', undefined, ['schedules', 'board']).grants.length === 2);
ck('往返:写出去再读回是同一档', deriveRole('normal', roleSettings('dept', 'd9').grants).role === 'dept');

const owner = { username: 'admin', user_id: 'u_1' };
ck('所有人 = 不限', deriveReach(null, 'd1', owner) === 'all' && reachInbox('all', 'd1', owner) === null);
ck('本部门 = 部门 + 主人', same(reachInbox('dept', 'd1', owner), ['dept:d1', 'user:admin']) && deriveReach(['dept:d1', 'user:admin'], 'd1', owner) === 'dept');
ck('只有主人', same(reachInbox('owner', 'd1', owner), ['user:admin']) && deriveReach(['user:admin'], 'd1', owner) === 'owner');
ck('主人用 user_id 写的也认', deriveReach(['user:u_1'], 'd1', owner) === 'owner');
ck('别的部门 / 名单里没有主人 ⇒ 自定义', deriveReach(['dept:d2', 'user:admin'], 'd1', owner) === 'custom' && deriveReach(['dept:d1'], 'd1', owner) === 'custom');
ck('多加了一个 Agent ⇒ 自定义', deriveReach(['dept:d1', 'user:admin', 'alpha'], 'd1', owner) === 'custom');
let threw = false; try { reachInbox('dept', null, owner); } catch { threw = true; }
ck('节点没部门时不能选本部门', threw);
ck('收窄判定', reachNarrows('all', 'dept') && reachNarrows('dept', 'owner') && !reachNarrows('owner', 'all'));

console.log(`node permission preset: ${p}/${t}`);
process.exit(p === t ? 0 : 1);
