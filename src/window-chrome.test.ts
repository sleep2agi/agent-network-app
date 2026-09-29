// 每个窗口只能有一套窗口控件(Vincent 2026-09-29「怎么有两个×」:0.2.145 Windows 设置窗
// 顶上是原生标题栏 – □ ×,下面又是一排自绘 WinTitleBar – □ ×,侧栏左上角还有一个 ✕)。
// ck 风格,自执行。run: bun src/window-chrome.test.ts
//
// 判据:decorations true ⇒ 那个窗口不挂 WinTitleBar;decorations false ⇒ 挂。
// 取集:扫 src/ 下每一处 `new WebviewWindow(` 和 src-tauri/src 下每一处 `WebviewWindowBuilder::new(`,
//       再加 tauri.conf.json 的默认窗口。扫到清单外的新窗口 = FAIL —— 新开一种窗口必须来这里登记。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as shell from './window-shell';
import { SETTINGS_WINDOW_LABEL } from './desktop-settings-window';
import { IMAGE_WINDOW_LABEL } from './image-window-model';
import { chatWindowLabel, workspaceWindowLabel } from './desktop-chat-menu';
import { taskWindowLabel } from './task-window-model';

let p = 0, t = 0;
const ck = (name: string, cond: boolean, extra = '') => { t++; if (cond) { p++; console.log(`PASS: ${name}`); } else console.log(`FAIL: ${name}${extra ? ` (${extra})` : ''}`); };
const read = (f: string) => readFileSync(f, 'utf8').replace(/\r\n?/g, '\n');

// 旧代码里没有这个判定 ⇒ 按旧行为(Windows 壳里每个窗口都画)算,好让这份测试在修复前逐条红。
const drawsOwnTitleBar: (label: string | null) => boolean =
  typeof (shell as any).windowDrawsOwnTitleBar === 'function' ? (shell as any).windowDrawsOwnTitleBar : () => true;

// 在「Windows Tauri 壳 + 某个窗口 label」下,WinTitleBar 会不会渲染(和组件里 `show` 同一个式子)。
const g = globalThis as any;
const winTitleBarShows = (label: string): boolean => {
  const oldT = g.__TAURI_INTERNALS__;
  const oldNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  g.__TAURI_INTERNALS__ = { metadata: { currentWindow: { label }, currentWebview: { windowLabel: label, label } } };
  Object.defineProperty(globalThis, 'navigator', { value: { platform: 'Win32', userAgent: 'Win32' }, configurable: true, writable: true });
  try {
    return shell.isWindowsTauriShell('web') && drawsOwnTitleBar(typeof (shell as any).currentWindowLabel === 'function' ? (shell as any).currentWindowLabel() : label);
  } finally {
    if (oldT === undefined) delete g.__TAURI_INTERNALS__; else g.__TAURI_INTERNALS__ = oldT;
    if (oldNav) Object.defineProperty(globalThis, 'navigator', oldNav); else delete g.navigator;
  }
};

