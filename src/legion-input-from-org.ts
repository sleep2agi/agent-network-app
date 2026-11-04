// Agent 组织数据 → 军团 3D 的输入(2026-11-05)。
//
// 客户端已经有「Agent 组织架构」的全部数据(`AgentOrgData`:真实部门树 + 负责人 + 名下 Agent +
// 未归属 Agent),而军团 3D 的布局层要的是 `LegionInput`(people / departments / members / orphans)。
// 两边字段几乎一一对应,差别只在命名和「Agent 放哪个部门」的优先级 —— 与其在界面里手拼对象、
// 让三处各自解释一遍,不如在纯函数里解释一次,并用断言钉住:
//   1. Agent 有显式 `departmentId` ⇒ 用它(与后台 agentDepartmentSupported 的语义一致);
//   2. 没有显式归属 ⇒ 不猜,让它跟着负责人所在部门(布局层的既有行为);
//   3. 老 Hub(部门是从通讯录摊平的)也照搬,不做任何「补齐」;
//   4. 空/缺失字段不编造:display_name 缺失就用 username,部门查不到就 null。
//
// 纯函数:不 import react-native、不 fetch。

import type { AgentOrgData, OrgAgent, OrgOwner } from './agent-org-model';
import type { LegionAgentRef, LegionDepartment, LegionInput, LegionMember, LegionPerson } from './legion/legion-layout';

function agentRef(agent: OrgAgent): LegionAgentRef {
  return {
    node_id: agent.nodeId,
    alias: agent.alias,
    ...(agent.departmentId === undefined ? {} : { department_id: agent.departmentId }),
    ...(agent.updatedAt ? { updated_at: agent.updatedAt } : {}),
    ...(agent.lifecycleState === undefined ? {} : { lifecycle_state: agent.lifecycleState }),
  };
}

function person(owner: OrgOwner, org: AgentOrgData): LegionPerson {
  const dept = owner.departmentId
    ? org.departments.find((d) => d.id === owner.departmentId) ?? null
    : null;
  return {
    user_id: owner.userId,
    username: owner.username,
    display_name: (owner.displayName ?? '').trim() || owner.username,
    // 军团图不区分角色;留空比编一个假角色诚实。
    role: '',
    department: dept ? { id: dept.id, name: dept.name } : null,
    agents: owner.agents.map(agentRef),
  };
}

/** 主入口。`people` 顺序保持 Hub 给的顺序(布局层自己会按 order 排序,这里不越权)。 */
export function legionInputFromOrg(org: AgentOrgData, title?: string): LegionInput {
  const people = org.owners.map((o) => person(o, org));
  const departments: LegionDepartment[] = org.departments.map((d) => ({
    id: d.id,
    name: d.name,
    parent_id: d.parent_id ?? null,
    leader_user_id: d.leader_user_id ?? null,
    sort: d.sort,
  }));
  const members: LegionMember[] = org.owners.map((o) => ({
    user_id: o.userId,
    department_id: o.departmentId ?? null,
  }));
  return {
    people,
    departments,
    members,
    orphans: org.unowned.map(agentRef),
    ...(title ? { title } : {}),
  };
}
