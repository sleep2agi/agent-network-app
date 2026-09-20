// 0.2.81:Windows 自绘标题栏(Vincent 2026-09-20:「这个地方在 Windows 上也很难看」)。
import { readFileSync } from 'fs';
import {
  MAC_TITLE_STRIP_HEIGHT,
  WINDOWS_TITLE_BAR_HEIGHT,
  isMacTauriShell,
  isWindowsTauriShell,
  tauriShellPlatform,
} from './window-shell';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}`); };
const norm = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf-8').replace(/\r\n?/g, '\n');

const g = globalThis as any;
// 🔴 node 24 的 globalThis.navigator 只有 getter,直接赋值会抛
// 「Cannot set property navigator of #<Object> which has only a getter」⇒ 用 defineProperty 覆盖。
const withShell = (tauri: boolean, ua: string, fn: () => void) => {
  const oldT = g.__TAURI_INTERNALS__;
  const oldDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  if (tauri) g.__TAURI_INTERNALS__ = {}; else delete g.__TAURI_INTERNALS__;
  Object.defineProperty(globalThis, 'navigator', {
    value: { platform: ua, userAgent: ua }, configurable: true, writable: true,
  });
  try { fn(); } finally {
    if (oldT === undefined) delete g.__TAURI_INTERNALS__; else g.__TAURI_INTERNALS__ = oldT;
    if (oldDesc) Object.defineProperty(globalThis, 'navigator', oldDesc);
    else delete g.navigator;
  }
};

// —— 平台判定 ——
withShell(true, 'Win32', () => {
  ck('Tauri + Windows → windows', tauriShellPlatform('web') === 'windows');
  ck('Windows 壳:isWindowsTauriShell 真', isWindowsTauriShell('web'));
  ck('Windows 壳:isMacTauriShell 假(两条不能同时真)', !isMacTauriShell('web'));
});
withShell(true, 'MacIntel', () => {
  ck('Tauri + macOS → mac', tauriShellPlatform('web') === 'mac');
  ck('macOS 壳:不渲染 Windows 标题栏', !isWindowsTauriShell('web'));
  ck('macOS 壳:mac 判定仍然成立(没被这次改动弄坏)', isMacTauriShell('web'));
});
withShell(true, 'Linux x86_64', () => {
  ck('Tauri + Linux → other,两个标题栏都不出', tauriShellPlatform('web') === 'other' && !isWindowsTauriShell('web') && !isMacTauriShell('web'));
});
withShell(false, 'Win32', () => {
  ck('网页端(没有 Tauri)→ null,不画标题栏', tauriShellPlatform('web') === null && !isWindowsTauriShell('web'));
});
withShell(true, 'Win32', () => {
  ck('移动端 Platform.OS 不是 web → null', tauriShellPlatform('android') === null && tauriShellPlatform('ios') === null);
});

ck('两个高度常量都有值', MAC_TITLE_STRIP_HEIGHT === 28 && WINDOWS_TITLE_BAR_HEIGHT === 32);

// —— 契约:组件按 Windows 分支渲染,且拖动/控件都在 ——
const bar = norm('./win-title-bar.tsx');
ck('只在 Windows 壳渲染', bar.includes("isWindowsTauriShell(Platform.OS)") && bar.includes('if (!show) return null;'));
ck('整条 bar 是拖动区(拖动窗口)', bar.includes('tauriDragRegion'));
ck('三个窗口控件都在', bar.includes("'minimize'") && bar.includes("'toggleMaximize'") && bar.includes("'close'"));
ck('最大化/还原跟随窗口状态', bar.includes('isMaximized()') && bar.includes('onResized'));
ck('控件按 Windows 习惯 46×32', bar.includes('width: 46') && bar.includes('height: WINDOWS_TITLE_BAR_HEIGHT'));
ck('关闭键悬停是红的(Windows 习惯)', bar.includes('#c42b1c'));
// 🔴 控件图形不能依赖 Segoe MDL2 Assets:缺字体就是三个豆腐块,而这是唯一的关闭入口。
//    判据要判「有没有用字体」——不能判「文件里有没有出现那个字体名」:解释「为什么不用它」的
//    注释里必然写着这个名字,那样判会把说明当成违规(判据对、取集错,今天在 parity 门上刚踩过)。
ck('控件用几何图形而不是字体图标', !bar.includes('fontFamily') && bar.includes('function glyph('));
ck('关闭图形是两条旋转的线(不是字符)', bar.includes("rotate: '45deg'") && bar.includes("rotate: '-45deg'"));

// —— 契约:挂载 + 原生标题栏在 Windows 上被关掉 ——
const app = norm('../App.tsx');
ck('App 挂了 WinTitleBar', app.includes('<WinTitleBar />'));
ck('App 仍挂着 MacTitleStrip(没有把 macOS 弄回去)', app.includes('<MacTitleStrip />'));
const rs = norm('../src-tauri/src/lib.rs');
ck('Rust 只在 Windows 关 decorations', rs.includes('#[cfg(target_os = "windows")]') && rs.includes('set_decorations(false)'));
ck('没有把 decorations 写进 tauri.conf.json(那会连 macOS 一起关掉)',
  !norm('../src-tauri/tauri.conf.json').includes('"decorations"'));

// —— 契约:能力清单给了窗口控件权限 ——
const caps = norm('../src-tauri/capabilities/default.json');
for (const perm of ['core:window:allow-minimize', 'core:window:allow-toggle-maximize', 'core:window:allow-close', 'core:window:allow-is-maximized']) {
  ck(`capability 含 ${perm}`, caps.includes(perm));
}
ck('capability 仍列全三类窗口标签', caps.includes('"main"') && caps.includes('chat-*') && caps.includes('workspace-*'));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
