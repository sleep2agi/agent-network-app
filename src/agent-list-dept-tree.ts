// 侧栏「分组 · 部门」的分组标题按组织树排(管理员 2026-11-14「这个组织架构怎么 UI/UX 好一点」):
// 以前每组标题是完整路径「TMAI / TMWork」、按在线人数排 —— 父部门「TMAI」被排到最底下,
// 子部门挤成一排重复前缀的平列表,看不出谁属于谁。现在:深度优先(父在前、子缩进跟在后),
// 父部门这一组在列表里时子部门只写自己的名字;父部门不在(没有直属 agent / 被搜掉)时前缀照旧留着(变灰)。
// 「未归属」永远最后。分组的 key(折叠记忆、testID)仍是完整路径,不变。
import { deptPathLabel, flattenTree, type OrgData } from './org-model';

export const UNASSIGNED_DEPT = '未归属';
export const PATH_SEP = ' / ';

/** 完整路径标题 → 树里的先后(深度优先)。不在树里的标题排在树后、「未归属」前。 */
export function deptTreeRank(data: OrgData | null): (title: string) => number {
  const rank = new Map<string, number>();
  if (data) flattenTree(data).forEach(({ dept }, i) => { rank.set(deptPathLabel(data, dept.id), i); });
  const unknown = rank.size;
  return title => (title === UNASSIGNED_DEPT ? unknown + 1 : rank.get(title) ?? unknown);
}

export type DeptHeaderLayout = { depth: number; prefix: string | null; leaf: string };

/**
 * 一个分组标题怎么画:depth = 列表里能看见的祖先组有几个(缩进几级);
 * leaf = 自己的名字;prefix = 列表里看不见的那段祖先路径(灰字),全都看得见时为 null。
 */
export function deptHeaderLayout(title: string, shownTitles: ReadonlySet<string>): DeptHeaderLayout {
  const parts = title.split(PATH_SEP);
  if (parts.length < 2 || title === UNASSIGNED_DEPT) return { depth: 0, prefix: null, leaf: title };
  let depth = 0;
  let hidden: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    const ancestor = parts.slice(0, i).join(PATH_SEP);
    if (shownTitles.has(ancestor)) { depth++; hidden = []; } else hidden.push(parts[i - 1]);
  }
  return { depth, prefix: hidden.length ? hidden.join(PATH_SEP) + PATH_SEP : null, leaf: parts[parts.length - 1] };
}
