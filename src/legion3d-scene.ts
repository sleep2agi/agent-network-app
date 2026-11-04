// 军团 3D —— 从「布局 + 相机」算出**可直接画的图元列表**(2026-11-05)。
//
// 为什么单独一层:几何算在 `src/legion/*`(从 Dashboard 原样搬入),真正画的时候
// 桌面(Tauri = WebView)要画 canvas、手机要画到 WebView 或 Skia。如果「怎么摆」散在
// 各个渲染器里,改一次投影就得改三处,而且各自都不一样。
//
// 这里只做一件事:把 LegionLayout + Camera 变成有序的图元数组
//   环(ring) → 体(body: 圆心/部门盘/人/Agent) → 标签(label)
// 顺序即绘制顺序(远的先画),深度由 `projectScene` 统一排序。
//
// 纯函数:没有 canvas、没有 React、没有 fetch,便于断言;
// 三端渲染器只负责把 SceneCommand 翻译成自己的绘制调用。

import {
  RING_HEIGHT,
  nodeToVec3,
  ringPath,
  projectScene,
  departmentDisc,
  type Camera3D,
} from './legion/legion-3d';
import type { LegionLayout, LegionNode, LegionNodeKind } from './legion/legion-layout';

export interface SceneSize { width: number; height: number }

export type RingCommand = {
  kind: 'ring';
  ring: 1 | 2 | 3;
  /** 屏幕坐标点(首尾同点,可直接 closePath)。 */
  points: Array<{ x: number; y: number }>;
  /** 环中心的相机深度,用于和体一起排序/雾化。 */
  depth: number;
};

export type BodyCommand = {
  kind: 'body';
  id: string;
  nodeKind: LegionNodeKind;
  x: number;
  y: number;
  rx: number;
  ry: number;
  depth: number;
  /** 透视缩放系数(1 = 与画布基准同大小)。 */
  scale: number;
  /** 折叠的部门要减淡。 */
  dimmed: boolean;
};

export type LabelCommand = {
  kind: 'label';
  id: string;
  text: string;
  x: number;
  y: number;
  depth: number;
  /** 距环中心越远越远(雾化/减淡用)。 */
  scale: number;
};

export type SceneCommand = RingCommand | BodyCommand | LabelCommand;

/** 体在屏幕上的基础半轴(像素)。数字来自 Dashboard 的视觉参数,别随手改。 */
const BODY_BASE: Record<LegionNodeKind, number> = {
  core: 26,
  group: 18,
  person: 13,
  agent: 9,
};

/** 环的分段数:96 段在 1440px 宽的画布上看不出折线,也不至于让命令数失控。 */
export const RING_SEGMENTS = 96;

/** 标签预算。超过这个数就只留最近的那批 —— 200+ 节点时全画会糊成一团。 */
export const LABEL_BUDGET = 60;

/** 判断一个节点要不要画标签:圆心/部门/人默认画,Agent 只在靠近相机时画(数量最多)。 */
export function wantsLabel(node: Pick<LegionNode, 'kind'>, scale: number): boolean {
  if (node.kind === 'agent') return scale >= 1.15;
  return true;
}

/**
 * 主入口:布局 + 相机 → 图元列表。
 * `size` 是画布像素尺寸;相机缺省值由调用方给(Dashboard 用 pitch≈0.45、dist≈6)。
 */
export function buildLegionScene(
  layout: LegionLayout,
  cam: Camera3D,
  size: SceneSize,
  opts: { labelBudget?: number; dimmedIds?: ReadonlySet<string> } = {},
): SceneCommand[] {
  const commands: SceneCommand[] = [];

  // 1) 参考环:每层一条(圆心没有环)。先画,永远在体的下面。
  const rings: RingCommand[] = [];
  for (const ring of [1, 2, 3] as const) {
    const points = ringPath(ringRadiusOf(layout, ring), RING_HEIGHT[ring], cam, size, RING_SEGMENTS)
      .map((p) => ({ x: p.x, y: p.y }));
    if (points.length < 2) continue;
    rings.push({
      kind: 'ring',
      ring,
      points,
      depth: ringDepth(ring, cam, size),
    });
  }
  // 环之间按深度从远到近画(远的先画,近的盖住远的)。
  rings.sort((a, b) => b.depth - a.depth);
  commands.push(...rings);

  // 2) 体:projectScene 已经按深度从远到近排好(深度大 = 远)。
  const projected = projectScene(
    layout.nodes,
    (node) => nodeToVec3(node),
    cam,
    size,
  );
  const bodies: BodyCommand[] = [];
  for (const entry of projected) {
    const node = entry.item;
    const { x, y, scale, depth } = entry.projected;
    const base = BODY_BASE[node.kind] ?? 10;
    const disc = node.kind === 'group' ? departmentDisc(base * scale) : null;
    bodies.push({
      kind: 'body',
      id: node.id,
      nodeKind: node.kind,
      x,
      y,
      rx: disc ? disc.rx : base * scale,
      ry: disc ? disc.ry : base * scale,
      depth,
      scale,
      dimmed: opts.dimmedIds?.has(node.id) ?? false,
    });
  }
  commands.push(...bodies);

  // 3) 标签:同样按深度排序,再按预算截断(保留最近的 = 深度最小的)。
  const budget = opts.labelBudget ?? LABEL_BUDGET;
  const labeled = bodies
    .filter((b) => wantsLabel({ kind: b.nodeKind }, b.scale))
    .slice()
    .sort((a, b) => a.depth - b.depth)
    .slice(0, Math.max(0, budget))
    .sort((a, b) => b.depth - a.depth);
  const byId = new Map(layout.nodes.map((n) => [n.id, n] as const));
  for (const body of labeled) {
    const node = byId.get(body.id);
    const text = (node?.label ?? '').trim();
    if (!text) continue;
    commands.push({
      kind: 'label',
      id: body.id,
      text,
      x: body.x,
      // 标签放在体的正下方:盘上写字会和节点圆重叠。
      y: body.y + body.ry + 4,
      depth: body.depth,
      scale: body.scale,
    });
  }

  return commands;
}

/** 该环在归一化坐标里的半径(布局给的是数据,布局没给就退回常量)。 */
function ringRadiusOf(layout: LegionLayout, ring: 1 | 2 | 3): number {
  const found = layout.rings.find((r) => r.ring === ring);
  return found ? found.radius : 1;
}

/** 环中心的深度:把环上一个点的高度投影出来当代表(环是水平圆,深度随 yaw 变化)。 */
function ringDepth(ring: 1 | 2 | 3, cam: Camera3D, size: SceneSize): number {
  const pts = ringPath(1, RING_HEIGHT[ring], cam, size, 8);
  if (!pts.length) return 0;
  return pts.reduce((sum, p) => sum + p.depth, 0) / pts.length;
}

/** 便于测试/渲染端统计:一张图里各类型图元各有多少个。 */
export function sceneCounts(commands: readonly SceneCommand[]): { rings: number; bodies: number; labels: number } {
  let rings = 0;
  let bodies = 0;
  let labels = 0;
  for (const c of commands) {
    if (c.kind === 'ring') rings += 1;
    else if (c.kind === 'body') bodies += 1;
    else labels += 1;
  }
  return { rings, bodies, labels };
}
