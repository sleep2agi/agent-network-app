// 「活的组织图」的纯函数（admin 2026-11-19「这个组织架构还没改版上线」）。不引 react-native，单测直接跑。
//
// 画法：当前层级的每个部门是一团簇（面积 ∝ 人数），agent 是簇里的点（在跑亮、离线暗）；
// 最近 windowMs 内谁给谁派活，就在两团簇之间画一条线，粗细按次数。from 不是图上的 agent（scheduler、人、
// 外部）一律从中心「核心」出发 —— 与 Dashboard 3D 版同一套规则（hub docs/design/org-flow-edges.md）：
//   方向 from→to；按 created_at 落窗；每条任务算一次；同一对只画一条；自环不画；to 不在图上丢弃。
// 部门色相 hue(i, N) = 190 → 275（青蓝到蓝紫），按部门排序后的下标给，改名不换色。

export type LiveDept = { id: string; name: string; parent_id: string | null; sort?: number };
export type LiveAgent = { alias: string; departmentId: string | null; online: boolean };
export type LiveTask = { from_name?: string | null; to_name?: string | null; created_at?: string | null };

export const UNASSIGNED = '__unassigned__';
export const CORE = '__core__';

export type Cluster = { id: string; name: string; hue: number; x: number; y: number; r: number; agents: LiveAgent[]; online: number; hasChildren: boolean };
export type Edge = { from: string; to: string; count: number };

export function deptHue(index: number, total: number): number {
  return total > 1 ? Math.round(190 + (index / (total - 1)) * 85) : 190;
}

/** 部门按 sort、再按 id 排出稳定下标（色相用）；未归属固定灰。 */
export function hueTable(depts: readonly LiveDept[]): Map<string, number> {
  const ordered = [...depts].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.id.localeCompare(b.id));
  const m = new Map<string, number>();
  ordered.forEach((d, i) => m.set(d.id, deptHue(i, ordered.length)));
  return m;
}

/** agent 所在部门在 root 这一层下面属于哪一个子部门（root=null 即顶层部门）；不在 root 子树里返回 null。 */
export function bucketOf(deptId: string | null, root: string | null, byId: ReadonlyMap<string, LiveDept>): string | null {
  if (!deptId || !byId.has(deptId)) return root === null ? UNASSIGNED : null;
  let cur: LiveDept | undefined = byId.get(deptId);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.parent_id === root) return cur.id;
    if (cur.id === root) return `${root}::direct`;
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return null;
}

/** 把簇摆在 width×height 里：按人数从大到小沿螺线放，碰撞就往外挪；结果再整体缩放进画布。 */
export function packClusters(sizes: readonly { id: string; r: number }[], width: number, height: number, pad = 64): Map<string, { x: number; y: number; r: number }> {
  const placed: { id: string; x: number; y: number; r: number }[] = [];
  const order = [...sizes].sort((a, b) => b.r - a.r);
  for (const s of order) {
    if (!placed.length) { placed.push({ ...s, x: 0, y: 0 }); continue; }
    let done = false;
    for (let t = 0; t < 4000 && !done; t++) {
      const ang = t * 0.35; const dist = 4 + t * 1.6;
      const x = Math.cos(ang) * dist * 1.35; const y = Math.sin(ang) * dist;
      if (placed.every(p => Math.hypot(p.x - x, p.y - y) >= p.r + s.r + pad)) { placed.push({ ...s, x, y }); done = true; }
    }
    if (!done) placed.push({ ...s, x: placed.length * 10, y: 0 });
  }
  const out = new Map<string, { x: number; y: number; r: number }>();
  if (!placed.length) return out;
  const minX = Math.min(...placed.map(p => p.x - p.r)), maxX = Math.max(...placed.map(p => p.x + p.r));
  const minY = Math.min(...placed.map(p => p.y - p.r - 6)), maxY = Math.max(...placed.map(p => p.y + p.r + 40)); // 下方留标签位
  const k = Math.min(2.2, (width - 40) / Math.max(1, maxX - minX), (height - 40) / Math.max(1, maxY - minY));
  const ox = (width - (maxX - minX) * k) / 2 - minX * k, oy = (height - (maxY - minY) * k) / 2 - minY * k;
  for (const p of placed) out.set(p.id, { x: p.x * k + ox, y: p.y * k + oy, r: p.r * k });
  return out;
}

export function buildClusters(depts: readonly LiveDept[], agents: readonly LiveAgent[], root: string | null, width: number, height: number, labels: { unassigned: string; direct: string }): Cluster[] {
  const byId = new Map(depts.map(d => [d.id, d]));
  const hues = hueTable(depts);
  const groups = new Map<string, LiveAgent[]>();
  for (const a of agents) {
    const b = bucketOf(a.departmentId, root, byId);
    if (b === null) continue;
    (groups.get(b) ?? groups.set(b, []).get(b)!).push(a);
  }
  // 当前层级下没有人的子部门也画一个小簇，别让结构凭空消失。
  for (const d of depts) if (d.parent_id === root && !groups.has(d.id)) groups.set(d.id, []);
  const sizes = [...groups.entries()].map(([id, list]) => ({ id, r: 22 + Math.sqrt(Math.max(1, list.length)) * 11 }));
  const pos = packClusters(sizes, width, height);
  return [...groups.entries()].map(([id, list]) => {
    const p = pos.get(id)!;
    const dept = byId.get(id.replace(/::direct$/, ''));
    const name = id === UNASSIGNED ? labels.unassigned : id.endsWith('::direct') ? `${dept?.name ?? ''} · ${labels.direct}` : dept?.name ?? id;
    const hue = id === UNASSIGNED ? -1 : hues.get(id.replace(/::direct$/, '')) ?? 190;
    return { id, name, hue, x: p.x, y: p.y, r: p.r, agents: list, online: list.filter(a => a.online).length, hasChildren: !!dept && !id.endsWith('::direct') && depts.some(d => d.parent_id === dept.id) };
  });
}

