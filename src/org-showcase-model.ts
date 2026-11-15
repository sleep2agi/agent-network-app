// 「组织 → 架构图」(管理员 2026-11-15「组织架构图做好看一点，还需要有那种宣传效果」)。纯模块·可单测。
//
// 一张能直接截图拿去宣传的图:顶上一条品牌色横幅(几个大数字 + 头像墙),下面按根部门分栏的架构树
// (根部门一张卡、子部门挂在下面)。数据就是组织页已经读到的那份(AgentOrgData + placeAgents),不多读接口。
import { childrenOf, subtreeIds, type Department } from './org-model';
import { agentCount, orgTree, type AgentOrgData, type PlacedAgent } from './agent-org-model';

/** 每个根部门一种颜色(按顺序轮换),卡片顶边和子部门竖线用它。浅深色都能看清的中等饱和度。 */
export const DEPT_HUES = ['#1b65db', '#0891b2', '#7c3aed', '#059669', '#d97706', '#db2777', '#4f46e5', '#0d9488'] as const;

export const isRunning = (a: Pick<PlacedAgent, 'lifecycleState'>): boolean => a.lifecycleState === 'active';

export type ShowcaseStats = { agents: number; departments: number; running: number; owners: number; unassigned: number };

export function showcaseStats(data: AgentOrgData, placed: readonly PlacedAgent[]): ShowcaseStats {
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
export function showcaseColumns(data: AgentOrgData, placed: readonly PlacedAgent[], opts: { rootAvatars?: number; childAvatars?: number } = {}): ShowcaseColumn[] {
  const tree = orgTree(data);
  const inSubtree = (id: string) => {
    const ids = subtreeIds(tree, id);
    return placed.filter(a => a.departmentId !== null && ids.has(a.departmentId));
  };
  return childrenOf(tree, null).map((root, i) => {
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
