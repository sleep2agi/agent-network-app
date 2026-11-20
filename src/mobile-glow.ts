// 手机/折叠屏整窗渐变（admin 2026-11-20：要和桌面同一套暖色渐变，且**整窗连续**）。
//
// 演进（每次都是 admin 用真机截图抓出来的）：
//   v1  两张预生成 PNG，各是一个角光斑，尺寸按短边算 → 折叠屏展开时只盖住左边，右边纯色；
//   v2  尺寸改成宽/高各自缩放 → 折叠屏盖满了，但手机上光斑被拉成 1350px 高，变回一片米白；
//   v3（现在）**一张整窗图**：把桌面 CSS 的两条 radial（ellipse 75% 80% at 8% 10% / 94% 92%，
//       同一暖色）按同一公式烘焙成一张 780×1688 PNG，运行时 stretch 到整窗 ——
//       和桌面完全同构图，宽窗/长屏都不会再有「一半有一半没有」或中间死区。
// 资产由 /tmp 脚本生成（颜色与 alpha 与 chat-glow-gradient.ts 一致）。
export type GlowMode = 'light' | 'dark';

export interface GlowBox { left: number; top: number; width: number; height: number }

/** 整窗图的位置与尺寸：铺满窗口（stretch）。保留纯函数便于单测与截图断言。 */
export function mobileGlowLayout(width: number, height: number, _mode: GlowMode = 'light'): GlowBox {
  const w = Math.max(1, width || 1);
  const h = Math.max(1, height || 1);
  return { left: 0, top: 0, width: w, height: h };
}
