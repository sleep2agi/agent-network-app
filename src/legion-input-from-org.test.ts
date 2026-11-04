// 「组织数据 → 军团 3D 输入」的断言(2026-11-05)。
// 这一层错了,整张图就是错的(人挂错部门、Agent 消失、老 Hub 上少一半人),
// 而界面看起来仍然「有图」—— 所以必须在这里钉住。
import { legionInputFromOrg } from './legion-input-from-org';
import { buildLegionLayout } from './legion/legion-layout';
import type { AgentOrgData } from './agent-org-model';

let pass = 0;
const names: string[] = [];
function ck(name: string, ok: boolean) {
  names.push(name);
  if (ok) { pass += 1; return; }
  console.log(`FAIL: ${name}`);
}

const dept = (id: string, name: string, parentId: string | null = null, sort = 0) => ({
  id, name, parent_id: parentId, leader_user_id: null, sort, member_count: 0,
});

const org: AgentOrgData = {
  departments: [dept('d1', '平台', null, 0), dept('d2', '前端', 'd1', 1)],
  owners: [
    {
      userId: 'u1', username: 'vansin', displayName: 'Vincent', departmentId: 'd1',
      agents: [{ nodeId: 'n_a', alias: '通信欧' }, { nodeId: 'n_b', alias: '前端欧', departmentId: 'd2' }],
    },
    {
      userId: 'u2', username: 'xiao', displayName: '', departmentId: null,
      agents: [{ nodeId: 'n_c', alias: '无部门欧' }],
    },
  ],
  unowned: [{ nodeId: 'n_z', alias: '野生欧' }],
  directory: true,
  departmentsApi: true,
  agentDepartmentSupported: true,
};

const input = legionInputFromOrg(org, 'A站');

ck('人、Agent、部门、无主 Agent 都搬过来了',
  input.people.length === 2 && input.departments?.length === 2
  && input.orphans?.length === 1 && input.orphans?.[0].alias === '野生欧');

ck('display_name 缺失时退回 username（不编造）',
  input.people[1].display_name === 'xiao');

ck('部门按 id 对上，查不到就是 null（不猜）',
  input.people[0].department?.name === '平台' && input.people[1].department === null);

ck('Agent 的显式部门原样保留（决定它挂在哪个部门）',
  input.people[0].agents[1].department_id === 'd2'
  && input.people[0].agents[0].department_id === undefined);

ck('members 落位与 owners 一致（人不会跑到别的部门）',
  (input.members ?? []).find((m) => m.user_id === 'u1')?.department_id === 'd1'
  && (input.members ?? []).find((m) => m.user_id === 'u2')?.department_id === null);

ck('部门树字段一一对应（parent_id / sort 不丢）', (() => {
  const child = (input.departments ?? []).find((d) => d.id === 'd2');
  return !!child && child.parent_id === 'd1' && child.sort === 1;
})());

ck('标题可选：传了才带 title，不传不写空串',
  input.title === 'A站' && legionInputFromOrg(org).title === undefined);

ck('端到端：能直接喂给布局层（圆心/部门/人/Agent 都在，另有两个兜底组）',
  (() => {
    const layout = buildLegionLayout(input);
    const kinds = layout.nodes.reduce<Record<string, number>>((acc, n) => {
      acc[n.kind] = (acc[n.kind] ?? 0) + 1;
      return acc;
    }, {});
    const labels = layout.nodes.map((n) => n.label);
    // 布局层会给「没部门的人」和「无主 Agent」各补一个兜底组,这是预期行为,不是数据错。
    return kinds.core === 1 && kinds.person === 2 && kinds.agent === 4
      && kinds.group === 4
      && labels.includes('未分组') && labels.includes('无主 Agent');
  })());

ck('老 Hub（部门从通讯录摊平）也能出图，不丢人',
  (() => {
    const old = { ...org, departmentsApi: false, agentDepartmentSupported: false, departments: [] as typeof org.departments };
    const layout = buildLegionLayout(legionInputFromOrg(old));
    // 部门树没了也要把人/Agent 画出来(按通讯录摊平成组),不能因为老 Hub 就少人。
    return layout.nodes.filter((n) => n.kind === 'person').length === 2
      && layout.nodes.filter((n) => n.kind === 'agent').length === 4
      // 部门树空了:只剩「未分组」和「无主 Agent」两个兜底组,人没丢。
      && layout.nodes.filter((n) => n.kind === 'group').length === 2;
  })());

ck('空数据得到空图而不是异常',
  (() => {
    const empty: AgentOrgData = { departments: [], owners: [], unowned: [], directory: false, departmentsApi: false, agentDepartmentSupported: false };
    const layout = buildLegionLayout(legionInputFromOrg(empty));
    return layout.nodes.length === 1 && layout.nodes[0].kind === 'core';
  })());

console.log(`legion input from org: ${pass}/${names.length} checks passed`);
if (pass !== names.length) process.exit(1);
