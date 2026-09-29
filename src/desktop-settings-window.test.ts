// 桌面设置单独开窗口。ck 风格，自执行。run: bun src/desktop-settings-window.test.ts
import { readFileSync } from 'node:fs';
import { SETTINGS_WINDOW_LABEL, requestedSettingsCategory, requestedSettingsWindow, settingsWindowUrl } from './desktop-settings-window';

let p = 0, t = 0;
const ck = (name: string, cond: boolean) => { t++; if (cond) { p++; console.log(`PASS: ${name}`); } else console.log(`FAIL: ${name}`); };
const read = (f: string) => readFileSync(f, 'utf8').replace(/\r\n?/g, '\n');

ck('地址只在 settings=1 时算设置窗', requestedSettingsWindow('?settings=1') && !requestedSettingsWindow('?chat=a'));
ck('分类写进地址，认不出的丢掉', settingsWindowUrl('voice') === '/?settings=1&category=voice' && settingsWindowUrl('nope') === '/?settings=1');
ck('从地址读回分类', requestedSettingsCategory('?settings=1&category=voice') === 'voice' && requestedSettingsCategory('?settings=1&category=nope') === null);
ck('窗口标签是固定的 settings', SETTINGS_WINDOW_LABEL === 'settings');

const app = read('App.tsx');
const caps = JSON.parse(read('src-tauri/capabilities/default.json')) as { windows: string[] };
ck('主窗口的设置按钮打开独立窗口，没有桌面壳才留在主窗口', app.includes('void openSettingsWindow().then(opened => { if (!opened) setScreen({ name: \'settings\' }); })') && !app.includes("onPress={() => setScreen({ name: DESKTOP_SETTINGS_TAB.key })}"));
ck('⌘, 也走独立窗口', app.includes("action.screen === 'settings'") && app.includes('void openSettingsWindow()'));
ck('桌面「去设置语音」把分类交给新窗口', app.includes("void openSettingsWindow('voice')"));
ck('设置窗只画设置页', app.includes('testID="dedicated-settings-window"') && app.includes('<SettingsScreen'));
ck('能力表放行这个窗口', caps.windows.includes('settings'));

console.log(`\ndesktop-settings-window: ${p}/${t} passed`);
if (p !== t) process.exit(1);
