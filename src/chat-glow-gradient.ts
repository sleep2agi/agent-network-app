// admin 2026-11-19：「左上角黄色发光，右下角蓝色发光」→「太丑」→「左侧也需要一样的」→「学学这个配色」（TMWork 启动页）。
// v3：照参考图取色，整窗一层大渐变（侧栏、会话列表、聊天连成一片），不再是聊天区角落的小光斑。
//   参考图取样：左上 rgb(249,234,215) 暖桃，右下 rgb(226,230,255) 淡紫蓝，中间接近白 rgb(245,246,250)。
//   浅色：低饱和、大半径（宽高约 75%×80%），中间留白；深色：同色相，透明度压低，只在角落有一点温度。
// 纯函数，不引 react-native（测试要用）。
export type GlowMode = 'light' | 'dark';

export const GLOW_WARM = { light: '248, 218, 184', dark: '255, 170, 100' } as const;
export const GLOW_COOL = { light: '210, 216, 255', dark: '120, 132, 255' } as const;
const ALPHA = {
  light: { warm: [0.6, 0.25], cool: [0.95, 0.4] },
  dark: { warm: [0.16, 0.06], cool: [0.22, 0.08] },
} as const;

const wash = (rgb: string, a0: number, a1: number, at: string): string =>
  `radial-gradient(ellipse 75% 80% at ${at}, rgba(${rgb}, ${a0}) 0%, rgba(${rgb}, ${a1}) 40%, rgba(${rgb}, 0) 72%)`;

export function chatCornerGlowGradient(mode: GlowMode): string {
  const a = ALPHA[mode];
  return [
    wash(GLOW_WARM[mode], a.warm[0], a.warm[1], '8% 10%'),
    wash(GLOW_COOL[mode], a.cool[0], a.cool[1], '94% 92%'),
  ].join(', ');
}
