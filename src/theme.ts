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
  // 旧 #52525b 在近黑地面上对比 2.6:1,时间戳/提示几乎看不见;抬到 ≥4.5:1。
  textMuted: '#7c7c86',
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
  textMuted: '#848b96',
  accent: '#0799a8',
  onAccent: '#0b0b0d',
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

// Mutable singleton: module-level StyleSheets are rebuilt through
// onThemeChange, inline JSX reads pick the new values up on the keyed
// remount in App. Avoids threading a theme context through every file.
export const colors = { ...DARK };

let mode: ThemeMode = 'dark';
const listeners: Array<(m: ThemeMode) => void> = [];

export const themeMode = (): ThemeMode => mode;

export const setThemeMode = (m: ThemeMode): void => {
  mode = m;
  // Mutate `colors` IN PLACE — never reassign it. Every module imported
  // the same `colors` object reference; Object.assign keeps that reference
  // valid so they all see the new palette. A reassignment (colors = ...)
  // would leave existing imports pointing at the stale object. Components
  // re-read these values on App's theme-keyed remount.
  Object.assign(colors, PALETTES[m]);
  listeners.forEach(l => l(m));
};

export const onThemeChange = (l: (m: ThemeMode) => void): (() => void) => {
  listeners.push(l);
  return () => {
    const i = listeners.indexOf(l);
    if (i >= 0) listeners.splice(i, 1);
  };
};

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

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

// 极简(2026-09-24):圆角、字号、字重各收成一套刻度。原来源码里散着 14 种圆角、14 种字号、
// 51 处 700 粗体——视觉上的「乱」主要来自这里,不是颜色。新代码只用这三组值。
export const radius = { sm: 6, md: 10, lg: 14, pill: 999 };
export const type = { caption: 11, small: 12, body: 14, title: 16, heading: 20 };
/** 最重只到 600:标题/名字用 600,正文 400,次要信息 400 + textSecondary。 */
export const weight = { regular: '400', medium: '500', strong: '600' } as const;
