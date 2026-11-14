// 2026-11-14 —— 设置 →「组织与权限」(admin「心智负担那么重」):原来「用户管理」与「Agent 组织架构」
// 是两个入口,同一棵部门树分两处管。合成一个入口,里面按「这页回答什么问题」分页签:
//   部门与 Agent —— 人人可看:部门树、每个部门有哪些 Agent、谁负责;有权限的人在这里调整归属。
//   成员与权限 —— 只给能管成员的人:每个人是什么角色、能用哪些 Agent。
// 纯逻辑,不 import react-native。
export type OrgAccessTab = 'org' | 'members';

/** 这个人看得到哪些页签(顺序即显示顺序)。不能管成员的人只有「部门与 Agent」,此时不画页签条。 */
export function orgAccessTabs(canManageMembers: boolean): readonly OrgAccessTab[] {
  return canManageMembers ? ['org', 'members'] : ['org'];
}

export const ORG_ACCESS_TAB_LABEL: Record<OrgAccessTab, string> = {
  org: '部门与 Agent',
  members: '成员与权限',
};

/** 选中的页签不在可见列表里(权限变了 / 切了网络)→ 回到第一个。 */
export function resolveOrgAccessTab(want: OrgAccessTab | null | undefined, tabs: readonly OrgAccessTab[]): OrgAccessTab {
  return want && tabs.includes(want) ? want : tabs[0];
}

/**
 * 记住上次的页签(点进成员三级页再返回会重新挂载),但**按账号 + 网络**记:
 * 管理员 A 退出、B 登录,不该继承 A 停在的页签(#1432 审阅)。
 */
export function rememberedTab(memory: { scope: string; tab: OrgAccessTab } | null, scope: string): OrgAccessTab | null {
  return memory && memory.scope === scope ? memory.tab : null;
}

/** 搜索命中的是哪一行,就先打开哪一页(搜「新建用户」直接落在成员页)。 */
export function tabForSettingsRow(rowKey: string | null | undefined): OrgAccessTab | null {
  if (rowKey === 'members' || rowKey === 'newUser') return 'members';
  if (rowKey === 'org') return 'org';
  return null;
}

/** 有数据才出现:没人用的机制(Agent 团队、Agent 分组)空着时整块不画,平时看不到。 */
export function showWhenUsed<T>(items: readonly T[] | null | undefined): items is readonly T[] {
  return Array.isArray(items) && items.length > 0;
}
