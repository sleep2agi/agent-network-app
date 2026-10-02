// 组织架构(board #419)纯逻辑 + 接口 + 接线。ck 风格,自执行。
import { readFileSync } from 'node:fs';
import { childrenOf, deleteBlocker, departmentOf, deptPathLabel, flattenTree, groupPeopleByDepartment, membersIn, pathTo, searchOrg, subtreeIds, totalMembers, type OrgData } from './org-model';
import { fetchOrg, createDepartment, setMemberDepartment, orgErrorText } from './org-api';

let p = 0, n = 0;
const ck = (name: string, ok: boolean, extra = '') => { n++; if (ok) { p++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}${extra ? ` (${extra})` : ''}`); };
const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

const D = (id: string, name: string, parent_id: string | null, sort = 0, leader_user_id: string | null = null) => ({ id, name, parent_id, leader_user_id, sort, member_count: 0 });
const org: OrgData = {
  departments: [D('rd', '产品研发部', null, 0, 'u1'), D('fe', '前端组', 'rd', 0), D('be', '后端组', 'rd', 1), D('ops', '运营部', null, 1), D('ct', '内容组', 'ops', 0)],
  members: [{ user_id: 'u1', department_id: 'rd' }, { user_id: 'u2', department_id: 'fe' }, { user_id: 'u3', department_id: 'fe' }, { user_id: 'u4', department_id: null }, { user_id: 'u5', department_id: 'gone' }],
};
const people = [
  { user_id: 'u1', username: 'zhou.rd', display_name: '周研发' }, { user_id: 'u2', username: 'lin', display_name: '林小设' },
  { user_id: 'u3', username: 'zhao', display_name: null }, { user_id: 'u4', username: 'wang', display_name: '王未分' }, { user_id: 'u5', username: 'ghost', display_name: '幽灵' },
];

console.log('# 树');
ck('根下的部门按 sort', childrenOf(org, null).map(d => d.id).join() === 'rd,ops');
ck('子部门', childrenOf(org, 'rd').map(d => d.id).join() === 'fe,be');
ck('路径', pathTo(org, 'fe').map(d => d.name).join('/') === '产品研发部/前端组' && pathTo(org, null).length === 0);
ck('完整名字', deptPathLabel(org, 'ct') === '运营部 / 内容组');
ck('展开成行(带层级)', flattenTree(org).map(r => `${r.dept.id}:${r.depth}`).join() === 'rd:0,fe:1,be:1,ops:0,ct:1');
ck('收起的不展开子部门', flattenTree(org, { collapsed: new Set(['rd']) }).map(r => r.dept.id).join() === 'rd,ops,ct');
ck('子树(移动时不能选)', [...subtreeIds(org, 'rd')].sort().join() === 'be,fe,rd');
console.log('# 成员');
ck('成员所在部门;指着不存在的部门 = 未分配', departmentOf(org, 'u2') === 'fe' && departmentOf(org, 'u5') === null && departmentOf(org, 'nobody') === null);
ck('直属成员按名字排', membersIn(org, 'fe', people).map(x => x.user_id).join() === 'u2,u3' || membersIn(org, 'fe', people).map(x => x.user_id).join() === 'u3,u2');
ck('根 = 未分配的人', membersIn(org, null, people).map(x => x.user_id).sort().join() === 'u4,u5');
ck('含下级的人数', totalMembers(org, 'rd') === 3 && totalMembers(org, 'ops') === 0 && totalMembers(org, null) === 5);
ck('只删空部门', deleteBlocker(org, 'rd')?.children === 2 && deleteBlocker(org, 'rd')?.members === 1 && deleteBlocker(org, 'be') === null);
console.log('# 搜索');
const hit = searchOrg(org, people, '组');
ck('搜部门名', hit.departments.map(d => d.id).sort().join() === 'be,ct,fe');
ck('搜人名 / 用户名', searchOrg(org, people, 'ZHOU').people.map(x => x.user_id).join() === 'u1' && searchOrg(org, people, '林').people.length === 1);
ck('空词不搜', searchOrg(org, people, '  ').people.length === 0);
console.log('# 人员按部门分组');
const g = groupPeopleByDepartment(org, people)!;
ck('按树的顺序,一个部门一组,未分配最后', g.map(x => x.key).join() === 'rd,fe,' && g[2].key === null && g[2].people.map(x => x.user_id).join() === 'u4,u5');
ck('小标题是完整路径', g[1].title === '产品研发部 / 前端组');
ck('组内保持原顺序', g[1].people.map(x => x.user_id).join() === 'u2,u3');
ck('没有部门 / 谁都没分 / 旧 Hub → 不分组', groupPeopleByDepartment({ departments: [], members: [] }, people) === null && groupPeopleByDepartment({ ...org, members: [] }, people) === null && groupPeopleByDepartment(null, people) === null);

console.log('# 接口');
{
  const sent: { url: string; method: string; body: unknown }[] = [];
  let reply: { status: number; body: unknown } = { status: 200, body: {} };
  const real = globalThis.fetch;
  (globalThis as any).fetch = async (url: string, init: RequestInit) => {
    sent.push({ url: String(url), method: String(init?.method), body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
  };
  const cfg = { serverUrl: 'http://hub.invalid', token: 'utok_sample', networkId: 'net_sample' } as never;
  try {
    reply = { status: 404, body: { error: 'not found' } };
    ck('旧 Hub(404)→ null,整块不出现', (await fetchOrg(cfg, 'net_sample')) === null);
    reply = { status: 200, body: { ok: true, departments: [D('a', '甲', null)], members: [] } };
    const got = await fetchOrg(cfg, 'net_sample');
    ck('读', !!got && got.departments[0].id === 'a' && sent[1].url.endsWith('/api/networks/net_sample/departments'));
    reply = { status: 201, body: { ok: true, department: D('dept_x', '新部门', 'a') } };
    await createDepartment(cfg, 'net_sample', { name: '新部门', parent_id: 'a' });
    ck('建:POST 体', sent[2].method === 'POST' && JSON.stringify(sent[2].body) === '{"name":"新部门","parent_id":"a"}');
    reply = { status: 200, body: { ok: true, department_id: null } };
    await setMemberDepartment(cfg, 'net_sample', 'u 1', null);
    ck('调人:PUT …/members/:uid/department', sent[3].method === 'PUT' && sent[3].url.endsWith('/members/u%201/department') && JSON.stringify(sent[3].body) === '{"department_id":null}');
    reply = { status: 409, body: { ok: false, error: 'department_not_empty', children: 1, members: 2 } };
    let msg = '';
    try { await createDepartment(cfg, 'net_sample', { name: 'x' }); } catch (e) { msg = (e as Error).message; }
    ck('错误按 Hub 的原因说(带数字)', msg === '部门里还有 1 个子部门、 2 个成员,先移走再删除', msg);
  } finally { (globalThis as any).fetch = real; }
}
ck('错误文案:同级重名', orgErrorText('department_name_taken') === '同一上级下已经有同名部门');

console.log('# 接线');
const um = src('UserManagementPanel.tsx'), agents = src('AgentsScreen.tsx'), chart = src('OrgChart.tsx');
ck('用户管理:有部门接口才出现;手机是一行「成员与部门」,桌面是左树右详情', /\{org && members \? \(\s*phone \?/.test(um) && um.includes('testID="org-open"') && um.includes('<OrgDesktopPanel'));
ck('手机全屏页:底部「添加成员 | 添加子部门 | 更多」', ["'添加成员'", "'添加子部门'", "'更多'"].every(k => chart.includes(k)) && chart.includes('testID="org-bottom-bar"'));
ck('添加子部门表单:部门名称* / 上级部门 / 部门 ID / 部门负责人', ['部门名称', '上级部门', '部门 ID', '部门负责人', '请输入否则自动生成'].every(k => chart.includes(k)));
// 部门群(RFC-042,#457 第 4 步)起做了:但两处入口都要过功能门(旧 Hub 没有群接口 → 不出现)和权限。
ck('部门群:入口都过功能门 + 权限', (chart.match(/groupsOn && [^\n]*canManageDeptGroup\(head\?\.managed \?\? null, /g) ?? []).length === 2);
ck('「人员」按部门分组(旧 Hub 不分)', agents.includes('groupPeopleByDepartment(org, peopleShown.rows)') && agents.includes("t('people.noDept')"));

console.log(`${p}/${n} passed`);
process.exit(p === n ? 0 : 1);
