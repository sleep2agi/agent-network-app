// 军团图「只看某个部门」(2026-11-05)。
//
// 全图适合看体量,聚焦适合看编制 —— 12 个部门 200+ 节点时,想确认「平台部下面都有谁」
// 只能靠眼睛在圆上找。这里把「聚焦」收敛成一个纯函数:
//   · 保留圆心 + 该部门(或人/Agent)本身 + 它在树里的**所有下级**;
//   · 其余节点连同它们的边一起裁掉(边按两端是否存在裁剪,不留半截线);
//   · 聚焦不存在的 id ⇒ 原样返回(不猜、不清空)。
//
// 纯函数:只做集合运算,不碰坐标。折叠状态、扇区角度沿用原布局,避免重排造成「换个人就变样」。

import type { LegionLayout, LegionNode } from './legion-layout';

/** 该 id 的自己 + 所有下级布局节点 id。 */
export function subtreeIds(nodes: readonly LegionNode[], rootId: string): Set<string> {
  const byParent = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    const arr = byParent.get(n.parentId);
    if (arr) arr.push(n.id);
    else byParent.set(n.parentId, [n.id]);
  }
  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop() as string;
    if (out.has(id)) continue;
    out.add(id);
    for (const child of byParent.get(id) ?? []) stack.push(child);
  }
  return out;
}

/**
 * 聚焦到某个节点(通常是部门)。找不到该 id ⇒ 原样返回。
 * 圆心始终保留:没有它这张图就没有「军团」的锚点。
 */
export function focusLayout(layout: LegionLayout, rootId: string | null | undefined): LegionLayout {
  const id = (rootId ?? '').trim();
  if (!id) return layout;
  if (!layout.nodes.some((n) => n.id === id)) return layout;
  const keep = subtreeIds(layout.nodes, id);
  const nodes = layout.nodes.filter((n) => n.kind === 'core' || keep.has(n.id));
  const edges = layout.edges.filter((e) => keep.has(e.from) && keep.has(e.to));
  return { ...layout, nodes, edges };
}

/** 聚焦时给一行「现在看的是谁」:布局里取名字,取不到就给 id 后半截。 */
export function focusLabel(layout: LegionLayout | null | undefined, rootId: string | null | undefined): string | null {
  const id = (rootId ?? '').trim();
  if (!id) return null;
  const node = layout?.nodes.find((n) => n.id === id);
  if (node) return node.label;
  const raw = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id;
  return raw || null;
}
