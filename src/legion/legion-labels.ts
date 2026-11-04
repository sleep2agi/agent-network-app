// 2026-11-05: 从 Dashboard(`agent-network-dashboard/app/lib/`)原样搬入,为了把「军团 3D」视图接到客户端。
// 这四个模块是纯几何/投影函数(无 fetch、无 React),测试也一并搬入(src/legion/*.test.ts)。
// 搬迁原则:几何行为一字不改;要改先改测试并说明理由。
/** Screen-space labels: keep text inside the stage and off visible node bodies. */
export interface LabelRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface LabelEllipse {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

export function labelOverlapsBody(rect: LabelRect, body: LabelEllipse): boolean {
  const x = Math.max(rect.x1, Math.min(body.x, rect.x2));
  const y = Math.max(rect.y1, Math.min(body.y, rect.y2));
  return ((x - body.x) / body.rx) ** 2 + ((y - body.y) / body.ry) ** 2 <= 1;
}

export function placeLegionLabel({ anchor, width, height, bounds, occupied, bodies }: {
  anchor: LabelEllipse;
  width: number;
  height: number;
  bounds: LabelRect;
  occupied: LabelRect[];
  bodies: LabelEllipse[];
}): LabelRect | null {
  if (width <= 0 || height <= 0 || width > bounds.x2 - bounds.x1 || height > bounds.y2 - bounds.y1) return null;
  const dx = anchor.x - (bounds.x1 + bounds.x2) / 2;
  const dy = anchor.y - (bounds.y1 + bounds.y2) / 2;
  const angle = dx === 0 && dy === 0 ? Math.PI / 2 : Math.atan2(dy, dx);
  // Prefer the existing outward direction, then try nearby sides. Space which
  // cannot fit a readable label stays empty; the node and details remain usable.
  for (const extra of [0, 12, 28]) {
    for (const turn of [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI]) {
      const ux = Math.cos(angle + turn);
      const uy = Math.sin(angle + turn);
      const bodyExtent = Math.hypot(anchor.rx * ux, anchor.ry * uy);
      const textExtent = width / 2 * Math.abs(ux) + height / 2 * Math.abs(uy);
      const offset = bodyExtent + textExtent + 6 + extra;
      const cx = Math.max(bounds.x1 + width / 2, Math.min(bounds.x2 - width / 2, anchor.x + ux * offset));
      const cy = Math.max(bounds.y1 + height / 2, Math.min(bounds.y2 - height / 2, anchor.y + uy * offset));
      const rect = { x1: cx - width / 2, y1: cy - height / 2, x2: cx + width / 2, y2: cy + height / 2 };
      if (occupied.some(p => !(rect.x2 < p.x1 || rect.x1 > p.x2 || rect.y2 < p.y1 || rect.y1 > p.y2))) continue;
      if (bodies.some(body => labelOverlapsBody(rect, body))) continue;
      return rect;
    }
  }
  return null;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Wrap complete department names, including emoji clusters, without ellipsis. */
export function wrapLegionLabel(text: string, maxWidth: number, measure: (text: string) => number): string[] {
  if (!text || maxWidth <= 0) return [];
  if (measure(text) <= maxWidth) return [text];
  const lines: string[] = [];
  let line = '';
  for (const { segment } of graphemes.segment(text)) {
    if (line && measure(line + segment) > maxWidth) {
      lines.push(line);
      line = '';
    }
    line += segment;
  }
  if (line) lines.push(line);
  return lines;
}

function segmentHitsRect(from: { x: number; y: number }, to: { x: number; y: number }, rect: LabelRect) {
  let start = 0;
  let end = 1;
  for (const [origin, delta, min, max] of [[from.x, to.x - from.x, rect.x1, rect.x2], [from.y, to.y - from.y, rect.y1, rect.y2]]) {
    if (!delta) { if (origin < min || origin > max) return false; continue; }
    const a = (min - origin) / delta;
    const b = (max - origin) / delta;
    start = Math.max(start, Math.min(a, b));
    end = Math.min(end, Math.max(a, b));
    if (start > end) return false;
  }
  return true;
}

/** Only displaced labels need a short leader; omit it if the route is blocked. */
export function legionLabelLeader(anchor: LabelEllipse, rect: LabelRect, occupied: LabelRect[] = [], bodies: LabelEllipse[] = []) {
  const cx = (rect.x1 + rect.x2) / 2;
  const cy = (rect.y1 + rect.y2) / 2;
  const dx = cx - anchor.x;
  const dy = cy - anchor.y;
  if (!dx && !dy) return null;
  const bodyT = 1 / Math.hypot(dx / anchor.rx, dy / anchor.ry);
  const textT = Math.min(dx ? (rect.x2 - rect.x1) / 2 / Math.abs(dx) : Infinity, dy ? (rect.y2 - rect.y1) / 2 / Math.abs(dy) : Infinity);
  const from = { x: anchor.x + dx * bodyT, y: anchor.y + dy * bodyT };
  const to = { x: cx - dx * textT, y: cy - dy * textT };
  if (bodyT >= 1 - textT || Math.hypot(to.x - from.x, to.y - from.y) <= 12) return null;
  if (occupied.some(p => p !== rect && segmentHitsRect(from, to, p))) return null;
  if (bodies.some(body => {
    if (body === anchor) return false;
    const x = (from.x - body.x) / body.rx;
    const y = (from.y - body.y) / body.ry;
    const vx = (to.x - from.x) / body.rx;
    const vy = (to.y - from.y) / body.ry;
    const t = Math.max(0, Math.min(1, -(x * vx + y * vy) / (vx * vx + vy * vy)));
    return (x + t * vx) ** 2 + (y + t * vy) ** 2 <= 1;
  })) return null;
  return { from, to };
}
