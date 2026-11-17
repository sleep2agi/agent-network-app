// 手机「组织」页的部门列表模型（admin 2026-11-17「这个里面真的是有点太丑了……要有那种很舒适的感觉，
// 第一性原理上是给用户用起来省心省力」）。
// 用户打开这一页要的是：哪个部门有谁、有多少在干活，点进去就能找到人。所以每一行给：
//   头像叠 3 个（在跑的排前面）+ 部门名 + 「N 个 Agent · M 个运行中」+ 箭头，不再是文件夹图标 + 一个光秃的数字。
// 纯逻辑，不 import react-native。
import { orgTree, type AgentOrgData, type PlacedAgent } from './agent-org-model';
import { isRunning } from './org-showcase-model';
import { subtreeIds } from './org-model';

export interface PhoneDeptFacts {
  count: number;
  running: number;
  /** Up to `max` aliases for the avatar stack: running agents first, then by name. */
  avatars: string[];
}

export const PHONE_AVATAR_STACK = 3;

function agentsIn(placed: readonly PlacedAgent[], data: AgentOrgData, dept: string | null): PlacedAgent[] {
  if (dept === null) return placed.filter(a => a.departmentId === null);
  const ids = subtreeIds(orgTree(data), dept);
  return placed.filter(a => a.departmentId !== null && ids.has(a.departmentId));
}

/** dept null = 未归属. Counts include sub-departments, like the existing counts on this page. */
export function phoneDeptFacts(placed: readonly PlacedAgent[], data: AgentOrgData, dept: string | null, max = PHONE_AVATAR_STACK): PhoneDeptFacts {
  const agents = agentsIn(placed, data, dept);
  const sorted = [...agents].sort((a, b) => Number(isRunning(b)) - Number(isRunning(a)) || a.alias.localeCompare(b.alias, 'zh'));
  return { count: agents.length, running: agents.filter(isRunning).length, avatars: sorted.slice(0, max).map(a => a.alias) };
}

/** Phone indent per tree level. Small on purpose: three levels must still leave room for the name. */
export const PHONE_TREE_INDENT = 14;
