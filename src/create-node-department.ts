// 2026-11-14 新建节点时选「所属部门」(admin:「创建人可能兼多个部门管理员」→ 不猜,让创建人选)。
// 纯逻辑,不 import react-native。Hub 侧:create_node.department_id(/health 报 create_node_department 才有)。
import { flattenTree, type OrgData } from './org-model';

export const CREATE_NODE_DEPARTMENT_CAPABILITY = 'create_node_department';

export type DeptChoice = { id: string; name: string; depth: number };

/** 这个人在本网络的身份:管理员看全部;部门负责人看自己负责的(含下级);普通成员只有自己所在的部门。 */
export type DeptScope = {
  /** owner / admin(或 Hub 管理员)。 */
  all: boolean;
  /** /api/auth/me 的 managed_department_ids(我负责的部门 + 全部下级)。 */
  managed: readonly string[];
  /** 我自己(作为成员)所在的部门。 */
  own: string | null;
  /** 我**直接**担任负责人的部门(不含下级):用来判断「我兼几个部门」。 */
  led: readonly string[];
};

/** 可选的部门,按部门树顺序(带层级,方便缩进)。 */
export function departmentChoices(org: OrgData | null | undefined, scope: DeptScope): DeptChoice[] {
  if (!org) return [];
  return flattenTree(org)
    .filter(({ dept }) => scope.all || scope.managed.includes(dept.id) || scope.own === dept.id)
    .map(({ dept, depth }) => ({ id: dept.id, name: dept.name, depth }));
}

/**
 * 预选哪个部门:
 *   只有一个可选 → 就它(大多数普通成员,不用多点一下)。
 *   多个可选 → 只有「我所在的部门 ∪ 我直接负责的部门」恰好是一个时才预选;兼了几个部门就**不预选**,让人挑。
 *   宁可多点一下,也不放错。
 */
export function defaultDepartment(choices: readonly DeptChoice[], scope: Pick<DeptScope, 'own' | 'led'>): string | null {
  if (choices.length === 1) return choices[0].id;
  const ids = new Set(choices.map(c => c.id));
  const mine = [...new Set([scope.own, ...scope.led].filter((x): x is string => !!x && ids.has(x)))];
  return mine.length === 1 ? mine[0] : null;
}

/** 从 /api/auth/me + 部门列表拼出 DeptScope。 */
export function deptScopeFor(
  me: { user?: { user_id?: string; role?: string } | null; networks?: ReadonlyArray<{ network_id?: string; member_role?: string; managed_department_ids?: unknown }> | null } | null | undefined,
  networkId: string | undefined,
  org: OrgData | null | undefined,
): DeptScope {
  const uid = me?.user?.user_id ?? '';
  const row = me?.networks?.find(n => n.network_id === networkId);
  const role = row?.member_role;
  const all = me?.user?.role === 'admin' || role === 'owner' || role === 'admin';
  const managed = Array.isArray(row?.managed_department_ids) ? (row!.managed_department_ids as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  const own = org?.members.find(m => m.user_id === uid)?.department_id ?? null;
  const led = uid ? (org?.departments ?? []).filter(d => d.leader_user_id === uid).map(d => d.id) : [];
  return { all, managed, own, led };
}

/** 确认页那一行显示什么。 */
export function departmentLabel(choices: readonly DeptChoice[], value: string | null): string {
  return (value && choices.find(c => c.id === value)?.name) || '暂不分配';
}
