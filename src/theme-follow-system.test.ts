// 0.2.101「跟随系统」(Vincent 2026-09-26:「三个选项,浅色、深色,然后跟随系统」)。
// ck 风格:自执行,任何一条失败 exit 1。
import { readFileSync } from 'node:fs';
import {
  DEFAULT_THEME_PREFERENCE,
  colors,
  onThemeChange,
  onThemePreferenceChange,
  parseStoredThemePreference,
  resolveThemeMode,
  setSystemColorScheme,
  setThemeMode,
  setThemePreference,
  systemColorScheme,
  themeMode,
  themePreference,
  themePreferenceSummary,
} from './theme';
import { DARK_QUERY, readScheme, subscribeScheme, type MediaQueryListLike } from './system-color-scheme-core';

let pass = 0;
const failures: string[] = [];
const ck = (name: string, ok: boolean) => {
  if (ok) pass++; else failures.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
};

const LIGHT_BG = '#f6f7f9';
const DARK_BG = '#111113';

// ── 1. 偏好 → 生效主题 ──
ck('system + 系统深色 → 深色', resolveThemeMode('system', 'dark') === 'dark');
ck('system + 系统浅色 → 浅色', resolveThemeMode('system', 'light') === 'light');
ck('system + 系统读数缺失 → 兜底深色(app 历来的默认)', resolveThemeMode('system', null) === 'dark');
ck('显式浅色不看系统', resolveThemeMode('light', 'dark') === 'light');
ck('显式深色不看系统', resolveThemeMode('dark', 'light') === 'dark');

// ── 2. 旧存储值迁移(key 仍是 theme_mode_v1) ──
ck('旧版存的 light 原样保留', parseStoredThemePreference('light') === 'light');
ck('旧版存的 dark 原样保留', parseStoredThemePreference('dark') === 'dark');
ck('新写入的 system 读回 system', parseStoredThemePreference('system') === 'system');
ck('新装(null)默认跟随系统', parseStoredThemePreference(null) === 'system' && DEFAULT_THEME_PREFERENCE === 'system');
ck('undefined / 空串 / 乱值 → 跟随系统',
  parseStoredThemePreference(undefined) === 'system' &&
  parseStoredThemePreference('') === 'system' &&
  parseStoredThemePreference('Dark') === 'system' &&
  parseStoredThemePreference('auto') === 'system');

// ── 3. 运行时:跟随系统时系统一变,生效主题跟着变 ──
const fired: string[] = [];
const off = onThemeChange(m => fired.push(m));
let prefTicks = 0;
const offPref = onThemePreferenceChange(() => { prefTicks++; });

ck('模块初始:生效深色、偏好=跟随系统', themeMode() === 'dark' && themePreference() === 'system');
setSystemColorScheme('dark');
ck('系统报深色(与当前相同)不触发 onThemeChange(避免整棵重挂)', fired.length === 0);
setSystemColorScheme('light');
ck('跟随系统 + 系统变浅 → 生效浅色', themeMode() === 'light');
ck('……调色板就地换成浅色', colors.bg === LIGHT_BG);
ck('……onThemeChange 恰好触发一次且带 light', fired.length === 1 && fired[0] === 'light');
setSystemColorScheme('light');
ck('系统重复报同一个值不再触发', fired.length === 1);
setSystemColorScheme('dark');
ck('跟随系统 + 系统变深 → 生效深色', themeMode() === 'dark' && colors.bg === DARK_BG && fired.at(-1) === 'dark');
setSystemColorScheme(null);
ck('系统读数丢失 → 兜底深色', themeMode() === 'dark' && systemColorScheme() === null);
setSystemColorScheme('bogus' as any);
ck('系统乱值当作缺失', systemColorScheme() === null);

