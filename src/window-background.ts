// 0.2.83(Vincent 2026-09-22:macOS 深色主题下,红黄绿灯那条顶部区域是**白的**,下面全是黑的)。
//
// 两层原因,两层都堵:
//  1. `MacTitleStrip` / `WinTitleBar` 挂在 `<AppRoot>` 外面(它们必须在最顶上,不能进
//     key={theme} 那棵会被整体重挂的树),所以主题一翻,它们**不重画**——inline 的
//     `backgroundColor: colors.bg` 是渲染那一刻的值,之后 `colors` 被 Object.assign 换了调色板,
//     它们也不知道。修法在各自组件里:`useSyncExternalStore(onThemeChange, themeMode, themeMode)`。
//  2. Tauri 窗口自己的底色默认是**白**。Overlay 标题栏区域、webview 还没画出来的那一瞬、主题切换
//     的那一帧,露出来的都是它。修法两处:tauri.conf.json 里把静态底色钉成深色地面(默认主题是深色),
//     运行时主题一翻就把窗口底色同步过去(下面 applyWindowBackground)。
//
// 这个文件只放**纯**的那一半(哪个主题对应哪个底色)+ 一个守卫过的副作用;不 import react-native。
import { type ThemeMode } from './theme';

/** 与 theme.ts 的 DARK.bg / LIGHT.bg 逐字相同——测试钉住,改调色板要一起改。 */
export const WINDOW_BACKGROUND: Readonly<Record<ThemeMode, string>> = {
  dark: '#0b0b0d',
  light: '#f4f6f8',
};

export const windowBackgroundFor = (mode: ThemeMode): string => WINDOW_BACKGROUND[mode] ?? WINDOW_BACKGROUND.dark;

/** `#rrggbb` → [r,g,b];非法输入回落到深色地面(宁可黑也不要白)。 */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hexToRgb(WINDOW_BACKGROUND.dark);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * 把当前窗口(以及它的 webview)底色同步到主题。只在 Tauri 壳里做事;失败不抛——
 * 底色是保底,不能因为它把 UI 搞挂。需要能力 `core:window:allow-set-background-color`。
 */
export async function applyWindowBackground(mode: ThemeMode): Promise<boolean> {
  if (!(globalThis as any).__TAURI_INTERNALS__) return false;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setBackgroundColor(hexToRgb(windowBackgroundFor(mode)));
    return true;
  } catch {
    return false;
  }
}
