// ck-style. Which window mounts the desktop update prompt, and when it opens (owner 0.2.145:
// 设置独立成窗 #483 后,「关于 → 软件更新」显示「发现新版本 v0.2.146 · 点击查看并安装」,点了没有任何反应).
// Cause: the settings window was lumped in with detached chat windows and never mounted the prompt,
// while the manual check it ran only updated state inside its own webview — the main window is a
// separate JS context and never saw it.
// Rule now: main window = auto (startup check prompts); settings window = manual (only a check the
// user clicked in that window prompts, install happens there); chat / workspace windows = none.
import { readFileSync } from 'node:fs';
import { checkDesktopUpdate, desktopUpdateFromManualCheck, desktopUpdateSnapshot } from './desktop-updater';
import { desktopPromptMode, desktopPromptVisible } from './update-prompt-model';
import { SETTINGS_WINDOW_LABEL } from './desktop-settings-window';

let p = 0, t = 0;
const ck = (name: string, cond: boolean, detail = '') => { t++; if (cond) { p++; console.log(`PASS: ${name}`); } else console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`); };
const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

const app = read('../App.tsx');
const prompt = read('./DesktopUpdatePrompt.tsx');
const win = (o: Partial<{ chat: boolean; workspace: boolean; settings: boolean }>) => ({ tauri: true, chat: false, workspace: false, settings: false, ...o });

// (a) settings window mounts the prompt in manual mode
ck('(a) settings window → manual mode', desktopPromptMode(win({ settings: true })) === 'manual');
ck('(a) App mounts the prompt with manualOnly from that mode', app.includes("{updatePromptMode ? <DesktopUpdatePrompt manualOnly={updatePromptMode === 'manual'} /> : null}")
  && /settings: requestedSettingsWindow\(\)/.test(app));
ck('main window → auto mode', desktopPromptMode(win({})) === 'auto');
ck('no desktop shell (web / phone) → auto, as before (checks there resolve to unsupported)', desktopPromptMode({ tauri: false, chat: true, workspace: true, settings: true }) === 'auto');

// (b) chat / workspace windows still don't mount it
ck('(b) detached chat window → no prompt', desktopPromptMode(win({ chat: true })) === null);
ck('(b) workspace window → no prompt', desktopPromptMode(win({ workspace: true })) === null);
ck('(b) App reads chat + workspace query into the mode', /chat: !!requestedChatAlias\(\)/.test(app) && /workspace: !!requestedWorkspaceProfileId\(\)/.test(app));

// (c) the auto check does not prompt in the settings window
ck('(c) manualOnly skips the startup auto-check timer', /if \(manualOnly \|\| !\(globalThis as any\)\.__TAURI_INTERNALS__\) return;/.test(prompt));
ck('prompt visibility goes through desktopPromptVisible with the manual flag', prompt.includes("desktopPromptVisible(update, { mode: manualOnly ? 'manual' : 'auto', fromManualCheck: desktopUpdateFromManualCheck() })"));

const available = { kind: 'available' as const, version: '0.2.146', notes: 'n' };
ck('(c) available from an auto check: manual mode stays closed', !desktopPromptVisible(available, { mode: 'manual', fromManualCheck: false }));
ck('available from a manual check: manual mode opens', desktopPromptVisible(available, { mode: 'manual', fromManualCheck: true }));
ck('auto mode opens for either', desktopPromptVisible(available, { mode: 'auto', fromManualCheck: false }) && desktopPromptVisible(available, { mode: 'auto', fromManualCheck: true }));
ck('downloading keeps the manual prompt open', desktopPromptVisible({ kind: 'downloading', version: '0.2.146', percent: 40 }, { mode: 'manual', fromManualCheck: true }));
for (const kind of ['idle', 'checking', 'up-to-date', 'unsupported'] as const) {
  ck(`${kind}: closed in both modes`, !desktopPromptVisible({ kind }, { mode: 'manual', fromManualCheck: true }) && !desktopPromptVisible({ kind }, { mode: 'auto', fromManualCheck: true }));
}

// The flag, end to end through the real updater module (fake Tauri global, injected check).
(globalThis as any).__TAURI_INTERNALS__ = {};
const found = async () => ({ version: '0.2.146', body: 'fixture', downloadAndInstall: async () => undefined });
await checkDesktopUpdate(found);
ck('(c) auto check → available but not from a manual check', desktopUpdateSnapshot().kind === 'available' && desktopUpdateFromManualCheck() === false);
ck('(c) → settings-window prompt stays closed', !desktopPromptVisible(desktopUpdateSnapshot(), { mode: 'manual', fromManualCheck: desktopUpdateFromManualCheck() }));
await checkDesktopUpdate(found, { manual: true, minVisibleMs: 0 });
ck('(a) manual check (the settings row) → from a manual check', desktopUpdateSnapshot().kind === 'available' && desktopUpdateFromManualCheck() === true);
ck('(a) → settings-window prompt opens', desktopPromptVisible(desktopUpdateSnapshot(), { mode: 'manual', fromManualCheck: desktopUpdateFromManualCheck() }));
await checkDesktopUpdate(found);
ck('a later auto check clears the flag again', desktopUpdateFromManualCheck() === false);
// A click that lands while an auto check is in flight joins it — the user clicked, so it must show.
let release!: () => void;
const slow = () => new Promise<any>(resolve => { release = () => resolve({ version: '0.2.146', body: 'x', downloadAndInstall: async () => undefined }); });
const auto = checkDesktopUpdate(slow);
const click = checkDesktopUpdate(found, { manual: true, minVisibleMs: 0 });
release();
await Promise.all([auto, click]);
ck('manual click joining an in-flight auto check counts as manual', desktopUpdateFromManualCheck() === true);

// Install/download from the settings window needs the updater + process plugins on that label
// (a window without an ACL fails only at runtime — the 0.2.56 lesson).
const caps = JSON.parse(read('../src-tauri/capabilities/default.json')) as { windows: string[]; permissions: unknown[] };
const covers = (pattern: string, label: string) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(label);
ck(`capability windows cover the settings label (${SETTINGS_WINDOW_LABEL})`, caps.windows.some(w => covers(w, SETTINGS_WINDOW_LABEL)));
ck('that capability grants updater:default + process:allow-restart (check, download, relaunch)', caps.permissions.includes('updater:default') && caps.permissions.includes('process:allow-restart'));

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
