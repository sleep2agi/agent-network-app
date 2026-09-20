// 2026-09-16 Vincent:「上面多余的那一行是不是可以删了」—— 去掉 macOS 原生标题栏,留红黄绿灯 + 可拖动空带。
import fs from 'node:fs';
import path from 'node:path';
import { isMacTauriShell, MAC_TITLE_STRIP_HEIGHT } from './mac-shell';
let p = 0, t = 0; const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };

const g = globalThis as any;
const saved = { tauri: g.__TAURI_INTERNALS__, nav: g.navigator };
g.__TAURI_INTERNALS__ = undefined; g.navigator = { platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh)' };
ck('no Tauri shell → not a mac shell (web/mobile untouched)', isMacTauriShell() === false);
g.__TAURI_INTERNALS__ = {}; g.navigator = { platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0)' };
ck('Tauri on Windows → no strip (native title bar kept)', isMacTauriShell() === false);
g.navigator = { platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh)' };
ck('Tauri on macOS → strip', isMacTauriShell() === true);
g.__TAURI_INTERNALS__ = saved.tauri; g.navigator = saved.nav;
ck('strip is 28px (enough for the traffic lights)', MAC_TITLE_STRIP_HEIGHT === 28);

const conf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src-tauri', 'tauri.conf.json'), 'utf8'));
const main = conf.app.windows[0];
ck('main window hides the native title bar (Overlay + hiddenTitle)', main.titleBarStyle === 'Overlay' && main.hiddenTitle === true);
const caps = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src-tauri', 'capabilities', 'default.json'), 'utf8'));
ck('capability allows start-dragging (data-tauri-drag-region needs it in Tauri 2)', caps.permissions.includes('core:window:allow-start-dragging'));
ck('capability still covers main + chat windows', (caps.windows as string[]).includes('main') && (caps.windows as string[]).includes('chat-*'));
const menu = fs.readFileSync(path.join(__dirname, 'desktop-chat-menu.ts'), 'utf8').replace(/\r\n?/g, '\n');
ck('both detached window kinds use the overlay title bar', menu.split("titleBarStyle: 'overlay'").length === 3 && menu.split('hiddenTitle: true').length === 3);
const app = fs.readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8').replace(/\r\n?/g, '\n');
// 0.2.81:Windows 自绘标题栏插在两者之间 ⇒ 判据改成「strip 在 AppRoot 之前」,
// 而不是「紧挨着 AppRoot」——否则每加一条顶部栏都要改这个 pin。
ck('App mounts the strip above AppRoot', app.indexOf('<MacTitleStrip />') > -1 && app.indexOf('<MacTitleStrip />') < app.indexOf('<AppRoot />'));
ck('0.2.81:Windows 标题栏也挂在 AppRoot 之前', app.indexOf('<WinTitleBar />') > -1 && app.indexOf('<WinTitleBar />') < app.indexOf('<AppRoot />'));
const strip = fs.readFileSync(path.join(__dirname, 'mac-title-strip.tsx'), 'utf8').replace(/\r\n?/g, '\n');
ck('strip is a drag region', strip.includes("dataSet: { tauriDragRegion: '' }"));

console.log(`\n${p}/${t} passed`); process.exit(p === t ? 0 : 1);
