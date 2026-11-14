// 「组织与权限 → 部门与 Agent」左栏部门树的右键 / 长按菜单(管理员 2026-11-14:「右键可以新建组织、重命名组织等」)。
// 纯逻辑:给一个部门(或空白处 = null)算出菜单项。权限以 Hub 的 viewer_can 为准(RFC-040:manage = 改名 / 移动 / 删除,
// create_child = 在下面建子部门);旧 Hub 没有 viewer_can ⇒ 退回「网络 owner / admin / Hub 管理员才能改」。
// 根部门只有 owner / admin 能建(Hub 同规则)。Hub 仍是最后的判定,这里只决定画不画这一项。
import type { Department } from './org-model';

export type DeptMenuAction = 'createChild' | 'rename' | 'reparent' | 'delete' | 'createRoot';

export function deptMenuActions(dept: Department | null, canManageStructure: boolean, treeApi = true): DeptMenuAction[] {
  if (!treeApi) return [];
  const out: DeptMenuAction[] = [];
  if (dept) {
    const manage = dept.viewer_can?.manage ?? canManageStructure;
    const createChild = dept.viewer_can?.create_child ?? canManageStructure;
    if (createChild) out.push('createChild');
    if (manage) out.push('rename', 'reparent', 'delete');
  }
  if (canManageStructure) out.push('createRoot');
  return out;
}

/** 有没有任何一个部门(或根)可以改 —— 决定页头提示说「右键可以改」还是「只读」。 */
export function canEditAnyDepartment(departments: readonly Department[], canManageStructure: boolean, treeApi = true): boolean {
  if (!treeApi) return false;
  return canManageStructure || departments.some(d => !!d.viewer_can?.manage || !!d.viewer_can?.create_child);
}

export const DEPT_MENU_LABEL_KEY: Record<DeptMenuAction, string> = {
  createChild: 'agentOrg.menu.createChild',
  rename: 'agentOrg.menu.rename',
  reparent: 'agentOrg.menu.reparent',
  delete: 'agentOrg.menu.delete',
  createRoot: 'agentOrg.menu.createRoot',
};

/** 删除前先在本地数一遍挡路的东西(Hub 规则同:子部门 / 直属成员 / 直属 Agent 任一非零 ⇒ 409 department_not_empty)。 */
export type DeleteBlockers = { children: number; members: number; agents: number };
export function deleteBlockers(dept: Department, departments: readonly Department[], directAgents: number): DeleteBlockers {
  return {
    children: departments.filter(d => (d.parent_id ?? null) === dept.id).length,
    members: Math.max(0, dept.member_count || 0),
    agents: Math.max(0, directAgents),
  };
}
export const isDeleteBlocked = (b: DeleteBlockers): boolean => b.children > 0 || b.members > 0 || b.agents > 0;

/** Hub 409 department_not_empty 的 detail(children / members / agents)→ 同一个结构;字段缺了按 0。 */
export function blockersFromDetail(detail: Record<string, unknown> | undefined): DeleteBlockers {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  return { children: n(detail?.children), members: n(detail?.members), agents: n(detail?.agents) };
}
