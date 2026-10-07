// #743(Vincent 2026-10-08,Windows 截图):深色主题下,独立设置窗顶上的**原生**标题栏是白的。
//
// 主窗在 Windows 上 decorations=false、自己画 WinTitleBar,跟主题天然一致;设置窗是 decorations=true
// 的原生标题栏(见 window-shell.ts),它的颜色由 Tauri 窗口的 theme 决定 —— 没设就跟系统外观,
// 系统是浅色而 app 选了深色时就是白条。修法:Windows 上把设置窗的窗口 theme 跟着 app 主题走。
//   · 显式「深色 / 浅色」→ theme = 'dark' / 'light'
//   · 「跟随系统」        → theme = null(不钉,标题栏和 webview 都回到跟系统)
// 🔴 只在「跟随系统」时传 null:system-color-scheme-core.ts 警告过,钉住的 theme 会把 webview 的
//    prefers-color-scheme 一起钉住,跟随系统就收不到变化了。所以 system 模式下绝不能传具体值。
// 只管 Windows:macOS 的设置窗是 Overlay 标题栏 + 隐藏标题,窗口 theme 会改 NSAppearance,不在本次范围。
import type { ThemeMode, ThemePreference } from './theme';

/** 原生标题栏该用的窗口 theme;null = 不钉,跟系统。 */
export const nativeTitleBarTheme = (pref: ThemePreference, mode: ThemeMode): ThemeMode | null =>
  pref === 'system' ? null : mode;

export interface ThemeableWindow {
  setTheme: (theme: ThemeMode | null) => Promise<void>;
}

/**
 * 立刻同步一次,之后每次偏好 / 生效主题变化再同步(同值不重复调)。返回取消订阅。
 * 依赖全部注入,测试用假窗口驱动。失败不抛 —— 标题栏颜色是外观,不能把设置窗搞挂。
 */
export function syncNativeTitleBarTheme(
  win: ThemeableWindow,
  read: () => { pref: ThemePreference; mode: ThemeMode },
  subscribe: (l: () => void) => () => void,
): () => void {
  let last: ThemeMode | null | undefined;
  const push = () => {
    const { pref, mode } = read();
    const next = nativeTitleBarTheme(pref, mode);
    if (next === last) return;
    last = next;
    void win.setTheme(next).catch(() => {});
  };
  push();
  return subscribe(push);
}
