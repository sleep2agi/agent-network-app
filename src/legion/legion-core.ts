// 2026-11-05: 从 Dashboard(`agent-network-dashboard/app/lib/`)原样搬入,为了把「军团 3D」视图接到客户端。
// 这四个模块是纯几何/投影函数(无 fetch、无 React),测试也一并搬入(src/legion/*.test.ts)。
// 搬迁原则:几何行为一字不改;要改先改测试并说明理由。
/**
 * ANet core medallion using the client's canonical one-stroke AN mark.
 * See public/brand/README.md for immutable source and asset hashes. The image
 * stays upright and aspect-correct; only the surrounding network rings move.
 */
type CorePalette = { bg: string; accent: string; accentFg: string; isDark: boolean };

const marks = new Map<string, HTMLImageElement>();

export function drawLegionCore(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number,
  palette: CorePalette, phase: number, detailed: boolean) {
  // Lazy: this module is also evaluated by Next's server renderer. All images
  // are bundled same-origin, keeping PNG export's canvas untainted.
  const src = `/brand/mark-${radius * 1.25 <= 32 ? 'small-' : ''}${palette.isDark ? 'dark' : 'light'}.png`;
  let mark = marks.get(src);
  if (!mark) {
    mark = new Image();
    mark.src = src;
    marks.set(src, mark);
  }
  const alpha = ctx.globalAlpha;
  ctx.save();
  // Opaque housing keeps network links behind the logo.
  ctx.fillStyle = palette.bg;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = Math.min(2, Math.max(1.4, radius * 0.045));
  ctx.stroke();

  if (detailed && radius >= 14) {
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const start = phase + i * Math.PI * 2 / 3;
      ctx.globalAlpha = alpha * 0.65;
      ctx.beginPath();
      ctx.arc(x, y, radius * 0.87, start, start + Math.PI * 0.42);
      ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = palette.accent;
      ctx.beginPath();
      ctx.arc(x + Math.cos(start) * radius * 0.87, y + Math.sin(start) * radius * 0.87,
        Math.min(2.2, radius * 0.055), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.globalAlpha = alpha;
  if (mark.complete && mark.naturalWidth > 0) {
    const scale = radius * 1.25 / Math.max(mark.naturalWidth, mark.naturalHeight);
    const width = mark.naturalWidth * scale, height = mark.naturalHeight * scale;
    ctx.drawImage(mark, x - width / 2, y - height / 2, width, height);
  } else {
    // Keep a recognizable label while decoding, or if an asset cannot load.
    ctx.fillStyle = palette.accent;
    ctx.font = `600 ${Math.max(8, radius * 0.36)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ANet', x, y);
  }
  ctx.restore();
}
