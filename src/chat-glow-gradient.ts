// admin 2026-11-19：聊天窗口「左上角黄色发光，右下角蓝色发光」「做的炫酷一点」。
// v1 被 admin 说「太丑」：浅色模式下半透明黄叠在灰底上发脏（看起来像米黄色污渍）。
// v2（本地 Chromium 出图对比过 5 版后定稿）：
//   · 浅色：每个光斑下面先垫一层白色提亮，再叠饱和的黄 / 蓝 —— 角落干净发亮，正文区仍是原来的灰底，气泡对比不变；
//   · 深色：黄改成偏琥珀（纯黄叠黑会发橄榄绿），蓝稍亮；
//   · 光斑用固定像素的椭圆，窗口拉宽也不会糊满整页。
export type GlowMode = 'light' | 'dark';

const glow = (rgb: string, a0: number, a1: number, at: string, size: string): string =>
  `radial-gradient(ellipse ${size} at ${at}, rgba(${rgb}, ${a0}) 0%, rgba(${rgb}, ${a1}) 40%, rgba(${rgb}, 0) 70%)`;
const lift = (at: string, size: string): string =>
  `radial-gradient(ellipse ${size} at ${at}, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0) 70%)`;

const TL = '0% 0%', BR = '100% 100%';
const TL_SIZE = '760px 520px', BR_SIZE = '820px 560px';

export const GLOW_YELLOW = { light: '255, 214, 10', dark: '255, 166, 0' } as const;
export const GLOW_BLUE = { light: '10, 132, 255', dark: '10, 132, 255' } as const;

export function chatCornerGlowGradient(mode: GlowMode): string {
  if (mode === 'light') {
    // 列表里靠前的层在上面：黄 → 白提亮 → 蓝 → 白提亮。
    return [
      glow(GLOW_YELLOW.light, 0.40, 0.15, TL, TL_SIZE), lift(TL, TL_SIZE),
      glow(GLOW_BLUE.light, 0.34, 0.13, BR, BR_SIZE), lift(BR, BR_SIZE),
    ].join(', ');
  }
  return [
    glow(GLOW_YELLOW.dark, 0.26, 0.08, TL, TL_SIZE),
    glow(GLOW_BLUE.dark, 0.40, 0.14, BR, BR_SIZE),
  ].join(', ');
}
