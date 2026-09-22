// 0.2.83:macOS 深色主题下顶部拖动区是白的。两层修法各自钉住:组件订阅主题、窗口底色跟主题。
import { readFileSync } from 'fs';
import { WINDOW_BACKGROUND, hexToRgb, windowBackgroundFor } from './window-background';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}`); };
const norm = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf-8').replace(/\r\n?/g, '\n');

// —— 纯函数 ——
ck('dark → 深色地面', windowBackgroundFor('dark') === '#0b0b0d');
ck('light → 浅色地面', windowBackgroundFor('light') === '#f4f6f8');
ck('hex → rgb', JSON.stringify(hexToRgb('#0b0b0d')) === '[11,11,13]');
ck('非法 hex 回落到深色(宁黑勿白)', JSON.stringify(hexToRgb('white')) === '[11,11,13]');

// —— 底色表与 theme.ts 调色板逐字一致(改一处必须改另一处) ——
{
  const theme = norm('./theme.ts');
  const dark = /const DARK = \{\s*bg: '([^']+)'/.exec(theme)?.[1];
  const light = /const LIGHT: typeof DARK = \{\s*bg: '([^']+)'/.exec(theme)?.[1];
  ck('WINDOW_BACKGROUND.dark == DARK.bg', !!dark && WINDOW_BACKGROUND.dark === dark);
  ck('WINDOW_BACKGROUND.light == LIGHT.bg', !!light && WINDOW_BACKGROUND.light === light);
}

// —— 窗口静态底色:默认主题是深色,窗口在 webview 画出来之前也不能是白的 ——
{
  const conf = JSON.parse(norm('../src-tauri/tauri.conf.json'));
  const main = conf.app.windows[0];
  ck('tauri.conf 主窗口 backgroundColor = 深色地面', main.backgroundColor === WINDOW_BACKGROUND.dark);
  const caps = JSON.parse(norm('../src-tauri/capabilities/default.json'));
  ck('capability 允许运行时改窗口底色', (caps.permissions as string[]).includes('core:window:allow-set-background-color'));
}

// —— 顶部两条(mac 拖动区 / Windows 标题栏)挂在 AppRoot 外面,必须自己订阅主题 ——
{
  const mac = norm('./mac-title-strip.tsx');
  ck('MacTitleStrip 订阅主题(否则主题翻了它不重画)', mac.includes('useSyncExternalStore(onThemeChange, themeMode, themeMode)'));
  ck('MacTitleStrip 底色来自调色板不是字面量', mac.includes('backgroundColor: colors.bg') && !/backgroundColor:\s*'#/.test(mac));
  const win = norm('./win-title-bar.tsx');
  ck('WinTitleBar 订阅主题', win.includes('useSyncExternalStore(onThemeChange, themeMode, themeMode)'));
  ck('WinTitleBar 底色来自调色板不是字面量', /backgroundColor:\s*colors\.(railBg|bg)/.test(win) && !/backgroundColor:\s*'#/.test(win));
  const app = norm('../App.tsx');
  ck('主题变化时同步窗口底色', app.includes('applyWindowBackground('));
}

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