// ── 取集:所有 JS 侧窗口创建点 ────────────────────────────────────────────────
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) out.push(...walk(f));
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(f);
  }
  return out;
}
type Site = { file: string; labelExpr: string; options: string };
const sites: Site[] = [];
for (const file of [...walk('src'), 'App.tsx']) {
  const src = read(file);
  const re = /new WebviewWindow\(\s*([^,]+),\s*\{/g;
  for (let m; (m = re.exec(src));) {
    // 花括号配对取出整个 options 对象
    let depth = 0, i = m.index + m[0].length - 1, end = i;
    for (; end < src.length; end++) {
      if (src[end] === '{') depth++;
      else if (src[end] === '}' && --depth === 0) break;
    }
    let labelExpr = m[1].trim();
    // `new WebviewWindow(label, …)`:取同一函数里最近的 `const label = xxx(`
    if (labelExpr === 'label') {
      const before = src.slice(0, m.index);
      const decl = [...before.matchAll(/const label = (\w+)\(/g)].pop();
      labelExpr = decl ? `${decl[1]}()` : 'label';
    }
    // 🔴 Windows 上 join() 给的是反斜杠,清单键统一用 /
    sites.push({ file: file.replace(/\\/g, '/'), labelExpr, options: src.slice(i, end + 1) });
  }
}

// ── 清单:每一种窗口的 label 和它应有的边框 ─────────────────────────────────────
const REGISTRY: Record<string, { name: string; label: string }> = {
  'src/desktop-settings-window.ts SETTINGS_WINDOW_LABEL': { name: '设置窗(#483)', label: SETTINGS_WINDOW_LABEL },
  'src/image-window.ts IMAGE_WINDOW_LABEL': { name: '看图窗(#464)', label: IMAGE_WINDOW_LABEL },
  'src/desktop-chat-menu.ts chatWindowLabel()': { name: '分离聊天窗', label: chatWindowLabel('示例', 'p1') },
  'src/desktop-chat-menu.ts workspaceWindowLabel()': { name: '工作区窗', label: workspaceWindowLabel('p1') },
  'src/task-window.ts taskWindowLabel()': { name: '任务窗(在新窗口打开)', label: taskWindowLabel('p1', 'req_demo_1') },
};
const keys = sites.map(s => `${s.file} ${s.labelExpr}`);
ck('取集非空(扫到 ≥4 个 new WebviewWindow)', sites.length >= 4, String(sites.length));
ck('每个窗口创建点都在清单里(新开窗口要来登记)', keys.every(k => k in REGISTRY), keys.filter(k => !(k in REGISTRY)).join(', '));
ck('清单里的每个窗口都还扫得到(没有过期条目)', Object.keys(REGISTRY).every(k => keys.includes(k)), Object.keys(REGISTRY).filter(k => !keys.includes(k)).join(', '));
for (const name of ['设置窗(#483)', '看图窗(#464)', '分离聊天窗', '任务窗(在新窗口打开)']) {
  ck(`清单包含 ${name}`, Object.values(REGISTRY).some(r => r.name === name));
}

for (const s of sites) {
  const reg = REGISTRY[`${s.file} ${s.labelExpr}`];
  if (!reg) continue;
  const deco = s.options.match(/\bdecorations:\s*(true|false)\b/)?.[1];
  ck(`${reg.name}: decorations 显式写明(不靠默认值)`, deco === 'true' || deco === 'false', deco ?? 'missing');
  const native = deco !== 'false'; // Tauri 默认 true
  const bar = winTitleBarShows(reg.label);
  ck(`${reg.name}: decorations ${native} ⇒ ${native ? '不' : ''}挂自绘 WinTitleBar(label=${reg.label})`, bar === !native, `WinTitleBar=${bar}`);
}

// ── 主窗:tauri.conf.json 唯一的窗口,Windows 上由 Rust 关掉 decorations,自己画标题栏 ─────────
const conf = JSON.parse(read('src-tauri/tauri.conf.json')) as { app: { windows: Array<{ label?: string; decorations?: boolean }> } };
ck('tauri.conf.json 只有一个窗口', conf.app.windows.length === 1, String(conf.app.windows.length));
ck('那个窗口是 main', (conf.app.windows[0]?.label ?? 'main') === 'main');
const lib = read('src-tauri/src/lib.rs');
ck('Rust setup 只在 Windows 对启动时的窗口 set_decorations(false)', lib.includes('#[cfg(target_os = "windows")]') && lib.includes('window.set_decorations(false)'));
ck('主窗(decorations false @Windows)⇒ 挂 WinTitleBar', winTitleBarShows('main'));

// Rust 侧运行时建的窗口:只有托盘面板(无边框弹层,本来就不带任何窗口控件)
const rustSites: string[] = [];
const walkRs = (dir: string) => {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) walkRs(f);
    else if (e.endsWith('.rs') && read(f).includes('WebviewWindowBuilder::new(')) rustSites.push(f);
  }
};
walkRs('src-tauri/src');
ck('Rust 侧窗口创建点只有托盘面板', rustSites.length === 1 && rustSites[0].endsWith('tray.rs'), rustSites.join(', '));
const tray = read('src-tauri/src/tray.rs');
ck('托盘面板无边框 + label 不是 main ⇒ 不挂 WinTitleBar(弹层,不要任何窗口控件)',
  tray.includes('.decorations(false)') && tray.includes('pub const PANEL_LABEL: &str = "tray-panel"') && !winTitleBarShows('tray-panel'));
const app = read('App.tsx');
ck('托盘面板 / 看图窗在挂 WinTitleBar 之前就 return 了', app.indexOf('<TrayPanel />') < app.indexOf('<WinTitleBar />') && app.indexOf('<ImageViewerWindow />') < app.indexOf('<WinTitleBar />'));

// ── WinTitleBar 组件本身用的是这条判定 ─────────────────────────────────────────
const bar = read('src/win-title-bar.tsx');
ck('WinTitleBar 的 show 同时要求 Windows 壳和 windowDrawsOwnTitleBar()', bar.includes('isWindowsTauriShell(Platform.OS) && windowDrawsOwnTitleBar()'));

// ── 独立设置窗里没有侧栏左上角的 ✕;应用内设置页(窗口开不了时的主窗兜底)保留 ─────────────
const settingsEl = app.match(/testID="dedicated-settings-window"[\s\S]*?<SettingsScreen\b[\s\S]*?\/>/)?.[0] ?? '';
ck('找到独立设置窗的 <SettingsScreen …/>', settingsEl.includes('<SettingsScreen'));
ck('独立设置窗不传 onClose(关窗交给窗口标题栏)', !/\bonClose=/.test(settingsEl));
ck('应用内设置页仍有 ✕(onClose 回 agents)', app.includes("onClose={() => setScreen({ name: 'agents' })}"));
ck('SettingsScreen 只在有 onClose 时画 ✕', read('src/SettingsScreen.tsx').includes('{onClose ? ('));

console.log(`\nwindow-chrome: ${p}/${t} passed`);
if (p !== t) process.exit(1);
