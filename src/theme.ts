// Design tokens lifted from the dashboard's #217 design language:
// neutral near-black surfaces, restrained color, semantic status triad.
const DARK = {
  bg: '#0b0b0d',
  card: '#161618',
  border: '#26262b',
  inputBg: '#0e0e10',
  text: '#f4f4f5',
  textSecondary: '#a1a1aa',
  textMuted: '#52525b',
  accent: '#22d3ee',
  running: '#22c55e',
  failed: '#ef4444',
  blocked: '#f59e0b',
  rest: '#71717a',
};

// 白色主题 (Vincent tg 811/812) — same restraint on white surfaces;
// accent/status drop to the 600-weight shades for contrast on white.
const LIGHT: typeof DARK = {
  bg: '#ffffff',
  card: '#f7f7f8',
  border: '#e4e4e7',
  inputBg: '#fafafa',
  text: '#18181b',
  textSecondary: '#52525b',
  textMuted: '#a1a1aa',
  accent: '#0891b2',
  running: '#16a34a',
  failed: '#dc2626',
  blocked: '#d97706',
  rest: '#71717a',
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
