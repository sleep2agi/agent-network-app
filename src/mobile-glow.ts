// 手机整窗渐变的几何（admin 2026-11-20：手机要和桌面同一个暖桃/淡紫蓝渐变）。
//
// 桌面是 CSS 两层 radial-gradient（chat-glow-gradient.ts）：
//   暖桃  ellipse 75% 80% at 8% 10% 与 94% 92%（深色 60% 65%）。
// 2026-11-20 admin 改主意：右下角那块冷蓝去掉，两角统一暖黄（PR #1577 桌面已改），手机同步。
// 原生没有 radial-gradient（仓库也没有 svg/gradient 依赖），所以用两张预生成的 PNG
// （assets/glow-warm-*.png / glow-cool-*.png，颜色与 alpha 都照 GLOW_*/ALPHA 烘焙）。
//
// 这个模块只算「两张图放在哪、多大」，纯函数（不 import react-native），方便单测：
//   · 半径按窗口宽/高各自的百分比算（与桌面 CSS 的 ellipse 同口径）；
//   · 锚点按百分比（8%/10%、94%/92%），和桌面同一个构图。
export type GlowMode = 'light' | 'dark';

/** 与 chat-glow-gradient.ts 的 EXTENT 对齐（radial 的椭圆半径，占元素宽/高的比例）。 */
const EXTENT = { light: { x: 0.75, y: 0.80 }, dark: { x: 0.60, y: 0.65 } } as const;
/** 与 CSS 的 at 8% 10% / at 94% 92% 对齐。 */
const ANCHOR = { topLeft: { x: 0.08, y: 0.10 }, bottomRight: { x: 0.94, y: 0.92 } } as const;

export interface GlowBox { left: number; top: number; width: number; height: number }
export interface GlowLayout { topLeft: GlowBox; bottomRight: GlowBox }

// 2026-11-20 admin 折叠屏实测：按「短边」算会在宽窗里只盖住左边，右边是纯底色，
// 两栏之间一条硬接缝（「一半有一半没有」）。改成和桌面 CSS 同一口径：半径按窗口
// **宽/高各自**的百分比算（ellipse 75% 80% at 8% 10%），宽窗里光晕跟着变宽，连续。
const box = (anchor: { x: number; y: number }, extent: { x: number; y: number }, w: number, h: number): GlowBox => {
  const width = w * 2 * extent.x;
  const height = h * 2 * extent.y;
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
 * @param unit   已废弃（保留参数只为兼容旧调用/测试）；宽高各自缩放，不再有统一 base
 */
export function mobileGlowLayout(width: number, height: number, mode: GlowMode, _unit?: number): GlowLayout {
  const w = Math.max(1, width || 1);
  const h = Math.max(1, height || 1);
  const extent = EXTENT[mode];
  return {
    topLeft: box(ANCHOR.topLeft, extent, w, h),
    bottomRight: box(ANCHOR.bottomRight, extent, w, h),
  };
}
