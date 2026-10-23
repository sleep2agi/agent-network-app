// 项目 / 标签的层级(#2098 / #2102)。
//
// Hub 还没有 parent_id 时,这里必须**完全退化成平铺**:所有函数收到没有 parent 的输入,
// 返回的顺序、深度、计数都和以前一模一样。旧 Hub + 旧数据不能因为「加了树」而挪位或崩掉。
//
// 只做纯计算,不碰网络与 UI:侧栏、管理页、测试共用这一份判定。

export type Parented = { id: string; parentId?: string | null; sort?: number };

export type TreeRow<T> = {
  node: T;
  /** 0 = 根;子节点 = 父 + 1 */
  depth: number;
  /** 有子节点时侧栏才画折叠箭头 */
  hasChildren: boolean;
  parentId: string | null;
};

const parentOf = (n: Parented): string | null => (typeof n.parentId === 'string' && n.parentId ? n.parentId : null);

/** 输入里有没有任何一层父子关系。没有 → 一律走旧的平铺行为。 */
export function hasHierarchy(nodes: readonly Parented[]): boolean {
  const ids = new Set(nodes.map(n => n.id));
  return nodes.some(n => {
    const p = parentOf(n);
    // 父不在这一批里的「孤儿」不算层级:它会被当成根,平铺结果不变。
    return p && p !== n.id && ids.has(p);
  });
}

/**
 * 深度优先展开成一行一行。
 * - 没有层级 → 原样返回(顺序不变,深度 0,无箭头)。
 * - 孤儿(父不在这批里)与自引用 → 当根处理,绝不丢节点。
 * - 环(甲→乙→甲)→ 走到重复节点就停,把它当根,绝不死循环。
 * - collapsed 里的节点:自身仍出现,子节点不出现(箭头保留,便于再展开)。
 */
export function projectRows<T extends Parented>(nodes: readonly T[], collapsed?: ReadonlySet<string>): TreeRow<T>[] {
  if (!hasHierarchy(nodes)) {
    return nodes.map(node => ({ node, depth: 0, hasChildren: false, parentId: null }));
  }
  const byParent = new Map<string | null, T[]>();
  const ids = new Set(nodes.map(n => n.id));
  for (const n of nodes) {
    const raw = parentOf(n);
    const parent = raw && raw !== n.id && ids.has(raw) ? raw : null;
    const list = byParent.get(parent) ?? [];
    list.push(n);
    byParent.set(parent, list);
  }
  const out: TreeRow<T>[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const node of byParent.get(parent) ?? []) {
      if (seen.has(node.id)) continue; // 环:第二次遇到就停,不重复也不死循环
      seen.add(node.id);
      const kids = byParent.get(node.id) ?? [];
      const hasChildren = kids.some(k => !seen.has(k.id));
      out.push({ node, depth, hasChildren, parentId: parent });
      if (!hasChildren) continue;
      if (collapsed?.has(node.id)) {
        // 折叠:整棵子树收起来 —— 但要标成「已覆盖」,否则末尾的兜底会把它们当孤儿补回来。
        const cover = (id: string) => {
          for (const kid of byParent.get(id) ?? []) {
            if (seen.has(kid.id)) continue;
            seen.add(kid.id);
            cover(kid.id);
          }
        };
        cover(node.id);
        continue;
      }
      walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  // 兜底:任何因为环而被跳过的节点仍然按根补在末尾,信息不丢。
  for (const n of nodes) {
    if (!seen.has(n.id)) {
      seen.add(n.id);
      out.push({ node: n, depth: 0, hasChildren: false, parentId: null });
    }
  }
  return out;
}

/**
 * 祖先计数聚合:父项目的数字 = 自己的任务 + 所有后代的任务。
 * 没有层级时逐项返回原数字(行为与现在相同)。
 */
export function aggregateCounts<T extends Parented>(
  rows: readonly TreeRow<T>[],
  own: (node: T) => number,
): Map<string, number> {
  const total = new Map<string, number>();
  for (const row of rows) total.set(row.node.id, own(row.node));
  if (!rows.some(r => r.parentId)) return total;
  // 由深到浅累加,父节点一定在子节点之后出现(DFS 顺序的逆序)。
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (!row.parentId) continue;
    total.set(row.parentId, (total.get(row.parentId) ?? 0) + (total.get(row.node.id) ?? 0));
  }
  return total;
}

/** 标签层级:Hub 用 `parents: { 子: 父 }` 表达(没有这个字段 = 旧行为)。 */
export type TagParents = Record<string, string | null | undefined>;

export type TagRow = TreeRow<{ name: string }>;

/**
 * 标签行。names 已经是排好的顺序(用量降序),这里只按父子重排:
 * 父后面紧跟它的后代;孤儿 / 环的处理与项目一致。
 */
export function tagRows(names: readonly string[], parents: TagParents | null | undefined, collapsed?: ReadonlySet<string>): TagRow[] {
  if (!parents) return names.map(name => ({ node: { name }, depth: 0, hasChildren: false, parentId: null }));
  const nodes: Parented[] = names.map(name => ({ id: name, parentId: parents[name] ?? null }));
  const rows = projectRows(nodes, collapsed);
  return rows.map(r => ({ node: { name: r.node.id }, depth: r.depth, hasChildren: r.hasChildren, parentId: r.parentId }));
}

/**
 * 按父标签筛选时包含后代:返回该标签 + 它的所有子孙。
 * 没有 parents 时返回 [tag],即旧的精确匹配。
 */
export function tagWithDescendants(tag: string, parents: TagParents | null | undefined): string[] {
  if (!tag || !parents) return tag ? [tag] : [];
  const out = [tag];
  const seen = new Set(out);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [child, parent] of Object.entries(parents)) {
      if (!parent || seen.has(child) || !seen.has(parent)) continue;
      seen.add(child);
      out.push(child);
      grew = true;
    }
  }
  return out;
}

/** 父标签的祖先链(给「选中子标签时提示它在哪个父下」用)。无 parents → 空。 */
export function tagAncestors(tag: string, parents: TagParents | null | undefined): string[] {
  if (!parents) return [];
  const out: string[] = [];
  let cursor = parents[tag] ?? null;
  while (cursor && !out.includes(cursor) && out.length < 10) {
    out.push(cursor);
    cursor = parents[cursor] ?? null;
  }
  return out;
}
