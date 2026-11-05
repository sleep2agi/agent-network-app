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

/**
 * 聚焦面包屑(2026-11-05):军团 → … → 当前聚焦节点。
 *
 * 聚焦到「平台部/前端组」这种二级部门时,原来的「看全图」只有一个出口 ——
 * 想退到上一级(平台部整体)得先看全图再点进去。这里把祖先链摊平,让每一级都能直接点。
 * 第一项固定是 { id: null }(军团 = 全图),最后一项是当前聚焦节点。
 * 找不到该 id ⇒ 只返回军团那一项,不猜。
 */
export function focusTrail(
  layout: LegionLayout | null | undefined,
  rootId: string | null | undefined,
): Array<{ id: string | null; label: string }> {
  const head = { id: null as string | null, label: '军团' };
  const id = (rootId ?? '').trim();
  if (!layout || !id) return [head];
  const byId = new Map(layout.nodes.map((n) => [n.id, n] as const));
  if (!byId.has(id)) return [head];
  const chain: Array<{ id: string | null; label: string }> = [];
  const seen = new Set<string>();
  let cur = byId.get(id);
  while (cur && cur.kind !== 'core' && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.push({ id: cur.id, label: cur.label });
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return [head, ...chain.reverse()];
}

/**
 * 聚焦 + 轮廓(2026-11-05,0.2.456):范围外的**部门**不删,而是变暗留在图上。
 *
 * 只看一个部门时,如果整张图只剩它自己,用户会失去「军团有多大」的参照 ——
 * 也没法判断自己看的是不是那块该看的。这里保留范围外的 group 节点(人和 Agent 仍裁掉,
 * 否则还是满屏),由调用方把这些 id 传给 buildLegionScene 的 dimmedIds 画成暗色。
 * 边只保留范围内的(暗部门之间的连线没有信息量,反而挡住视线)。
 */
export function focusOutline(
  layout: LegionLayout,
  rootId: string | null | undefined,
): { layout: LegionLayout; dimmedIds: Set<string> } {
  const id = (rootId ?? '').trim();
  if (!id || !layout.nodes.some((n) => n.id === id)) {
    return { layout, dimmedIds: new Set() };
  }
  const keep = subtreeIds(layout.nodes, id);
  const outsideGroups = layout.nodes.filter((n) => n.kind === 'group' && !keep.has(n.id));
  const dimmedIds = new Set(outsideGroups.map((n) => n.id));
  const base = focusLayout(layout, id);
  return {
    layout: { ...base, nodes: [...base.nodes, ...outsideGroups] },
    dimmedIds,
  };
}

/**
 * 点中一个节点后的动作(2026-11-05,0.2.457)。
 *
 * 0.2.456 起范围外部门以暗色轮廓留在图上 —— 那时点它只会「选中」，用户还得再点一次
 * 「只看这个部门」。既然暗色部门的唯一用途就是「看那块」，点一下就应该直接聚焦过去。
 * 纯函数，视图只按返回值决定「focus 到谁 / 选中谁」：
 *   · 点中暗色部门 ⇒ 聚焦到它，并选中它(焦点与选中一致,面包屑才对得上)
 *   · 其他任何情况(点到范围内节点 / 点空白) ⇒ 只改选中,不动聚焦
 */
export function tapOutcome(
  hitId: string | null | undefined,
  dimmedIds: ReadonlySet<string> | null | undefined,
): { focusId: string | null | undefined; selectedId: string | null } {
  const id = (hitId ?? '').trim();
  if (!id) return { focusId: undefined, selectedId: null };
  if (dimmedIds?.has(id)) return { focusId: id, selectedId: id };
  return { focusId: undefined, selectedId: id };
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

/**
 * 聚焦范围内的名单规模(2026-11-05)。
 * 汇总行在全图时给「军团总共多少人」,聚焦时该给**这个部门**多少人 —— 否则用户会以为
 * 聚焦没生效(数字没变)。只数人/Agent,部门数按子树里 kind='group' 的节点数算。
 */
export function focusStats(
  layout: LegionLayout,
  rootId: string | null | undefined,
): { people: number; agents: number; groups: number } {
  const id = (rootId ?? '').trim();
  if (!id || !layout.nodes.some((n) => n.id === id)) {
    return { people: layout.stats.people, agents: layout.stats.agents, groups: layout.stats.groups };
  }
  const keep = subtreeIds(layout.nodes, id);
  let people = 0;
  let agents = 0;
  let groups = 0;
  for (const node of layout.nodes) {
    if (!keep.has(node.id)) continue;
    if (node.kind === 'person') people += 1;
    else if (node.kind === 'agent') agents += 1;
    else if (node.kind === 'group') groups += 1;
  }
  return { people, agents, groups };
}

/**
 * 汇总行文案(2026-11-05,0.2.458)。
 *
 * 0.2.456/457 让聚焦时留着暗色部门、能点进去 —— 但汇总行只有「聚焦 X：N 人」，
 * 用户看不出**这块占军团多少**。这里把全量口径一起给出来：
 *   全图   → 「210 人 · 88 个 Agent · 12 个部门」
 *   聚焦中 → 「聚焦 平台部：37 人 · 12 个 Agent · 5 个部门（军团共 210 人）」
 * 纯函数,只在 numbers 上做字符串,便于钉断言。
 */
export function focusStatsLine(
  layout: LegionLayout | null | undefined,
  rootId: string | null | undefined,
): string {
  if (!layout) return '';
  const stats = focusStats(layout, rootId);
  const id = (rootId ?? '').trim();
  const focused = Boolean(id) && layout.nodes.some((n) => n.id === id);
  const head = `${stats.people} 人 · ${stats.agents} 个 Agent · ${stats.groups} 个部门`;
  if (!focused) return head;
  const label = focusLabel(layout, id) ?? id;
  const total = layout.stats.people;
  // 全量比聚焦范围小是不可能的(数据异常时也不给人更小的「共」),这种情况就不加后缀。
  const tail = total > stats.people ? `（军团共 ${total} 人）` : '';
  return `聚焦 ${label}：${head}${tail}`;
}

/**
 * 暗色轮廓的可点提示(2026-11-05,0.2.459)。
 *
 * 0.2.457 让点暗色部门能直接切过去 —— 但没有任何视觉/文案提示，用户不知道「可以点」。
 * 这里给一句极短的说明,只在**确实有暗色部门**时出现：
 *   有空位 → 「点暗色部门可直接切过去（3 个）」
 *   没聚焦/没有暗色部门 → null（不占一行）
 */
export function focusHint(dimmedCount: number, focusId: string | null | undefined): string | null {
  const focused = Boolean((focusId ?? '').trim());
  if (!focused || dimmedCount <= 0) return null;
  return `点暗色部门可直接切过去（${dimmedCount} 个）`;
}
