// 分离聊天窗:页头兼当标题栏(Vincent 2026-09-30「上面那个还是挺多余的」,照微信独立聊天窗)。
// ck 风格,自执行。run: bun src/popout-window-controls.test.ts
//
// 判据分三块:① 哪个窗口、哪个系统才画(手机 / 网页 / 其他窗口一律不画 —— 桌面专用的静态守卫);
// ② 页头让位的几何数值;③ 源码契约:挂载点、拖动区、控件规格。
import { readFileSync } from 'node:fs';
import {
  CHAT_POPOUT_LABEL_PREFIX,
  POPOUT_WINDOW_CONTROLS_WIDTH,
  POPOUT_TRAFFIC_LIGHT_INSET,
  WINDOW_CONTROL_WIDTH,
  WINDOWS_TITLE_BAR_HEIGHT,
  isChatPopoutLabel,
  popoutChatChrome,
  popoutHeaderChrome,
  popoutHeaderPadding,
} from './window-shell';
import { chatWindowLabel, workspaceWindowLabel } from './desktop-chat-menu';

let p = 0, t = 0;
const ck = (name: string, cond: boolean, extra = '') => { t++; if (cond) { p++; console.log(`PASS: ${name}`); } else console.log(`FAIL: ${name}${extra ? ` (${extra})` : ''}`); };
const read = (f: string) => readFileSync(f, 'utf8').replace(/\r\n?/g, '\n');

const g = globalThis as any;
const withShell = <T>(tauri: boolean, ua: string, label: string | null, fn: () => T): T => {
  const oldT = g.__TAURI_INTERNALS__;
  const oldNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  if (tauri) g.__TAURI_INTERNALS__ = label ? { metadata: { currentWindow: { label } } } : {};
  else delete g.__TAURI_INTERNALS__;
  Object.defineProperty(globalThis, 'navigator', { value: { platform: ua, userAgent: ua }, configurable: true, writable: true });
  try { return fn(); } finally {
    if (oldT === undefined) delete g.__TAURI_INTERNALS__; else g.__TAURI_INTERNALS__ = oldT;
    if (oldNav) Object.defineProperty(globalThis, 'navigator', oldNav); else delete g.navigator;
  }
};

// ── ① 哪里画 ────────────────────────────────────────────────────────────────
const chat = chatWindowLabel('示例-A', 'p1');
ck('分离聊天窗 label 是 chat-*', chat.startsWith(CHAT_POPOUT_LABEL_PREFIX) && isChatPopoutLabel(chat));
ck('Windows 壳 + 分离聊天窗 → windows', withShell(true, 'Win32', chat, () => popoutChatChrome('web')) === 'windows');
ck('macOS 壳 + 分离聊天窗 → mac', withShell(true, 'MacIntel', chat, () => popoutChatChrome('web')) === 'mac');
ck('Linux 壳 → null(没有设计过的系统不动)', withShell(true, 'Linux x86_64', chat, () => popoutChatChrome('web')) === null);
// 🔴 桌面专用的静态守卫:手机上(Platform.OS = android/ios)即使全局里凑巧有 Tauri 标记也不画。
for (const os of ['android', 'ios']) {
  ck(`手机(${os})→ null`, withShell(true, 'Win32', chat, () => popoutChatChrome(os)) === null);
}
ck('网页端(没有 Tauri)→ null', withShell(false, 'Win32', chat, () => popoutChatChrome('web')) === null);
for (const label of ['main', 'settings', 'image-viewer', 'tray-panel', workspaceWindowLabel('p1'), 'task-abc']) {
  ck(`其他窗口(${label})→ null,只动分离聊天窗`, withShell(true, 'Win32', label, () => popoutChatChrome('web')) === null);
}
ck('拿不到 label → null(不把主窗当成分离窗)', withShell(true, 'Win32', null, () => popoutChatChrome('web')) === null);

