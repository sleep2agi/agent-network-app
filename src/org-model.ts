// 组织架构(board #419)—— 纯逻辑,可单测,不 import react-native。
//
// Hub(agent-network departments.ts):GET /api/networks/:id/departments 回部门(带直属人数)和每个成员所在部门;
// 网络本身是根(parent_id = null 的部门挂在网络下面)。这里只做界面要的:树、路径、某部门的子部门 / 直属成员、
// 搜索、能不能删、移动时哪些部门不能选(自己和下级),以及「人员」列表按部门分组。

export type Department = { id: string; name: string; parent_id: string | null; leader_user_id: string | null; sort: number; member_count: number };
export type MemberPlacement = { user_id: string; department_id: string | null };
export type OrgData = { departments: Department[]; members: MemberPlacement[] };
/** 人(成员表 / 通讯录里的一行),只用到这几个字段。 */
export type OrgPerson = { user_id: string; username: string; display_name?: string | null };

/** 「根」= 网络本身,用 null 表示。 */
export type DeptKey = string | null;

const bySort = (a: Department, b: Department) => a.sort - b.sort || a.name.localeCompare(b.name, 'zh') || a.id.localeCompare(b.id);

export function childrenOf(data: OrgData, parent: DeptKey): Department[] {
  return data.departments.filter(d => (d.parent_id ?? null) === parent).sort(bySort);
}

export function departmentOf(data: OrgData, userId: string): string | null {
  const id = data.members.find(m => m.user_id === userId)?.department_id ?? null;
  return id && data.departments.some(d => d.id === id) ? id : null;
}

/** 某部门的直属成员(根 = 未分配的人)。按显示名排。 */
export function membersIn<P extends OrgPerson>(data: OrgData, dept: DeptKey, people: readonly P[]): P[] {
  return people.filter(p => departmentOf(data, p.user_id) === dept).sort((a, b) => personName(a).localeCompare(personName(b), 'zh'));
}

export const personName = (p: OrgPerson): string => (p.display_name && p.display_name.trim()) || p.username;

/** 从根到这个部门的路径(含自己);找不到 / 成环 → 能走到的那一段。 */
export function pathTo(data: OrgData, dept: DeptKey): Department[] {
  const out: Department[] = [];
  const seen = new Set<string>();
  let cur = dept ? data.departments.find(d => d.id === dept) : undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur);
    cur = cur.parent_id ? data.departments.find(d => d.id === cur!.parent_id) : undefined;
  }
  return out;
}

/** 某部门连同所有下级的 id(移动时这些不能当新上级)。 */
export function subtreeIds(data: OrgData, dept: string): Set<string> {
  const out = new Set<string>([dept]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of data.departments) if (d.parent_id && out.has(d.parent_id) && !out.has(d.id)) { out.add(d.id); grew = true; }
  }
  return out;
}

/** 含所有下级的人数(树上「13」那种总数)。根 = 全部成员。 */
export function totalMembers(data: OrgData, dept: DeptKey): number {
  if (dept === null) return data.members.length;
  const ids = subtreeIds(data, dept);
  return data.members.filter(m => m.department_id && ids.has(m.department_id)).length;
}

/** 只有空部门能删(Hub 同一规则):没有子部门、没有直属成员。 */
export function deleteBlocker(data: OrgData, dept: string): { children: number; members: number } | null {
  const children = data.departments.filter(d => d.parent_id === dept).length;
  const members = data.members.filter(m => m.department_id === dept).length;
  return children || members ? { children, members } : null;
}

/** 树形展开成一行一行(带层级),给桌面左栏、部门选择器用。parentless 的都挂在根下。 */
export function flattenTree(data: OrgData, opts: { collapsed?: ReadonlySet<string> } = {}): Array<{ dept: Department; depth: number; hasChildren: boolean }> {
  const out: Array<{ dept: Department; depth: number; hasChildren: boolean }> = [];
  const walk = (parent: DeptKey, depth: number, seen: Set<string>) => {
    for (const d of childrenOf(data, parent)) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const kids = childrenOf(data, d.id);
      out.push({ dept: d, depth, hasChildren: kids.length > 0 });
      if (!opts.collapsed?.has(d.id)) walk(d.id, depth + 1, seen);
    }
  };
  walk(null, 0, new Set());
  return out;
}

/** 搜索部门名和人名(含用户名),大小写不敏感。空词 = 不搜。 */
export function searchOrg<P extends OrgPerson>(data: OrgData, people: readonly P[], q: string): { departments: Department[]; people: P[] } {
  const needle = q.trim().toLocaleLowerCase();
  if (!needle) return { departments: [], people: [] };
  return {
    departments: data.departments.filter(d => d.name.toLocaleLowerCase().includes(needle)).sort(bySort),
    people: people.filter(p => personName(p).toLocaleLowerCase().includes(needle) || p.username.toLocaleLowerCase().includes(needle)),
  };
}

/** 部门的完整名字「产品研发部 / 前端组」(人员列表的分组标题、选择器里用)。 */
export const deptPathLabel = (data: OrgData, dept: string): string => pathTo(data, dept).map(d => d.name).join(' / ');

/**
 * 「人员」列表按部门分组:按树的顺序(深度优先)一个部门一组,没分部门的最后一组(key null)。
 * 一个部门都没有、或谁都没分 → 返回 null(界面照旧一个平的列表,和升级前一样)。
 */
export function groupPeopleByDepartment<P extends OrgPerson>(data: OrgData | null, people: readonly P[]): Array<{ key: string | null; title: string | null; people: P[] }> | null {
  if (!data || !data.departments.length) return null;
  const placed = people.filter(p => departmentOf(data, p.user_id));
  if (!placed.length) return null;
  const groups: Array<{ key: string | null; title: string | null; people: P[] }> = [];
  for (const { dept } of flattenTree(data)) {
    const rows = people.filter(p => departmentOf(data, p.user_id) === dept.id);
    if (rows.length) groups.push({ key: dept.id, title: deptPathLabel(data, dept.id), people: rows });
  }
  const rest = people.filter(p => !departmentOf(data, p.user_id));
  if (rest.length) groups.push({ key: null, title: null, people: rest });
  return groups;
}
