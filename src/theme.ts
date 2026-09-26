// Design tokens lifted from the dashboard's #217 design language:
// neutral near-black surfaces, restrained color, semantic status triad.
// 极简(2026-09-24):地面从近黑抬到 #111113,卡片只比地面亮一档;边框只用来分区,不用来包每个元素。
const DARK = {
  bg: '#111113',
  card: '#18181b',
  border: '#242428',
  inputBg: '#151518',
  text: '#ededef',
  textSecondary: '#a1a1aa',
  // 旧 #52525b 在近黑地面上对比 2.6:1,时间戳/提示几乎看不见;抬到在所有深色面上 ≥4.5:1。
  textMuted: '#8b8b95',
  // 霓虹青 #22d3ee 改成同色相、降饱和的青:仍是品牌色,但不再抢眼。
  accent: '#4cc3d6',
  onAccent: '#0b0b0d',
  broadcast: '#a78bfa',
  running: '#22c55e',
  failed: '#ef4444',
  blocked: '#f59e0b',
  rest: '#71717a',
  // 列表行:平铺不成卡片;悬停/选中各一档中性底色(不再用阴影和强调色)。
  listBg: '#111113',
  rowHover: '#1b1b1f',
  rowActive: '#222227',
  // 引用、分隔等「次要结构」统一用这一档,不另起一套灰。
  subtleFill: '#1e1e22',
  // 桌面左侧导航栏(rail):比会话列表再深一档;激活态用弱化的 accent 底色。
  railBg: '#0d0d0f',
  railHover: '#1a1a1e',
  railActiveBg: '#15282c',
  railTooltipBg: '#27272a',
  railTooltipText: '#f4f4f5',
};

// 白色主题 (Vincent tg 811/812) — same restraint on white surfaces;
// accent/status use darker shades where needed for AA contrast on white.
const LIGHT: typeof DARK = {
  bg: '#f6f7f9',
  card: '#ffffff',
  border: '#e6e8ec',
  inputBg: '#f1f2f5',
  text: '#1d2026',
  textSecondary: '#5d6470',
  // 弱化文字在全部浅色面(含选中行)上 ≥4.5:1。
  textMuted: '#636a75',
  // 强调色作为文字(链接/「复制」「刷新」)在白底 ≥4.5:1;按钮上的字改白色(5.1:1)。
  accent: '#067a86',
  onAccent: '#ffffff',
  broadcast: '#7c3aed',
  running: '#15803d',
  failed: '#dc2626',
  blocked: '#d97706',
  rest: '#71717a',
  listBg: '#fafafb',
  rowHover: '#f1f3f5',
  rowActive: '#e9ebee',
  subtleFill: '#f0f1f3',
  railBg: '#eef0f3',
  railHover: '#e3e6ea',
  railActiveBg: '#dcedf0',
  railTooltipBg: '#20242a',
  railTooltipText: '#f4f4f5',
};

export type ThemeMode = 'dark' | 'light';
const PALETTES: Record<ThemeMode, typeof DARK> = { dark: DARK, light: LIGHT };

// ── 0.2.101「跟随系统」(Vincent 2026-09-26:「三个选项,浅色、深色,然后跟随系统」)──
//
// 两个概念,别混:
//  - **偏好** ThemePreference:用户在设置里选的那一项,'light' | 'dark' | 'system'。持久化的是它。
//  - **生效主题** ThemeMode:此刻真正画出来的调色板,只有 'light' | 'dark'。
// `themeMode()` 仍然只返回生效主题 —— 全仓几十处 `themeMode() === 'light'` 不用改。
// 偏好是 'system' 时,生效主题 = 系统当前配色(由 setSystemColorScheme 喂进来,
// 见 system-color-scheme.ts);偏好是 light/dark 时,系统怎么变都不影响。
export type ThemePreference = ThemeMode | 'system';
export const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'];
/** 新装(存储里没有任何值)默认跟随系统。已存 light/dark 的老用户原样保留。 */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';
/** 系统配色拿不到(null / 旧 WebView 没有 matchMedia)时的兜底 —— 与本 app 一直以来的默认一致。 */
export const FALLBACK_SYSTEM_MODE: ThemeMode = 'dark';

export const isThemePreference = (v: unknown): v is ThemePreference =>
  v === 'light' || v === 'dark' || v === 'system';

/**
 * 存储里的原始值 → 偏好。旧版本只会写 'light' / 'dark'(key 仍是 theme_mode_v1),原样沿用;
 * null / 空 / 不认识的值 = 从没选过 → 默认「跟随系统」。
 */
export const parseStoredThemePreference = (raw: unknown): ThemePreference =>
  isThemePreference(raw) ? raw : DEFAULT_THEME_PREFERENCE;

export const resolveThemeMode = (pref: ThemePreference, system: ThemeMode | null): ThemeMode =>
  pref === 'system' ? (system ?? FALLBACK_SYSTEM_MODE) : pref;

// Mutable singleton: module-level StyleSheets are rebuilt through
// onThemeChange, inline JSX reads pick the new values up on the keyed
// remount in App. Avoids threading a theme context through every file.
export const colors = { ...DARK };