// ── ② 让位几何 ───────────────────────────────────────────────────────────────
ck('窗口控件 46×32,三颗 = 138', WINDOW_CONTROL_WIDTH === 46 && WINDOWS_TITLE_BAR_HEIGHT === 32 && POPOUT_WINDOW_CONTROLS_WIDTH === 138);
const win = popoutHeaderPadding('windows', 16);
ck('Windows:页头右侧让出三颗按钮 + 间距,左侧不变', win.right >= POPOUT_WINDOW_CONTROLS_WIDTH + 4 && win.left === 16, JSON.stringify(win));
const mac = popoutHeaderPadding('mac', 16);
ck('macOS:页头左侧让出红黄绿灯(≥ 76),右侧不变', mac.left === POPOUT_TRAFFIC_LIGHT_INSET && mac.left >= 76 && mac.right === 16, JSON.stringify(mac));
ck('非分离窗:popoutHeaderChrome 返回空对象(页头一个字节都不变)', Object.keys(popoutHeaderChrome(null, 16)).length === 0);
const chromeWin = popoutHeaderChrome('windows', 16);
ck('分离窗页头是 deep 拖动区(空白处拖动 / 双击最大化,按钮照常可点)', chromeWin.dataSet?.tauriDragRegion === 'deep');

// ── ③ 源码契约 ───────────────────────────────────────────────────────────────
const app = read('App.tsx');
ck('App 挂了 PopoutWindowControls(在 AppRoot 之后 ⇒ 叠在页头上面)', app.indexOf('<PopoutWindowControls />') > app.indexOf('<AppRoot />') && app.indexOf('<AppRoot />') > -1);
const branch = app.slice(app.indexOf('if (dedicatedChatWindow && cfg'), app.indexOf('<DesktopMessageListener cfg={cfg} />', app.indexOf('if (dedicatedChatWindow && cfg')));
ck('windowChrome 只在分离聊天窗分支里传(聊天页 + 节点信息页各一次)', (app.match(/windowChrome=\{windowChrome\}/g) ?? []).length === 2 && (branch.match(/windowChrome=\{windowChrome\}/g) ?? []).length === 2);
ck('分离窗分支用 popoutChatChrome(Platform.OS) 判定', branch.includes('popoutChatChrome(Platform.OS)'));

const controls = read('src/popout-window-controls.tsx');
ck('PopoutWindowControls 第一件事是判 windows 分离窗,否则 null', /if \(popoutChatChrome\(Platform\.OS\) !== 'windows'\) return null;/.test(controls));
ck('PopoutWindowControls 复用 WinTitleBar 的 WindowControls(不另写一套)', controls.includes('<WindowControls'));
ck('控件贴右上角', controls.includes("position: 'absolute'") && controls.includes('top: 0') && controls.includes('right: 0'));

const bar = read('src/win-title-bar.tsx');
ck('WindowControls:46×32、关闭悬停红底、最大化图标跟随窗口状态', bar.includes('width: WINDOW_CONTROL_WIDTH') && bar.includes('height: WINDOWS_TITLE_BAR_HEIGHT') && bar.includes('#c42b1c') && bar.includes('onResized'));

for (const [file, tag] of [['src/ChatScreen.tsx', 'chat-header'], ['src/NodeDetailScreen.tsx', 'screen-header']] as const) {
  const src = read(file);
  const at = src.indexOf(`testID="${tag}"`);
  const open = src.lastIndexOf('<View', at);
  const el = src.slice(open, src.indexOf('>', at) + 1);
  ck(`${file}:页头挂 headerChrome 的拖动区和让位`, el.includes('dataSet: headerChrome.dataSet') && el.includes('headerChrome.style'), el.slice(0, 160));
  ck(`${file}:headerChrome 来自 popoutHeaderChrome(windowChrome, …)`, /const headerChrome = popoutHeaderChrome\(windowChrome, spacing\.lg\)/.test(src));
  ck(`${file}:windowChrome 默认 null`, src.includes('windowChrome = null'));
}

const strip = read('src/mac-title-strip.tsx');
ck('macOS 分离聊天窗不再画 28px 空带', strip.includes("popoutChatChrome(Platform.OS) === 'mac') return null"));
const pin = read('src/DesktopWindowPin.tsx');
ck('浮动图钉在分离窗(Windows)让到 – □ × 左边', pin.includes('right: popoutHeaderPadding(popoutChatChrome(Platform.OS), 10).right'));

const caps = JSON.parse(read('src-tauri/capabilities/default.json')) as { windows: string[]; permissions: unknown[] };
for (const perm of ['core:window:allow-start-dragging', 'core:window:allow-minimize', 'core:window:allow-toggle-maximize', 'core:window:allow-close', 'core:window:allow-is-maximized']) {
  ck(`capability 含 ${perm}`, caps.permissions.includes(perm));
}
ck('capability windows 列着 chat-*', caps.windows.includes('chat-*'));

console.log(`\npopout-window-controls: ${p}/${t} passed`);
if (p !== t) process.exit(1);
