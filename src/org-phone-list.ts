// 手机「组织」页的部门列表模型（admin 2026-11-17「这个里面真的是有点太丑了……要有那种很舒适的感觉，
// 第一性原理上是给用户用起来省心省力」）。
// 用户打开这一页要的是：哪个部门有谁、有多少在干活，点进去就能找到人。所以每一行给：
//   头像叠 3 个（在跑的排前面）+ 部门名 + 「N 个 Agent · M 个运行中」+ 箭头，不再是文件夹图标 + 一个光秃的数字。
// 纯逻辑，不 import react-native。
import { orgTree, type AgentOrgData, type PlacedAgent } from './agent-org-model';
import { isAgentLive, isRunning } from './org-showcase-model';
import { childrenOf, subtreeIds } from './org-model';

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
export function phoneDeptFacts(
  placed: readonly PlacedAgent[],
  data: AgentOrgData,
  dept: string | null,
  max = PHONE_AVATAR_STACK,
  statusByAlias?: ReadonlyMap<string, string> | null,
): PhoneDeptFacts {
  const agents = agentsIn(placed, data, dept);
  const live = (a: PlacedAgent) => isAgentLive(a, statusByAlias);
  const sorted = [...agents].sort((a, b) => Number(live(b)) - Number(live(a)) || a.alias.localeCompare(b.alias, 'zh'));
  return { count: agents.length, running: agents.filter(live).length, avatars: sorted.slice(0, max).map(a => a.alias) };
}

/** Phone indent per tree level. Small on purpose: three levels must still leave room for the name. */
export const PHONE_TREE_INDENT = 14;

// ── 逐层进入 / 搜索 / 需要关注（admin 2026-11-17「你来做吧」：按调研方案做第一步）──
// 外面的共识：手机上不要摊开整棵树（认知负担太重），一层一层点进去；先搜索、后层级；把卡住的 Agent 提到最前面。

/** The departments shown at one drill level: the children of `parent` (null = top level). */
export function phoneLevel(data: AgentOrgData, parent: string | null) {
  const tree = orgTree(data);
  return childrenOf(tree, parent).map(dept => ({ dept, hasChildren: childrenOf(tree, dept.id).length > 0 }));
}

/** Tapping a department row: drill in if it has sub-departments, else open its member list. */
export function phoneRowAction(hasChildren: boolean): 'drill' | 'open' {
  return hasChildren ? 'drill' : 'open';
}

/** Hub session statuses that mean a person should look now (same words as the list dot). */
export function needsAttention(status?: string | null): boolean {
  return status === 'blocked' || status === 'error' || status === 'failed';
}

export function attentionAgents(placed: readonly PlacedAgent[], statusByAlias: ReadonlyMap<string, string>): PlacedAgent[] {
  return placed.filter(a => needsAttention(statusByAlias.get(a.alias))).sort((a, b) => a.alias.localeCompare(b.alias, 'zh'));
}

export const PHONE_SEARCH_CAP = 30;

/** Case-insensitive search over department names, agent aliases and owner names. Empty query ⇒ null (no search). */
export function phoneSearch(data: AgentOrgData, placed: readonly PlacedAgent[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const departments = data.departments.filter(d => d.name.toLowerCase().includes(q)).slice(0, PHONE_SEARCH_CAP);
  const agents = placed.filter(a => a.alias.toLowerCase().includes(q) || (a.ownerName ?? '').toLowerCase().includes(q))
    .sort((a, b) => Number(isRunning(b)) - Number(isRunning(a)) || a.alias.localeCompare(b.alias, 'zh'))
    .slice(0, PHONE_SEARCH_CAP);
  return { departments, agents };
}
