// 任务页的下拉选择(TaskSelectMenu)、母任务候选、桌面多选 —— 纯逻辑,不 import react-native。
import type { ReactNode } from 'react';
import type { Requirement } from './requirements-model';

export type SelectOption = {
  /** '' = 「无」。 */
  id: string;
  label: string;
  /** 第二行小字(母任务:它自己的母任务 / 状态)。 */
  sub?: string;
  color?: string | null;
  lead?: ReactNode;
  disabled?: boolean;
  /** 搜索时额外匹配的文字(不显示)。 */
  keywords?: string;
};

export type SelectAnchor = { x: number; y: number; w: number; h: number };

/** 搜索:不分大小写,标题 / 小字 / 关键字里含查询串即可;「无」一直留在最上面。 */
export function filterSelectOptions(options: readonly SelectOption[], query: string): SelectOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...options];
  return options.filter(o => !o.id || `${o.label}\n${o.sub ?? ''}\n${o.keywords ?? ''}`.toLowerCase().includes(q));
}

/**
 * 浮层放在按钮下面,左边对齐,宽 = max(按钮宽, 240)、不超过 maxWidth(默认 360);下面放不下而上面地方更大就翻到上面。
 * 夹进窗口(两边留 8)。高度按选项数算,最多 320。
 */
export function anchorSelectMenu(a: SelectAnchor, viewport: { width: number; height: number }, m: { rows: number; rowH: number; search: boolean; maxWidth?: number }): { left: number; top: number; width: number; maxHeight: number } {
  const margin = 8;
  const width = Math.min(Math.max(a.w, 240), m.maxWidth ?? 360, viewport.width - margin * 2);
  const left = Math.max(margin, Math.min(a.x, viewport.width - width - margin));
  const want = Math.min(320, 12 + (m.search ? 38 : 0) + m.rows * m.rowH);
  const below = viewport.height - (a.y + a.h + 4) - margin;
  const above = a.y - 4 - margin;
  if (below >= want || below >= above) return { left, top: a.y + a.h + 4, width, maxHeight: Math.max(120, Math.min(want, below)) };
  const h = Math.min(want, above);
  return { left, top: a.y - 4 - h, width, maxHeight: h };
}