/** 近 windowMs 的派活按「簇 → 簇」聚合；from 不在图上 → CORE。返回边和是否可能不全（任务正好取满 limit 且最老一条仍在窗内）。 */
export function buildEdges(tasks: readonly LiveTask[], clusters: readonly Cluster[], now: number, windowMs: number, limit: number): { edges: Edge[]; total: number; truncated: boolean } {
  const where = new Map<string, string>();
  for (const c of clusters) for (const a of c.agents) where.set(a.alias, c.id);
  const counts = new Map<string, number>();
  let total = 0; let oldestInWindow = true;
  for (const t of tasks) {
    const at = t.created_at ? Date.parse(t.created_at) : NaN;
    if (!Number.isFinite(at)) continue;
    if (now - at > windowMs) { oldestInWindow = false; continue; }
    const to = t.to_name ? where.get(t.to_name) : undefined;
    if (!to) continue;
    const from = (t.from_name && where.get(t.from_name)) || CORE;
    if (from === to) { total++; continue; }
    total++;
    const k = `${from}\u0000${to}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const edges = [...counts.entries()].map(([k, count]) => { const [from, to] = k.split('\u0000'); return { from, to, count }; })
    .sort((a, b) => b.count - a.count);
  return { edges, total, truncated: tasks.length >= limit && oldestInWindow };
}

/** 簇里的点：向日葵排布，在线的排在内圈。 */
/** 「核心」点放在不压任何簇的空地上：从画布中心沿螺线往外找，离每个簇边缘至少 gap。 */
export function corePosition(clusters: readonly { x: number; y: number; r: number }[], width: number, height: number, gap = 28): { x: number; y: number } {
  const cx = width / 2, cy = height / 2;
  for (let t = 0; t < 3000; t++) {
    const a = t * 0.4, d = t * 1.2;
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.7;
    if (x < 24 || y < 24 || x > width - 24 || y > height - 24) continue;
    // 也别落在簇下方的名字 / 人数标签上（标签约宽 140、高 45）。
    const onLabel = (c: { x: number; y: number; r: number }) => Math.abs(x - c.x) < 90 && y > c.y + c.r - 4 && y < c.y + c.r + 70;
    if (clusters.every(c => Math.hypot(c.x - x, c.y - y) >= c.r + gap && !onLabel(c))) return { x, y };
  }
  return { x: cx, y: 24 };
}

/** 线从簇的边上出发、到边上结束（不穿过里面的点）。 */
export function edgeEnds(a: { x: number; y: number; r?: number }, b: { x: number; y: number; r?: number }): { x1: number; y1: number; x2: number; y2: number } {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len, ra = (a.r ?? 0) + 3, rb = (b.r ?? 0) + 3;
  return { x1: a.x + ux * ra, y1: a.y + uy * ra, x2: b.x - ux * rb, y2: b.y - uy * rb };
}

/** 点的大小跟着簇走：簇放大了点也跟着大，别让大圈里稀稀拉拉几粒芝麻。 */
export function dotRadius(clusterR: number, online: boolean): number {
  const base = Math.max(3.6, Math.min(7.5, clusterR * 0.055));
  return online ? base : base * 0.8;
}

export function dotPositions(n: number, r: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const inner = Math.max(4, r * 0.78);
  for (let i = 0; i < n; i++) {
    const rr = Math.sqrt((i + 0.5) / n) * inner; const a = i * 2.39996;
    out.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr });
  }
  return out;
}

// ── 原生（安卓/折叠屏）版共用的小几何：颜色与呼吸 ────────────────────────────
// 与桌面 LiveOrgMap 的 tint/动效口径一致；放在纯函数文件里方便单测（不引 react-native）。

/** 部门色簇：hue → 深浅各一档颜色；hue < 0（未归属）用灰色。 */
export function clusterTintHex(hue: number, dark: boolean, lift = 0): string {
  if (hue < 0) return '#8b8b95';
  return dark ? `hsl(${hue} 88% ${Math.min(92, 64 + lift)}%)` : `hsl(${hue} 62% ${Math.min(78, 50 + lift)}%)`;
}

/** 呼吸：有 agent 在跑的簇才动，3 秒一轮，半径最多 ±2%。phase ∈ [0,1)。 */
export function breathRadius(r: number, phase: number): number {
  return r * (1 + 0.02 * Math.sin(phase * Math.PI * 2));
}
