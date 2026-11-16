// 节点权限「两个问题」(admin 2026-11-16「还是没有一个简单易用明了的权限方案」「交互体验要好」)。
//
// 每个节点只回答:
//   它能做什么？  只读 / 成员 / 部门管理［部门］/ 全网管理
//   谁能找它？    所有人 / 本部门(含主人) / 只有主人 / 指定…
//
// 纯换算,不改 Hub:
//   只读      = permission_mode readonly,无管理授权
//   成员      = normal,无管理授权
//   部门管理  = normal + 该部门的 schedules / board / rules · edit
//   全网管理  = normal + network 的 schedules / board / rules · edit
//   所有人    = 收件名单 null(不限)
//   本部门    = [dept:<节点部门>, user:<主人>]
//   只有主人  = [user:<主人>]
// 现有设置对不上任何一档 ⇒ 'custom'(界面显示「自定义」,细项在「高级」里,不会被悄悄覆盖)。
import type { NodeGrant } from './api';

export type NodeRole = 'readonly' | 'member' | 'dept' | 'network' | 'custom';
export type NodeReach = 'all' | 'dept' | 'owner' | 'custom';

/** 「管理」档授予的三种能力。只要 Hub 支持其中几种就授几种(老 Hub 没有 rules)。 */
export const MANAGE_CAPABILITIES = ['schedules', 'board', 'rules'] as const;

type GrantLike = Pick<NodeGrant, 'capability' | 'scope_kind' | 'scope_id' | 'level'>;

export type RoleState = { role: NodeRole; deptId?: string };

/** 从模式 + 管理授权推出「它能做什么」。 */
export function deriveRole(mode: string | null | undefined, grants: readonly GrantLike[] | null | undefined, offered: readonly string[] = MANAGE_CAPABILITIES): RoleState {
  const list = grants ?? [];
  if (mode === 'readonly') return { role: list.length ? 'custom' : 'readonly' };
  if (mode && mode !== 'normal') return { role: 'custom' };
  if (!list.length) return { role: 'member' };
  const caps = MANAGE_CAPABILITIES.filter(c => offered.includes(c));
  const allEdit = list.every(g => g.level === 'edit');
  const capSet = new Set(list.map(g => g.capability));
  const sameCaps = capSet.size === caps.length && caps.every(c => capSet.has(c)) && list.length === caps.length;
  if (!allEdit || !sameCaps) return { role: 'custom' };
  const kinds = new Set(list.map(g => `${g.scope_kind}|${g.scope_id}`));
  if (kinds.size !== 1) return { role: 'custom' };
  const g = list[0];
  if (g.scope_kind === 'network') return { role: 'network' };
  if (g.scope_kind === 'department' && g.scope_id) return { role: 'dept', deptId: g.scope_id };
  return { role: 'custom' };
}

/** 「它能做什么」→ 要写的模式和整份管理授权(PUT grants 是整份替换)。 */
export function roleSettings(role: Exclude<NodeRole, 'custom'>, deptId: string | undefined, offered: readonly string[] = MANAGE_CAPABILITIES): { mode: 'normal' | 'readonly'; grants: GrantLike[] } {
  const caps = MANAGE_CAPABILITIES.filter(c => offered.includes(c));
  if (role === 'readonly') return { mode: 'readonly', grants: [] };
  if (role === 'member') return { mode: 'normal', grants: [] };
  if (role === 'network') return { mode: 'normal', grants: caps.map(capability => ({ capability, scope_kind: 'network', scope_id: '', level: 'edit' })) };
  if (!deptId) throw new Error('dept role needs a department');
  return { mode: 'normal', grants: caps.map(capability => ({ capability, scope_kind: 'department', scope_id: deptId, level: 'edit' })) };
}

const ownerEntries = (owner: { username?: string | null; user_id?: string | null } | null | undefined): string[] =>
  [owner?.username ? `user:${owner.username}` : null, owner?.user_id ? `user:${owner.user_id}` : null].filter((x): x is string => !!x);

/** 从收件名单推出「谁能找它」。 */
export function deriveReach(inbox: readonly string[] | null | undefined, nodeDeptId: string | null | undefined, owner: { username?: string | null; user_id?: string | null } | null | undefined): NodeReach {
  if (!inbox || inbox.length === 0) return 'all';
  const own = new Set(ownerEntries(owner));
  const rest = inbox.filter(e => !own.has(e));
  const hasOwner = rest.length < inbox.length;
  if (!hasOwner) return 'custom';
  if (rest.length === 0) return 'owner';
  if (nodeDeptId && rest.length === 1 && rest[0] === `dept:${nodeDeptId}`) return 'dept';
  return 'custom';
}

/** 「谁能找它」→ 收件名单(null = 不限)。本部门需要节点有部门;只有主人需要知道主人是谁。 */
export function reachInbox(reach: Exclude<NodeReach, 'custom'>, nodeDeptId: string | null | undefined, owner: { username?: string | null; user_id?: string | null } | null | undefined): string[] | null {
  if (reach === 'all') return null;
  const own = owner?.username ? `user:${owner.username}` : owner?.user_id ? `user:${owner.user_id}` : null;
  if (!own) throw new Error('owner unknown');
  if (reach === 'owner') return [own];
  if (!nodeDeptId) throw new Error('node has no department');
  return [`dept:${nodeDeptId}`, own];
}

/** 收窄「谁能找它」时要先说后果:从宽到窄的顺序。 */
const REACH_WIDTH: Record<NodeReach, number> = { all: 3, dept: 2, custom: 1.5, owner: 1 };
export const reachNarrows = (from: NodeReach, to: NodeReach): boolean => REACH_WIDTH[to] < REACH_WIDTH[from];
