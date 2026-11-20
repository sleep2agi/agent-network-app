// 手机整窗渐变的几何（admin 2026-11-20：手机要和桌面同一个暖桃/淡紫蓝渐变）。
//
// 桌面是 CSS 两层 radial-gradient（chat-glow-gradient.ts）：
//   暖桃  ellipse 75% 80% at 8% 10% 与 94% 92%（深色 60% 65%）。
// 2026-11-20 admin 改主意：右下角那块冷蓝去掉，两角统一暖黄（PR #1577 桌面已改），手机同步。
// 原生没有 radial-gradient（仓库也没有 svg/gradient 依赖），所以用两张预生成的 PNG
// （assets/glow-warm-*.png / glow-cool-*.png，颜色与 alpha 都照 GLOW_*/ALPHA 烘焙）。
//
// 这个模块只算「两张图放在哪、多大」，纯函数（不 import react-native），方便单测：
//   · 尺寸按窗口短边算，折叠屏展开/分屏时不会把光晕拉成一整团；
//   · 锚点仍按百分比（8%/10%、94%/92%），和桌面同一个构图。
export type GlowMode = 'light' | 'dark';

/** 与 chat-glow-gradient.ts 的 EXTENT 对齐（radial 的椭圆半径，占元素宽/高的比例）。 */
const EXTENT = { light: { x: 0.75, y: 0.80 }, dark: { x: 0.60, y: 0.65 } } as const;
/** 与 CSS 的 at 8% 10% / at 94% 92% 对齐。 */
const ANCHOR = { topLeft: { x: 0.08, y: 0.10 }, bottomRight: { x: 0.94, y: 0.92 } } as const;

export interface GlowBox { left: number; top: number; width: number; height: number }
export interface GlowLayout { topLeft: GlowBox; bottomRight: GlowBox }

const box = (anchor: { x: number; y: number }, extent: { x: number; y: number }, w: number, h: number, unit: number): GlowBox => {
  const width = unit * 2 * extent.x;
  const height = unit * 2 * extent.y;
  return {
    width,
    height,
    left: anchor.x * w - width / 2,
    top: anchor.y * h - height / 2,
  };
};

/**
 * 两张光晕的位置与大小。
 * @param width  窗口宽（dp）
 * @param height 窗口高（dp）
 * @param mode   浅色/深色（决定半径与层级，图本身也分浅深两张）
 * @param unit   光晕基准尺寸；默认取短边，让折叠屏展开/分屏时保持同一个观感
 */
export function mobileGlowLayout(width: number, height: number, mode: GlowMode, unit?: number): GlowLayout {
  const w = Math.max(1, width || 1);
  const h = Math.max(1, height || 1);
  const base = unit && unit > 0 ? unit : Math.min(w, h);
  const extent = EXTENT[mode];
  return {
    topLeft: box(ANCHOR.topLeft, extent, w, h, base),
    bottomRight: box(ANCHOR.bottomRight, extent, w, h, base),
  };
}
