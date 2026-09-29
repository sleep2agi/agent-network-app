// Vincent 2026-09-29 (Android phone): 「底部 tab 的 服务器 换成 任务」. 服务器 left the phone bottom bar,
// so it must still be reachable: a 「服务器」 row at the top of the 设置 list pushes the existing server
// page, which then has a back arrow to 设置 (and system back goes there too). The two-pane rail and the
// desktop keep 服务器 as a destination, so none of this applies there.
import { readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHONE_SETTINGS_PUSHED_SCREENS, PHONE_SETTINGS_SERVER_ENTRY, navChromeFor, navActiveKey, phoneSettingsBackTarget, screenForNavPress } from './nav-chrome';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n}${extra ? ` (${extra})` : ''}`); };

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const posix = (s: string) => s.split(sep).join('/');
const read = (rel: string) => readFileSync(join(root, ...posix(rel).split('/')), 'utf8').replace(/\r\n?/g, '\n');

// ── model ──
ck('entry: key server, label 服务器, server icon', PHONE_SETTINGS_SERVER_ENTRY.key === 'server' && PHONE_SETTINGS_SERVER_ENTRY.label === '服务器' && PHONE_SETTINGS_SERVER_ENTRY.icon === 'server-outline');
ck('pushed-from-设置 screens = server', JSON.stringify(PHONE_SETTINGS_PUSHED_SCREENS) === JSON.stringify(['server']));
ck('phone: server back → settings', phoneSettingsBackTarget('phone', 'server') === 'settings');
ck('two-pane: server back is not redirected (rail destination)', phoneSettingsBackTarget('twoPane', 'server') === null);
ck('desktop: server back is not redirected', phoneSettingsBackTarget('desktop', 'server') === null);
for (const s of ['logs', 'settings', 'tasks', 'agents', 'serverNodes']) ck(`phone: ${s} is not a 设置 push`, phoneSettingsBackTarget('phone', s) === null);
ck('phone: server is a leaf (no bottom tab bar)', navChromeFor('phone', 'server') === 'none');
ck('two-pane: server keeps the rail', navChromeFor('twoPane', 'server') === 'rail');
ck('desktop: unchanged (no mobile chrome)', navChromeFor('desktop', 'server') === 'none');
ck('phone: 任务 tab opens tasks from agents', screenForNavPress('tasks', 'agents')?.name === 'tasks');
ck('phone: 任务 while on task detail → no-op (detail belongs to 任务)', navActiveKey('taskDetail') === 'tasks' && screenForNavPress('tasks', 'taskDetail') === null);
ck('phone: 设置 from the pushed server page → settings', screenForNavPress('settings', 'server')?.name === 'settings');

// ── wiring: App.tsx ──
const app = read('App.tsx');
const phoneStart = app.indexOf('<View style={styles.navShell} testID="nav-shell">');
const phoneEnd = app.indexOf('function DesktopWorkspace(');
const phone = phoneStart >= 0 && phoneEnd > phoneStart ? app.slice(phoneStart, phoneEnd) : '';
ck('collection: phone/two-pane shell found in App.tsx', phone.length > 1000, `${phone.length} chars`);
const settingsEl = phone.match(/<SettingsScreen\b[\s\S]*?\/>/)?.[0] ?? '';
ck('App: phone SettingsScreen gets onOpenServer only on the phone layout', /onOpenServer=\{layout === 'phone' \? \(\) => setScreen\(\{ name: 'server' \}\) : undefined\}/.test(settingsEl));
const serverEl = phone.match(/<ServerScreen\b[\s\S]*?\/>/)?.[0] ?? '';
ck('App: phone ServerScreen back → settings via phoneSettingsBackTarget', /onBack=\{phoneSettingsBackTarget\(layout, screen\.name\) \? \(\) => setScreen\(\{ name: 'settings' \}\) : undefined\}/.test(serverEl));
const back = app.slice(app.indexOf("addEventListener('hardwareBackPress'"), app.indexOf('return () => sub.remove();'));
ck('App: system back from the pushed server page → settings', /if \(phoneSettingsBackTarget\(layout, screen\.name\)\) \{\s*setScreen\(\{ name: 'settings' \}\);\s*return true;/.test(back));
ck('App: system back handler re-subscribes when the layout changes', /\}, \[screen, layout\]\);/.test(app));
// The logs leaf still returns to 服务器, which then returns to 设置.
ck('App: logs back still returns to server', /<LogsScreen[\s\S]*?onBack=\{\(\) => setScreen\(\{ name: 'server' \}\)\}/.test(phone));
const workspace = app.slice(phoneEnd);
const deskServer = workspace.match(/<ServerScreen\b[\s\S]*?\/>/)?.[0] ?? '';
ck('desktop: workspace ServerScreen found', deskServer.length > 0);
ck('desktop: workspace ServerScreen has no back (rail + sidebar navigate there)', !/\bonBack=/.test(deskServer));
ck('desktop: workspace SettingsScreen has no 服务器 row', !/<SettingsScreen\b[^>]*onOpenServer=/.test(workspace));

// ── wiring: SettingsScreen / ServerScreen ──
const settings = read('src/SettingsScreen.tsx');
const listStart = settings.indexOf('const phoneList = (');
const firstGroups = settings.indexOf('phoneSettingsGroups(filtered).map', listStart);
const serverRowAt = settings.indexOf('testID={`settings-row-${PHONE_SETTINGS_SERVER_ENTRY.key}`}', listStart);
ck('Settings: the 服务器 row is in the phone list', listStart >= 0 && serverRowAt > listStart);
ck('Settings: the 服务器 row is above every other group (near the top)', serverRowAt > 0 && serverRowAt < firstGroups);
ck('Settings: the row only renders when onOpenServer is passed', /\{onOpenServer \? \(\s*<View testID="settings-group-server">/.test(settings));
ck('Settings: the row uses the grouped-list row style and chevron', /onPress=\{onOpenServer\}\s*style=\{\(\{ pressed \}\) => \[styles\.phoneRow, pressed && styles\.phoneRowPressed\]\}/.test(settings) && settings.slice(serverRowAt, firstGroups).includes('chevron-forward'));
const server = read('src/ServerScreen.tsx');
ck('Server: back arrow only when onBack is passed, tagged pane-back', /\{onBack \? \(\s*<Pressable onPress=\{onBack\}[^>]*accessibilityLabel="返回设置" testID=\{PANE_BACK_TEST_ID\}/.test(server));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
