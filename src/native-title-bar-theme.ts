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

// ── 系统配色的读数从哪来(#743 复审)─────────────────────────────────────────────────────────
// 钉住设置窗的 theme 之后,WebView2 的 SetPreferredColorScheme 是**整个 profile** 的,设置窗(以及
// 主窗)的 matchMedia 读到的是被钉住的值,不是系统真实外观。theme.ts 的 systemScheme 一旦被它喂歪,
// 从「深色」切回「跟随系统」那一刻会先按钉住的值算,「跟随系统(当前:…)」也跟着错。
// 真实系统外观的来源:**主窗**的 Tauri 窗口 theme —— 主窗从不 setTheme,tao 按系统设置算它,系统
// 一翻就发 ThemeChanged。设置窗自己的 theme() 不能用:那正是被钉住的值。

export interface OsThemeSource {
  theme: () => Promise<ThemeMode | null>;
  onThemeChanged: (h: (e: { payload: ThemeMode }) => void) => Promise<() => void>;
}

/** 系统外观来源窗口:主窗(window-shell.ts CUSTOM_TITLE_BAR_WINDOW_LABEL)。 */
export const OS_THEME_SOURCE_LABEL = 'main';

/**
 * 设置窗的整套接线:系统读数从主窗喂进 theme.ts,标题栏跟 app 主题走。依赖注入,测试用假窗口。
 * 返回取消函数。
 */
export async function wireSettingsWindowTheme(deps: {
  current: ThemeableWindow;
  byLabel: (label: string) => Promise<OsThemeSource | null>;
  feedSystem: (s: ThemeMode | null) => void;
  read: () => { pref: ThemePreference; mode: ThemeMode };
  subscribe: (l: () => void) => () => void;
}): Promise<() => void> {
  let unlistenOs = () => {};
  try {
    const os = await deps.byLabel(OS_THEME_SOURCE_LABEL);
    if (os) {
      deps.feedSystem(await os.theme());
      unlistenOs = await os.onThemeChanged(e => deps.feedSystem(e.payload));
    }
  } catch { /* 拿不到就保留 matchMedia 首读,不影响标题栏 */ }
  const stop = syncNativeTitleBarTheme(deps.current, deps.read, deps.subscribe);
  return () => { unlistenOs(); stop(); };
}
