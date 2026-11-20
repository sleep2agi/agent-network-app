// admin 2026-11-19：「左上角黄色发光，右下角蓝色发光」→「太丑」→「左侧也需要一样的」→「学学这个配色」（TMWork 启动页）。
// v3：照参考图取色，整窗一层大渐变（侧栏、会话列表、聊天连成一片），不再是聊天区角落的小光斑。
//   参考图取样：左上 rgb(249,234,215) 暖桃，右下 rgb(226,230,255) 淡紫蓝，中间接近白 rgb(245,246,250)。
//   浅色：低饱和、大半径（宽高约 75%×80%），中间留白；深色：同色相，透明度压低，只在角落有一点温度。
// v4（admin 11-19 深色 Windows 截图「你自己观察下吧」）：深色左上的橙在黑底上发棕、右下的蓝铺成一片灰雾。
//   深色改成更浅的杏色 + 更低透明度，蓝更纯、范围收进角落（60%×65%）；浅色不动。
// v5（admin 11-20「右下角还是有点丑，算了，统一用左上角这个暖黄色吧，可能稍微有点渐变」）：
//   去掉右下角的冷蓝,两个角都用同一种暖色调,只是两处渐变、不是纯色块。
// 纯函数，不引 react-native（测试要用）。
export type GlowMode = 'light' | 'dark';

export const GLOW_WARM = { light: '248, 218, 184', dark: '255, 190, 130' } as const;
const ALPHA = {
  light: { warm: [0.6, 0.25] },
  dark: { warm: [0.09, 0.03] },
} as const;

const EXTENT = { light: '75% 80%', dark: '60% 65%' } as const;
const wash = (rgb: string, a0: number, a1: number, at: string, extent: string): string =>
  `radial-gradient(ellipse ${extent} at ${at}, rgba(${rgb}, ${a0}) 0%, rgba(${rgb}, ${a1}) 40%, rgba(${rgb}, 0) 72%)`;

export function chatCornerGlowGradient(mode: GlowMode): string {
  const a = ALPHA[mode].warm;
  return [
    wash(GLOW_WARM[mode], a[0], a[1], '8% 10%', EXTENT[mode]),
    wash(GLOW_WARM[mode], a[0], a[1], '94% 92%', EXTENT[mode]),
  ].join(', ');
}