/** 这张卡的全部后代(按 parentId 往下走;防环)。 */
export function descendantIds(items: readonly Requirement[], id: string): Set<string> {
  const out = new Set<string>();
  const byParent = new Map<string, string[]>();
  for (const i of items) if (i.parentId) byParent.set(i.parentId, [...(byParent.get(i.parentId) ?? []), i.id]);
  const stack = [...(byParent.get(id) ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    if (out.has(cur) || cur === id) continue;
    out.add(cur);
    stack.push(...(byParent.get(cur) ?? []));
  }
  return out;
}

/** 这张卡在第几层(顶层 = 1)。 */
function depthOf(items: readonly Requirement[], item: Requirement): number {
  let d = 1;
  const seen = new Set<string>([item.id]);
  let cur = item.parentId ? items.find(i => i.id === item.parentId) : undefined;
  while (cur && !seen.has(cur.id)) { seen.add(cur.id); d += 1; cur = cur.parentId ? items.find(i => i.id === cur!.parentId) : undefined; }
  return d;
}

/** 以这张卡为根的子树有几层(只有它自己 = 1)。 */
function subtreeHeight(items: readonly Requirement[], id: string, seen = new Set<string>()): number {
  if (seen.has(id)) return 0;
  seen.add(id);
  let h = 0;
  for (const k of items) if (k.parentId === id) h = Math.max(h, subtreeHeight(items, k.id, seen));
  return 1 + h;
}

export const MAX_TASK_DEPTH = 5;

/**
 * 母任务候选:同一个列表里除了它自己和它的后代(挂上去会成环)以外的任务。
 * 挂上去会超过 5 层的(候选自己的层数 + 这棵子树的层数 > 5)标成不可选 —— Hub 也会拒(parent_too_deep),
 * 先在这里说清楚。已归档的不在列表里(列表本来就不含归档)。
 */
export function parentCandidates(items: readonly Requirement[], item: Requirement): { task: Requirement; tooDeep: boolean }[] {
  const banned = descendantIds(items, item.id);
  banned.add(item.id);
  const height = subtreeHeight(items, item.id);
  return items
    .filter(i => !banned.has(i.id))
    .map(task => ({ task, tooDeep: depthOf(items, task) + height > MAX_TASK_DEPTH }));
}

// ── 桌面多选 ───────────────────────────────────────────────────────────
// 单击 = 打开详情(不变);Ctrl/⌘ 单击 = 加入 / 移出选择;Shift 单击 = 从上次点的那张到这张(按当前显示顺序)
// 整段加进来。选了东西以后,底部出现操作条。

export type Selection = { ids: readonly string[]; anchor: string | null };
export const NO_SELECTION: Selection = { ids: [], anchor: null };

export type ClickMods = { toggle: boolean; range: boolean };

/** 这次点击是不是「选择」而不是「打开」。 */
export const isSelectClick = (m: ClickMods): boolean => m.toggle || m.range;

export function selectClick(sel: Selection, id: string, m: ClickMods, order: readonly string[]): Selection {
  if (m.range && sel.anchor && order.includes(sel.anchor) && order.includes(id)) {
    const a = order.indexOf(sel.anchor);
    const b = order.indexOf(id);
    const span = order.slice(Math.min(a, b), Math.max(a, b) + 1);
    const ids = [...sel.ids];
    for (const x of span) if (!ids.includes(x)) ids.push(x);
    return { ids, anchor: sel.anchor };
  }
  const on = sel.ids.includes(id);
  return { ids: on ? sel.ids.filter(x => x !== id) : [...sel.ids, id], anchor: id };
}

/** 列表视图里行首的勾选框:只切换这一行。 */
export const toggleSelected = (sel: Selection, id: string): Selection => selectClick(sel, id, { toggle: true, range: false }, []);

/** 数据刷新后,已经不在列表里的选项要去掉(别人删了 / 换了网络)。 */
export function pruneSelection(sel: Selection, present: readonly string[]): Selection {
  const ids = sel.ids.filter(id => present.includes(id));
  return ids.length === sel.ids.length ? sel : { ids, anchor: sel.anchor && present.includes(sel.anchor) ? sel.anchor : null };
}

/** 批量改的进度:几张做完、几张失败(失败的带原因,方便重试)。 */
export type BulkProgress = { total: number; done: number; failed: { id: string; name: string; message: string }[]; running: boolean };

/**
 * 一张一张改(和单张修改同一个 PATCH;不并发,免得几十个请求同时打到 Hub、也好报进度)。
 * apply 抛错 = 这张没改成,记下原因接着改下一张;不因为一张失败停下。
 */
export async function runBulk(
  targets: readonly { id: string; name: string }[],
  apply: (id: string) => Promise<void>,
  onProgress: (p: BulkProgress) => void,
): Promise<BulkProgress> {
  let p: BulkProgress = { total: targets.length, done: 0, failed: [], running: true };
  onProgress(p);
  for (const t of targets) {
    try {
      await apply(t.id);
      p = { ...p, done: p.done + 1 };
    } catch (e) {
      p = { ...p, done: p.done + 1, failed: [...p.failed, { id: t.id, name: t.name, message: e instanceof Error ? e.message : String(e) }] };
    }
    onProgress(p);
  }
  p = { ...p, running: false };
  onProgress(p);
  return p;
}

/** 日历面板放哪:下面 → 上面 → 字段左边(上下都放不下时)→ 夹进窗口。纯函数,测试直接调。 */
export function duePanelPlacement(anchor: { x: number; y: number; w: number; h: number } | null, win: { width: number; height: number }, panel: { width: number; height: number }): { left: number; top: number; side: 'below' | 'above' | 'left' | 'center' } {
  if (!anchor) return { left: (win.width - panel.width) / 2, top: (win.height - panel.height) / 2, side: 'center' };
  const alignedLeft = Math.max(8, Math.min(anchor.x, win.width - panel.width - 8));
  const below = anchor.y + anchor.h + 6;
  if (below + panel.height <= win.height - 8) return { left: alignedLeft, top: below, side: 'below' };
  const above = anchor.y - panel.height - 6;
  if (above >= 8) return { left: alignedLeft, top: above, side: 'above' };
  if (anchor.x - panel.width - 8 >= 8) {
    const mid = anchor.y + anchor.h / 2 - panel.height / 2;
    return { left: anchor.x - panel.width - 8, top: Math.max(8, Math.min(mid, win.height - panel.height - 8)), side: 'left' };
  }
  return { left: alignedLeft, top: Math.max(8, above), side: 'above' };
}
