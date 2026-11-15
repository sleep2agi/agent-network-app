// 「组织 → 架构图」(管理员 2026-11-15「组织架构图做好看一点，还需要有那种宣传效果」)。纯模块·可单测。
//
// 一张能直接截图拿去宣传的图:顶上一条品牌色横幅(几个大数字 + 头像墙),下面按根部门分栏的架构树
// (根部门一张卡、子部门挂在下面)。数据就是组织页已经读到的那份(AgentOrgData + placeAgents),不多读接口。
import { childrenOf, subtreeIds, type Department } from './org-model';
import { agentCount, orgTree, type AgentOrgData, type PlacedAgent } from './agent-org-model';

/**
 * 每栏一种颜色(按顺序轮换),卡片顶边和子部门竖线用它。
 * 管理员 2026-11-15「这个蓝色 AI 感太重了」:不用高饱和的蓝紫青,换成低饱和的大地色系(石板蓝 / 鼠尾草绿 / 陶土 / 赭黄 / 梅紫 / 灰青 / 胡桃 / 橄榄)。
 */
export const DEPT_HUES = ['#56708c', '#5f8a6f', '#b06c4c', '#a3843a', '#80628f', '#4f8585', '#8a6b52', '#6f7f4a'] as const;

export const isRunning = (a: Pick<PlacedAgent, 'lifecycleState'>): boolean => a.lifecycleState === 'active';

export type ShowcaseStats = { agents: number; departments: number; running: number; owners: number; unassigned: number };

/** 下钻(管理员 2026-11-15「点击这里能下钻吗」):rootId = null 是整个组织,否则是这个部门的子树。 */
export function scopedPlaced(data: AgentOrgData, placed: readonly PlacedAgent[], rootId: string | null): PlacedAgent[] {
  if (rootId === null) return [...placed];
  const ids = subtreeIds(orgTree(data), rootId);
  return placed.filter(a => a.departmentId !== null && ids.has(a.departmentId));
}

/** 从根到 rootId 的部门链(面包屑用);null → []。 */
export function deptTrail(data: AgentOrgData, rootId: string | null): Department[] {
  const byId = new Map(data.departments.map(d => [d.id, d]));
  const out: Department[] = [];
  for (let id = rootId, guard = 0; id && guard < 32; guard++) {
    const d = byId.get(id);
    if (!d) break;
    out.unshift(d);
    id = d.parent_id ?? null;
  }
  return out;
}

export function showcaseStats(data: AgentOrgData, placed: readonly PlacedAgent[], rootId: string | null = null): ShowcaseStats {
  if (rootId !== null) {
    const scoped = scopedPlaced(data, placed, rootId);
    const owners = new Set(scoped.map(a => a.ownerUserId).filter((x): x is string => !!x));
    return { agents: scoped.length, departments: subtreeIds(orgTree(data), rootId).size - 1, running: scoped.filter(isRunning).length, owners: owners.size, unassigned: 0 };
  }
  const owners = new Set(placed.map(a => a.ownerUserId).filter((x): x is string => !!x));
  return {
    agents: placed.length,
    departments: data.departments.length,
    running: placed.filter(isRunning).length,
    owners: owners.size,
    unassigned: placed.filter(a => a.departmentId === null).length,
  };
}

/** 头像墙 / 头像叠:运行中的排前面,同状态按名字,取前 n 个;余下的给「+N」。 */
export function pickAvatars(agents: readonly PlacedAgent[], n: number): { aliases: string[]; more: number } {
  const sorted = [...agents].sort((a, b) => Number(isRunning(b)) - Number(isRunning(a)) || a.alias.localeCompare(b.alias, 'zh'));
  return { aliases: sorted.slice(0, n).map(a => a.alias), more: Math.max(0, agents.length - n) };
}

export type ShowcaseChild = { dept: Department; depth: number; total: number; running: number; avatars: string[]; more: number };
export type ShowcaseColumn = { dept: Department; hue: string; total: number; running: number; avatars: string[]; more: number; children: ShowcaseChild[] };

/** 一个根部门一栏;子部门(任意层)按树序摊平挂在下面,depth 从 1 起。计数含下级。 */
export function showcaseColumns(data: AgentOrgData, placed: readonly PlacedAgent[], opts: { rootAvatars?: number; childAvatars?: number; rootId?: string | null } = {}): ShowcaseColumn[] {
  const tree = orgTree(data);
  const inSubtree = (id: string) => {
    const ids = subtreeIds(tree, id);
    return placed.filter(a => a.departmentId !== null && ids.has(a.departmentId));
  };
  return childrenOf(tree, opts.rootId ?? null).map((root, i) => {
    const agents = inSubtree(root.id);
    const children: ShowcaseChild[] = [];
    const walk = (parent: string, depth: number, seen: Set<string>) => {
      for (const d of childrenOf(tree, parent)) {
        if (seen.has(d.id)) continue;
        seen.add(d.id);
        const sub = inSubtree(d.id);
        const pick = pickAvatars(sub, opts.childAvatars ?? 3);
        children.push({ dept: d, depth, total: agentCount([...placed], data, d.id), running: sub.filter(isRunning).length, avatars: pick.aliases, more: pick.more });
        walk(d.id, depth + 1, seen);
      }
    };
    walk(root.id, 1, new Set([root.id]));
    const pick = pickAvatars(agents, opts.rootAvatars ?? 5);
    return { dept: root, hue: DEPT_HUES[i % DEPT_HUES.length], total: agentCount([...placed], data, root.id), running: agents.filter(isRunning).length, avatars: pick.aliases, more: pick.more, children };
  });
}