// ── 4. 显式模式下系统变化不影响 ──
setSystemColorScheme('dark');
setThemePreference('light');
ck('显式浅色生效', themeMode() === 'light' && colors.bg === LIGHT_BG);
const before = fired.length;
setSystemColorScheme('dark');
setSystemColorScheme('light');
setSystemColorScheme('dark');
ck('显式浅色下系统来回切:生效主题不动', themeMode() === 'light' && colors.bg === LIGHT_BG);
ck('……也不触发 onThemeChange', fired.length === before);
ck('……但系统读数被记下(设置页「跟随系统(当前:…)」要用)', systemColorScheme() === 'dark');
setThemePreference('dark');
setSystemColorScheme('light');
ck('显式深色下系统变浅:仍是深色', themeMode() === 'dark');
// 切回跟随系统 → 立即采用最近的系统读数
setThemePreference('system');
ck('切回跟随系统立即采用最近的系统读数(浅)', themeMode() === 'light' && colors.bg === LIGHT_BG);

// ── 5. 偏好变了但生效主题没变:设置页仍要刷新 ──
setSystemColorScheme('dark');
setThemePreference('dark');
const t0 = prefTicks;
const f0 = fired.length;
setThemePreference('system'); // 系统也是深色
ck('深色 → 跟随系统(当前深色):不重挂(onThemeChange 不触发)', fired.length === f0 && themeMode() === 'dark');
ck('……但 onThemePreferenceChange 触发,设置页能刷新说明文字', prefTicks > t0);

// ── 6. 兼容:setThemeMode 等于显式选择 ──
setThemeMode('light');
ck('setThemeMode(light) = 偏好设为显式浅色', themePreference() === 'light' && themeMode() === 'light');
setSystemColorScheme('dark');
ck('……之后系统变化不再影响(夹具截图不会被宿主系统主题带跑)', themeMode() === 'light');
setThemePreference('garbage' as any);
ck('setThemePreference 收到乱值 → 回落默认(跟随系统)', themePreference() === 'system');

// ── 7. 设置页说明文字 ──
ck('跟随系统写明当前生效主题(深色)', themePreferenceSummary('system', 'dark') === '跟随系统（当前：深色）');
ck('跟随系统写明当前生效主题(浅色)', themePreferenceSummary('system', 'light') === '跟随系统（当前：浅色）');
ck('显式选项就是它自己', themePreferenceSummary('light', 'light') === '浅色' && themePreferenceSummary('dark', 'dark') === '深色');

off(); offPref();

// ── 8. 平台来源:matchMedia(web / Tauri)与 Appearance(原生) ──
const fakeMql = (initialDark: boolean, legacy = false) => {
  const ls = new Set<(e: { matches: boolean }) => void>();
  const mql: MediaQueryListLike & { fire: (d: boolean) => void; count: () => number } = {
    matches: initialDark,
    fire(d: boolean) { mql.matches = d; ls.forEach(l => l({ matches: d })); },
    count: () => ls.size,
  };
  if (legacy) {
    mql.addListener = l => ls.add(l);
    mql.removeListener = l => ls.delete(l);
  } else {
    mql.addEventListener = (_t, l) => ls.add(l);
    mql.removeEventListener = (_t, l) => ls.delete(l);
  }
  return mql;
};
{
  const mql = fakeMql(true);
  let asked = '';
  const env = { os: 'web', matchMedia: (q: string) => { asked = q; return mql; } };
  ck('web:查询的是 prefers-color-scheme: dark', readScheme(env) === 'dark' && asked === DARK_QUERY);
  const seen: Array<string | null> = [];
  const unsub = subscribeScheme(env, s => seen.push(s));
  mql.fire(false);
  ck('web:系统变浅 → 回调 light', seen.join(',') === 'light');
  mql.fire(true);
  ck('web:系统变深 → 回调 dark', seen.join(',') === 'light,dark');
  unsub();
  ck('web:退订后监听被移除', mql.count() === 0);
  mql.fire(false);
  ck('web:退订后不再回调', seen.length === 2);
}
{
  const mql = fakeMql(false, true);
  const env = { os: 'web', matchMedia: () => mql };
  const seen: Array<string | null> = [];
  const unsub = subscribeScheme(env, s => seen.push(s));
  ck('web(旧 Safari addListener):读数 light', readScheme(env) === 'light');
  mql.fire(true);
  ck('web(旧 Safari addListener):变化也能收到', seen.join(',') === 'dark');
  unsub();
  ck('web(旧 Safari):退订', mql.count() === 0);
}
ck('web 无 matchMedia → null(兜底深色),订阅是 no-op',
  readScheme({ os: 'web', matchMedia: null }) === null && typeof subscribeScheme({ os: 'web' }, () => {}) === 'function');
