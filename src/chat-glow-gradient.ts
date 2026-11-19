// admin 2026-11-19：聊天窗口「左上角黄色发光，右下角蓝色发光」。
// 两个很淡的径向光斑叠在底色上：只染角落，不碰正文区域的对比度。纯函数，不引 react-native（测试要用）。
export type GlowMode = 'light' | 'dark';
// admin 追加「做的炫酷一点」：光斑更亮、更大，中间再加一层半透明过渡，让光有「晕开」的层次。
export const GLOW_YELLOW = { light: 'rgba(250, 204, 21, 0.38)', dark: 'rgba(250, 204, 21, 0.26)' } as const;
export const GLOW_BLUE = { light: 'rgba(59, 130, 246, 0.34)', dark: 'rgba(59, 130, 246, 0.36)' } as const;
const half = (rgba: string): string => rgba.replace(/[\d.]+\)$/, m => `${(parseFloat(m) / 2).toFixed(3)})`);

export function chatCornerGlowGradient(mode: GlowMode): string {
  return [
    `radial-gradient(70% 60% at 0% 0%, ${GLOW_YELLOW[mode]} 0%, ${half(GLOW_YELLOW[mode])} 35%, rgba(0, 0, 0, 0) 100%)`,
    `radial-gradient(70% 60% at 100% 100%, ${GLOW_BLUE[mode]} 0%, ${half(GLOW_BLUE[mode])} 35%, rgba(0, 0, 0, 0) 100%)`,
  ].join(', ');
}

