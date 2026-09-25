// 0.2.101「跟随系统」:从平台读系统配色 + 订阅它的变化。纯逻辑,不 import react-native
// (那一半在 system-color-scheme.ts),这样 ck 测试能用假的 matchMedia / Appearance 驱动它。
//
// 两条来源,按平台选:
//  - web(浏览器 / Tauri 桌面壳的 webview):`matchMedia('(prefers-color-scheme: dark)')`。
//    Tauri 的 webview 在窗口没有被 setTheme 钉死时跟随系统外观(WKWebView / WebView2 都是),
//    所以桌面端不需要额外的窗口主题 API。🔴 反过来:**千万别**为了「窗口外框跟主题」去调
//    `getCurrentWindow().setTheme('light'|'dark')` —— 那会把 webview 的 prefers-color-scheme
//    一起钉死,跟随系统从此收不到任何变化。
//  - 原生(Android / iOS):RN `Appearance`。iOS 要 app.json `userInterfaceStyle: automatic`,
//    否则 Info.plist 写死 UIUserInterfaceStyle=Dark,Appearance 永远报 dark。

export type Scheme = 'light' | 'dark';

export interface MediaQueryListLike {
  matches: boolean;
  addEventListener?: (type: 'change', l: (e: { matches: boolean }) => void) => void;
  removeEventListener?: (type: 'change', l: (e: { matches: boolean }) => void) => void;
  // Safari < 14 只有这一对。
  addListener?: (l: (e: { matches: boolean }) => void) => void;
  removeListener?: (l: (e: { matches: boolean }) => void) => void;
}

export interface AppearanceLike {
  getColorScheme: () => string | null | undefined;
  addChangeListener: (l: (p: { colorScheme?: string | null }) => void) => { remove: () => void } | undefined | void;
}

export interface SchemeEnv {
  os: string;
  matchMedia?: ((q: string) => MediaQueryListLike) | null;
  appearance?: AppearanceLike | null;
}

export const DARK_QUERY = '(prefers-color-scheme: dark)';

const norm = (s: unknown): Scheme | null => (s === 'light' || s === 'dark' ? s : null);

const mediaList = (env: SchemeEnv): MediaQueryListLike | null => {
  if (env.os !== 'web' || typeof env.matchMedia !== 'function') return null;
  try {
    return env.matchMedia(DARK_QUERY) ?? null;
  } catch {
    return null;
  }
};

/** 当前系统配色;拿不到就 null(调用方按 FALLBACK_SYSTEM_MODE 兜底)。 */
export function readScheme(env: SchemeEnv): Scheme | null {
  if (env.os === 'web') {
    const mql = mediaList(env);
    return mql ? (mql.matches ? 'dark' : 'light') : null;
  }
  try {
    return norm(env.appearance?.getColorScheme());
  } catch {
    return null;
  }
}

/** 订阅系统配色变化。返回退订函数;平台不支持就返回 no-op。 */
export function subscribeScheme(env: SchemeEnv, listener: (s: Scheme | null) => void): () => void {
  if (env.os === 'web') {
    const mql = mediaList(env);
    if (!mql) return () => {};
    const h = (e: { matches: boolean }) => listener(e.matches ? 'dark' : 'light');
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', h);
      return () => mql.removeEventListener?.('change', h);
    }
    if (typeof mql.addListener === 'function') {
      mql.addListener(h);
      return () => mql.removeListener?.(h);
    }
    return () => {};
  }
  const app = env.appearance;
  if (!app) return () => {};
  const sub = app.addChangeListener(p => listener(norm(p?.colorScheme)));
  return () => { if (sub && typeof sub.remove === 'function') sub.remove(); };
}