ck('web matchMedia 抛错 → null', readScheme({ os: 'web', matchMedia: () => { throw new Error('x'); } }) === null);
{
  let scheme: string | null = 'light';
  let cb: ((p: { colorScheme?: string | null }) => void) | null = null;
  let removed = false;
  const appearance = {
    getColorScheme: () => scheme,
    addChangeListener: (l: (p: { colorScheme?: string | null }) => void) => { cb = l; return { remove: () => { removed = true; } }; },
  };
  const env = { os: 'android', appearance, matchMedia: () => fakeMql(true) };
  ck('原生:读 Appearance,不读 matchMedia', readScheme(env) === 'light');
  const seen: Array<string | null> = [];
  const unsub = subscribeScheme(env, s => seen.push(s));
  scheme = 'dark';
  cb!({ colorScheme: 'dark' });
  cb!({ colorScheme: null });
  ck('原生:Appearance 变化 → dark,然后 null', seen.join(',') === 'dark,');
  unsub();
  ck('原生:退订调用 remove()', removed);
}

// ── 9. 接线(源码层;真跑在截图 harness 里) ──
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const iInstall = app.indexOf('installSystemThemeFollower();');
const iEarly = app.indexOf('const early = loadDesktopThemeMode();');
ck('App 首帧前装系统配色跟随,且在读偏好之前', iInstall > 0 && iEarly > iInstall);
ck('App 的冷启动/跨窗口路径都认 system(经 parseStoredThemePreference)',
  (app.match(/setThemePreference\(parseStoredThemePreference\(/g) || []).length >= 3);
ck('App 不再只认 light/dark(旧判据会把 system 丢掉)', !/mode === 'light' \|\| mode === 'dark'\) setThemeMode/.test(app));
const appJson = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
ck('app.json userInterfaceStyle=automatic(否则 iOS Info.plist 钉死 Dark,Appearance 永远报 dark)',
  appJson.expo.userInterfaceStyle === 'automatic' &&
  (appJson.expo.ios?.userInterfaceStyle ?? 'automatic') === 'automatic' &&
  (appJson.expo.android?.userInterfaceStyle ?? 'automatic') === 'automatic');
const settings = readFileSync(new URL('./SettingsScreen.tsx', import.meta.url), 'utf8');
ck('设置页是三选一(遍历 THEME_PREFERENCES),不再是深浅翻转',
  settings.includes('THEME_PREFERENCES.map') && !settings.includes("themeMode() === 'dark' ? 'light' : 'dark'"));
ck('设置页订阅偏好变化(生效主题不变时也要刷新说明)', settings.includes('useSyncExternalStore(onThemePreferenceChange'));
ck('设置页选中后保存偏好本身(含 system)', settings.includes('void saveThemeMode(option)'));
for (const f of ['TrayPanel.tsx', 'DesktopUpdatePrompt.tsx', 'AndroidUpdatePrompt.tsx', 'mac-title-strip.tsx', 'win-title-bar.tsx']) {
  const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
  ck(`${f} 在 key={theme} 重挂树外,自己订阅主题`, src.includes('useSyncExternalStore(onThemeChange, themeMode, themeMode)'));
}
const wb = readFileSync(new URL('./window-background.ts', import.meta.url), 'utf8') + readFileSync(new URL('./system-color-scheme.ts', import.meta.url), 'utf8');
ck('不调用 Tauri window.setTheme(会钉死 webview 的 prefers-color-scheme,跟随系统失效)', !/\.setTheme\(/.test(wb) && !/\.setTheme\(/.test(app));

if (failures.length) {
  for (const f of failures) console.error(`FAIL: ${f}`);
  process.exit(1);
}
console.log(`theme follow system: ${pass} checks passed`);
