// #743 Windows 设置窗原生标题栏跟 app 主题走。ck 风格,自执行。run: bun src/native-title-bar-theme.test.ts
import { readFileSync } from 'node:fs';
import { nativeTitleBarTheme, syncNativeTitleBarTheme, wireSettingsWindowTheme } from './native-title-bar-theme';
import { settingsWindowTheme } from './desktop-settings-window';
import { onThemePreferenceChange, setSystemColorScheme, setThemePreference, systemColorScheme, themeMode, themePreference, themePreferenceSummary, type ThemeMode } from './theme';

let p = 0, t = 0;
const ck = (name: string, cond: boolean, extra = '') => { t++; if (cond) { p++; console.log(`PASS: ${name}`); } else console.log(`FAIL: ${name}${extra ? ` (${extra})` : ''}`); };
const read = (f: string) => readFileSync(f, 'utf8').replace(/\r\n?/g, '\n');

// ── 判据 ──
ck('深色 → dark', nativeTitleBarTheme('dark', 'dark') === 'dark');
ck('浅色 → light', nativeTitleBarTheme('light', 'light') === 'light');
ck('跟随系统 → null(不钉,否则 webview 的跟随系统也被钉死)', nativeTitleBarTheme('system', 'dark') === null && nativeTitleBarTheme('system', 'light') === null);

// ── 建窗:Windows 带 theme,其他平台不带 ──
setSystemColorScheme('light');
setThemePreference('dark');
ck('Windows 深色主题:建窗 theme=dark', settingsWindowTheme(true) === 'dark', String(settingsWindowTheme(true)));
setThemePreference('light');
ck('Windows 浅色主题:建窗 theme=light', settingsWindowTheme(true) === 'light');
setThemePreference('system');
ck('Windows 跟随系统:建窗不带 theme', settingsWindowTheme(true) === undefined);
setThemePreference('dark');
ck('非 Windows:建窗不带 theme(macOS 行为不变)', settingsWindowTheme(false) === undefined);

// ── 运行时:用真的 theme 模块驱动假窗口,切主题要实时推到窗口 ──
const calls: (ThemeMode | null)[] = [];
const win = { setTheme: async (th: ThemeMode | null) => { calls.push(th); } };
setThemePreference('dark');
const stop = syncNativeTitleBarTheme(win, () => ({ pref: themePreference(), mode: themeMode() }), onThemePreferenceChange);
ck('打开即同步一次', calls.join() === 'dark', calls.join());
setThemePreference('light');
ck('切到浅色,标题栏跟着变', calls.at(-1) === 'light');
setThemePreference('system');
ck('切到跟随系统,解除钉住(null)', calls.at(-1) === null && calls.length === 3, JSON.stringify(calls));
setSystemColorScheme('dark');
ck('跟随系统下系统翻色:不重复调 setTheme(交给系统)', calls.length === 3, JSON.stringify(calls));
setThemePreference('dark');
ck('「跟随系统(当前深色)」→「深色」:生效主题没变也要钉住', calls.at(-1) === 'dark' && calls.length === 4, JSON.stringify(calls));
stop();
setThemePreference('light');
ck('取消订阅后不再调', calls.length === 4);
setThemePreference('system');

// ── 系统读数不能被钉住的 theme 带歪(复审):模拟 tao + WebView2 ──
// 系统浅色;设置窗 setTheme 后,它自己的 theme() 和(profile 级)matchMedia 都变成钉住的值;主窗没被钉。
{
  const OS: ThemeMode = 'light';
  let pinned: ThemeMode | null = 'dark'; // 建窗时已带 theme: settingsWindowTheme() = dark
  const osListeners: ((e: { payload: ThemeMode }) => void)[] = [];
  const settingsWin = {
    setTheme: async (th: ThemeMode | null) => { pinned = th; },
    theme: async () => pinned ?? OS,
    onThemeChanged: async (_h: (e: { payload: ThemeMode }) => void) => () => {},
  };
  const mainWin = {
    theme: async () => OS,
    onThemeChanged: async (h: (e: { payload: ThemeMode }) => void) => { osListeners.push(h); return () => {}; },
  };
  setThemePreference('dark');
  setSystemColorScheme('dark'); // 钉住后 matchMedia 首读读到的歪值
  const off = await wireSettingsWindowTheme({
    current: settingsWin,
    byLabel: async label => (label === 'main' ? mainWin : label === 'settings' ? settingsWin : null),
    feedSystem: setSystemColorScheme,
    read: () => ({ pref: themePreference(), mode: themeMode() }),
    subscribe: onThemePreferenceChange,
  });
  ck('显式深色:设置窗标题栏被钉成 dark', pinned === 'dark');
  ck('显式深色钉住时,系统读数仍是真实系统(浅色)', systemColorScheme() === 'light', String(systemColorScheme()));
  setThemePreference('system');
  ck('切到跟随系统:提示立刻是「当前:浅色」,不是钉住的深色', themePreferenceSummary(themePreference(), themeMode()) === '跟随系统（当前：浅色）', themePreferenceSummary(themePreference(), themeMode()));
  ck('切到跟随系统:解除钉住', pinned === null);
  setThemePreference('dark');
  osListeners.forEach(h => h({ payload: 'dark' }));
  ck('显式深色下系统翻成深色:读数跟着主窗事件走', systemColorScheme() === 'dark');
  osListeners.forEach(h => h({ payload: 'light' }));
  off();
  setThemePreference('system');
}

// ── 接线 ──
const src = read('src/desktop-settings-window.ts');
const ctor = src.match(/new WebviewWindow\(SETTINGS_WINDOW_LABEL, \{[\s\S]*?\}\);/)?.[0] ?? '';
ck('设置窗构造参数带 theme', /\btheme: settingsWindowTheme\(\)/.test(ctor));
const app = read('App.tsx');
ck('设置窗里订阅主题 → 标题栏', /settingsWindow \? followThemeInSettingsTitleBar\(\)/.test(app));
ck('Windows 设置窗不订阅 matchMedia(被钉住会失真)', app.includes('installSystemThemeFollower({ subscribe: !(requestedSettingsWindow() && isWindowsTauriShell()) })'));
ck('系统读数取自主窗,不取设置窗自己', /byLabel: label => Window\.getByLabel\(label\)/.test(src) && /feedSystem: setSystemColorScheme/.test(src));
const caps = JSON.parse(read('src-tauri/capabilities/default.json')) as { permissions: string[] };
ck('capability 放行 set-theme', caps.permissions.includes('core:window:allow-set-theme'));

console.log(`\nnative-title-bar-theme: ${p}/${t} passed`);
if (p !== t) process.exit(1);
