// 2026-09-25 Vincent(desktop 0.2.94 macOS 截图):规则文件「全屏」里红黄绿灯压在「阅读/编辑」上。
// 根因:全屏是 react-native Modal(web 端 position:fixed 铺满窗口),把 App.tsx 顶上那条 28px 的
// MacTitleStrip 盖住了,工具条从 y=0 开始画。修法沿用主窗的同一机制:Modal 里再挂一次 <MacTitleStrip />。
// 这里钉两件事:① 平台判定(只有 Tauri+macOS 才让出空带);② 全屏确实挂了它、挂在工具条之前。
// @ts-expect-error app tsconfig 不带 node 类型(其余读源码的 ck 测试同样报这一条);运行时由 node/bun 提供。
import { readFileSync } from 'node:fs';
import { isMacTauriShell, MAC_TITLE_STRIP_HEIGHT } from './window-shell';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };

// ① 平台判定表:全屏顶部空带只给 Tauri + macOS。
const g = globalThis as any;
const saved = { tauri: g.__TAURI_INTERNALS__, nav: g.navigator };
const MAC = { platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' };
const WIN = { platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
const LINUX = { platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' };
const inset = (tauri: boolean, nav: object, os = 'web') => { g.__TAURI_INTERNALS__ = tauri ? {} : undefined; g.navigator = nav; return isMacTauriShell(os); };
ck('Tauri + macOS → 让出空带', inset(true, MAC) === true);
ck('Tauri + Windows → 不让(Windows 不变)', inset(true, WIN) === false);
ck('Tauri + Linux → 不让(Linux 不变)', inset(true, LINUX) === false);
ck('浏览器里的 Mac(非 Tauri)→ 不让', inset(false, MAC) === false);
ck('iOS/Android(Platform.OS≠web)→ 不让', inset(true, MAC, 'ios') === false);
g.__TAURI_INTERNALS__ = saved.tauri; g.navigator = saved.nav;
ck('空带 28px ≥ 红黄绿灯下沿(约 y=17)', MAC_TITLE_STRIP_HEIGHT >= 17);

// ② 全屏组件挂了同一个 strip,位置在 Modal 里、工具条和「退出全屏」之前。
const src = readFileSync(new URL('./NodeRulesSection.tsx', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
ck('从 mac-title-strip 引入(同一个组件,不是另写一份)', /import MacTitleStrip from '\.\/mac-title-strip';/.test(src));
const start = src.indexOf('function RulesFullscreen(');
const body = start >= 0 ? src.slice(start) : '';
ck('找到 RulesFullscreen', body.length > 0);
const code = body.replace(/\{\/\*[\s\S]*?\*\/\}/g, ''); // 去掉 JSX 注释,免得命中说明文字
const iModal = code.indexOf('<Modal');
const iStrip = code.indexOf('<MacTitleStrip />');
const iToolbar = code.indexOf('{toolbar}');
const iEsc = code.indexOf('退出全屏 Esc');
ck('strip 在 Modal 里面', iModal >= 0 && iStrip > iModal);
ck('strip 在工具条之前(工具条被推到空带下面)', iStrip >= 0 && iToolbar > iStrip);
ck('「退出全屏 Esc」仍在工具条那一行(strip 之后)', iEsc > iStrip);
ck('全屏里只挂一次', code.split('<MacTitleStrip />').length === 2);

// ③ strip 本身:只在 Tauri+macOS 渲染、是拖动区(别人改了它,这里也要红)。
const strip = readFileSync(new URL('./mac-title-strip.tsx', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
ck('strip 非 macOS 壳返回 null', strip.includes('if (!isMacTauriShell(Platform.OS)) return null;'));
ck('strip 是拖动区', strip.includes("dataSet: { tauriDragRegion: '' }"));

console.log(`\n${p}/${t} passed`); process.exit(p === t ? 0 : 1);