let mode: ThemeMode = 'dark';
// 内存里的初始偏好就是新装默认;冷启动读到存储后由 setThemePreference 覆盖。
let preference: ThemePreference = DEFAULT_THEME_PREFERENCE;
let systemScheme: ThemeMode | null = null;
const listeners: Array<(m: ThemeMode) => void> = [];
const preferenceListeners: Array<() => void> = [];

export const themeMode = (): ThemeMode => mode;
export const themePreference = (): ThemePreference => preference;
/** 最近一次喂进来的系统配色;null = 还没读到 / 平台不提供。 */
export const systemColorScheme = (): ThemeMode | null => systemScheme;

const apply = (): void => {
  const next = resolveThemeMode(preference, systemScheme);
  if (next !== mode) {
    mode = next;
    // Mutate `colors` IN PLACE — never reassign it. Every module imported
    // the same `colors` object reference; Object.assign keeps that reference
    // valid so they all see the new palette. A reassignment (colors = ...)
    // would leave existing imports pointing at the stale object. Components
    // re-read these values on App's theme-keyed remount.
    Object.assign(colors, PALETTES[mode]);
    // 只在生效主题**真的变了**才通知:App 用 key={theme} 整棵重挂,系统事件重复发同一个值
    // (或「深色」→「跟随系统(当前深色)」)不能把用户正在看的界面白白重挂一遍。
    listeners.forEach(l => l(mode));
  }
  preferenceListeners.forEach(l => l());
};

/** 用户在设置里选了一项(或冷启动读到了存储)。 */
export const setThemePreference = (p: ThemePreference): void => {
  preference = isThemePreference(p) ? p : DEFAULT_THEME_PREFERENCE;
  apply();
};

/**
 * 喂入系统当前配色(Appearance / matchMedia 的读数与变化事件)。偏好是 'system' 才会改变
 * 生效主题;显式 light/dark 下只记下读数(设置页「跟随系统(当前:…)」用得到)。
 */
export const setSystemColorScheme = (s: string | null | undefined): void => {
  systemScheme = s === 'light' || s === 'dark' ? s : null;
  apply();
};

/**
 * 兼容旧调用点(夹具、旧代码):直接指定一个明确的主题 = 把偏好设成它。
 */
export const setThemeMode = (m: ThemeMode): void => setThemePreference(m);

export const onThemeChange = (l: (m: ThemeMode) => void): (() => void) => {
  listeners.push(l);
  return () => {
    const i = listeners.indexOf(l);
    if (i >= 0) listeners.splice(i, 1);
  };
};

/**
 * Re-run every onThemeChange listener without a palette change. ui-scale.ts calls this when the
 * 字体大小 / 界面密度 changes: the listeners are what rebuild module-level `makeStyles()`, and
 * the density lives in `spacing`, which those styles read. (Listeners receive the unchanged mode.)
 */
export const restyleAll = (): void => {
  listeners.forEach(l => l(mode));
};

/** 偏好或系统读数变了(生效主题不一定变)。设置页靠它刷新「跟随系统(当前:…)」。 */
export const onThemePreferenceChange = (l: () => void): (() => void) => {
  preferenceListeners.push(l);
  return () => {
    const i = preferenceListeners.indexOf(l);
    if (i >= 0) preferenceListeners.splice(i, 1);
  };
};

const MODE_LABEL: Record<ThemeMode, string> = { light: '浅色', dark: '深色' };
export const THEME_PREFERENCE_LABEL: Record<ThemePreference, string> = { light: '浅色', dark: '深色', system: '跟随系统' };

/** 设置页主题行的说明文字。跟随系统时写明当前生效的是哪个:「跟随系统（当前：深色）」。 */
export const themePreferenceSummary = (pref: ThemePreference, effective: ThemeMode): string =>
  pref === 'system' ? `跟随系统（当前：${MODE_LABEL[effective]}）` : THEME_PREFERENCE_LABEL[pref];

export const statusColor = (status: string, online: boolean): string => {
  if (!online) return colors.rest;
  switch (status) {
    case 'idle':
    case 'working':
    case 'running':
      return colors.running;
    case 'error':
    case 'failed':
      return colors.failed;
    case 'blocked':
      return colors.blocked;
    default:
      return colors.rest;
  }
};

/** Unscaled spacing scale. `spacing` below is this × the 界面密度 factor (src/ui-scale.ts). */
export const SPACING_BASE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
// Mutable like `colors`: ui-scale.ts rewrites it IN PLACE when the density changes and then
// runs restyleAll(), so every module-level makeStyles() picks up the new values.
export const spacing: { xs: number; sm: number; md: number; lg: number; xl: number } = { ...SPACING_BASE };

// 极简(2026-09-24):圆角、字号、字重各收成一套刻度。原来源码里散着 14 种圆角、14 种字号、
// 51 处 700 粗体——视觉上的「乱」主要来自这里,不是颜色。新代码只用这三组值。
export const radius = { sm: 6, md: 10, lg: 14, pill: 999 };
export const type = { caption: 11, small: 12, body: 14, title: 16, heading: 20 };
/** 最重只到 600:标题/名字用 600,正文 400,次要信息 400 + textSecondary。 */
export const weight = { regular: '400', medium: '500', strong: '600' } as const;
