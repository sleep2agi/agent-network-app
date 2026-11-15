// #4863（admin 2026-11-15 截图）—— 节点「聊天信息」/ 节点页里直接调整「所属部门」。
//
// 现状痛点：调整归属只在「Agent 组织架构」页；节点页只读显示部门路径，**未归属时整行不出现**，
// 于是管理员在节点里根本找不到入口。这里只放**纯模型**（选项、文案、权限），
// 渲染与写操作在 NodeDepartmentPicker.tsx / NodeDetailScreen.tsx / ChatScreen.tsx。
//
// 红线：
//   · 不新增写路径 —— 保存一律走 agent-org-api.moveAgentDepartment（PUT …/nodes/:id/department）；
//   · 未归属也要有这一行（admin 找不到入口就是因为这行没出现）；
//   · 无权限时只读 + 说明原因（沿用 agentOrg.saveForbidden），不许「灰掉但不解释」。
import { departmentPathLabel } from './node-page-model';
import { canEditAnyDepartment } from './agent-org-dept-menu';
import type { Department, OrgData } from './org-model';

export type OrgLike = Pick<OrgData, 'departments'> | null | undefined;

export type DepartmentOption = {
  /** null = 「未归属」（把节点从部门里摘出来）。 */
  id: string | null;
  label: string;
  subtitle?: string;
  testID: string;
  /** #4863（通信欧 11-15 定）：选项层用**逐部门事实** —— 这个人不能管的部门灰掉并给原因，别让他白点。
   *  `false` 只在 Hub 明确说不能管时出现；数据缺失 ⇒ undefined（可选）。 */
  disabled?: boolean;
  disabledReason?: string;
};

/** 行本身（聊天信息 / 节点页共用）。 */
export const DEPARTMENT_ROW_TESTID = 'node-department-row';
export const DEPARTMENT_SELECTOR_TESTID = 'node-department-selector';
export const departmentOptionTestId = (id: string | null) => `node-department-option-${id ?? 'unassigned'}`;

/** 未归属时的显示文案。**必须显示**，不是省略。 */
export const UNASSIGNED_LABEL = '未归属';

/**
 * 一行「所属部门」的显示值：已归属 = 完整路径（`天马 / 研发 / 客户端`）；未归属 / 部门读不到 = 「未归属」。
 * 注意 `departmentPathLabel` 对未归属返回 undefined（节点页以前就靠这个隐掉整行），这里刻意兜底。
 */
export function departmentDisplayLabel(org: OrgLike, departmentId: string | null | undefined): string {
  return departmentPathLabel(org, departmentId) ?? UNASSIGNED_LABEL;
}

/**
 * 选择器选项：第一项恒为「未归属」，其余按路径排序（同层按名字，路径已含层级）。
 * 没有部门表时也返回「未归属」——**空的选项列表 = 用户点了没反应**，那是最差体验。
 */
export function departmentOptions(org: OrgLike): DepartmentOption[] {
  const depts = org?.departments ?? [];
  const rows = depts
    .map(d => ({ d, label: departmentPathLabel(org, d.id) ?? d.name }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'));
  return [
    // 「未归属」永远可选：它是「摘出来」，不是「放进某个部门」。
    { id: null, label: UNASSIGNED_LABEL, subtitle: '不放进任何部门', testID: departmentOptionTestId(null) },
    ...rows.map(({ d, label }) => {
      // 逐部门事实（通信欧 11-15 定）：Hub 明说 `manage:false` ⇒ 灰掉并给原因；
      // **数据缺失（viewer_can 整个没有）⇒ 视为可选** —— 不猜权限，最终仍以 Hub 403 为准。
      // 注意这里**不叠加** canManageStructure：聚合判据只负责「能不能开门」，不该让管理员
      // 顺手绕过某个部门的显式拒绝（那正是“选到必被 403 的项”）。
      const manage = d.viewer_can?.manage;
      return {
        id: d.id,
        label,
        subtitle: d.id,
        testID: departmentOptionTestId(d.id),
        ...(manage === false ? { disabled: true, disabledReason: DEPARTMENT_READONLY_REASON_KEY } : {}),
      };
    }),
  ];
}

/**
 * 能不能改：与「Agent 组织架构」页同一套判据（Hub `viewer_can` 优先，旧 Hub 退回网络 owner/admin）。
 * 没有部门表时也给 false —— 无可选目标，改不了。
 */
export function canEditDepartments(org: OrgLike, canManageStructure: boolean): boolean {
  const depts = org?.departments ?? [];
  if (depts.length === 0) return false;
  return canEditAnyDepartment(depts, canManageStructure);
}

/** 只读时给的原因（i18n key，与组织架构页同一句，别另造一句）。 */
export const DEPARTMENT_READONLY_REASON_KEY = 'agentOrg.saveForbidden';

/** 保存结果 → 人话（复用组织架构页已有的失败文案 key）。 */
export function moveFailureKey(reason: 'forbidden' | 'node' | 'department' | 'unsupported' | 'error'): string {
  switch (reason) {
    case 'forbidden': return 'agentOrg.saveForbidden';
    case 'node': return 'agentOrg.saveNoNode';
    case 'department': return 'agentOrg.saveNoDepartment';
    case 'unsupported': return 'agentOrg.saveUnsupported';
    default: return 'agentOrg.saveFailed';
  }
}
