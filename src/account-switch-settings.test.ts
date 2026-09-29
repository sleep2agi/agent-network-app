// 切换账号的入口与「退出登录」语义(Vincent 2026-09-29)。ck 风格,自执行,失败 exit 1。
// 行为层(存储:退出只移除当前账号、还有别的就切过去)在 session-registry.test.ts D 段;
// 这里钉 UI 接线:行在哪、手机 / 宽屏各用什么、App 退出后去哪。几何在 tests/test-account-switch/drive.mjs 实测。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { t as translate, setLanguagePreference } from './i18n';
import './i18n-accounts';
import { SETTINGS_CATEGORIES, filterSettings } from './settings-model';

let p = 0, t = 0;
const ck = (name: string, ok: boolean, extra = '') => { t++; if (ok) p++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`); };
const root = join(import.meta.dir, '..');
const read = (f: string) => readFileSync(join(root, f), 'utf8').replace(/\r\n?/g, '\n');
const settings = read('src/SettingsScreen.tsx');
const app = read('App.tsx');
const storage = read('src/storage.ts');
const switcher = read('src/AccountSwitcher.tsx');

// ── model ──
const account = SETTINGS_CATEGORIES.find(c => c.key === 'account')!;
const keys = account.rows.map(r => r.key);
ck('S1 the account category has a 切换账号 row directly above 移除当前账号 / 退出登录', keys.indexOf('switchAccount') >= 0 && keys.indexOf('switchAccount') === keys.indexOf('logout') - 1, keys.join(','));
ck('S2 searching 服务器 / switch finds it (account and server are one entry)', ['服务器', 'switch', '切换账号'].every(q => filterSettings(q).some(c => c.key === 'account' && c.rows.some(r => r.key === 'switchAccount'))));
ck('S3 it exists on every platform (phone and desktop)', ['android', 'ios', 'desktop', 'web'].every(pl => filterSettings('', {}, undefined, pl as any).some(c => c.rows.some(r => r.key === 'switchAccount'))));

// ── phone list: its own block right above 退出登录, same block style ──
const phoneSwitch = settings.indexOf('testID="settings-switch-account-block"');
const phoneLogout = settings.indexOf('testID="settings-logout-block"');
ck('S4 phone: 切换账号 block is rendered right before the 退出登录 block', phoneSwitch > 0 && phoneLogout > phoneSwitch && !settings.slice(phoneSwitch, phoneLogout).includes('testID="settings-row-'));
ck('S5 phone: same block style as 退出登录 (so edges / height line up)', settings.slice(phoneSwitch, phoneLogout).includes('[styles.phoneBlock, styles.phoneLogout, pressed && styles.phoneRowPressed]'));
ck('S6 phone: shown even when 退出登录 is hidden (local workspace)', !settings.slice(settings.lastIndexOf('\n', phoneSwitch - 200), phoneSwitch).includes('canLogout ?'));
// ── wide: a row above the 退出登录 row ──
const wideSwitch = settings.indexOf('testID="settings-switch-account-row"');
const wideLogout = settings.indexOf("show('account', 'logout') && canLogout && !compact");
ck('S7 wide/desktop: 切换账号 row sits before the 退出登录 row', wideSwitch > 0 && wideLogout > wideSwitch);
// ── the switcher ──
ck('S8 phone gets the bottom sheet, wide/desktop gets the dialog (not a phone sheet)', settings.includes("variant={compact ? 'sheet' : 'dialog'}"));
ck('S9 sheet slides from the bottom, dialog fades in the centre', switcher.includes("animationType={dialog ? 'fade' : 'slide'}") && switcher.includes("dialog ? styles.rootCenter : styles.rootBottom"));
ck('S10 rows read 「账号 @ 服务器」', switcher.includes('`${p.username || p.displayName || \'?\'} @ ${accountHost(p.serverUrl)}`'));
ck('S11 tapping another account switches with its saved token (no password step)', settings.includes('onPick={pickProfile}') && /const pickProfile = [\s\S]*?onSwitchProfile\(profile\.profileId\)/.test(settings));
ck('S12 「添加账号」 opens the login flow without signing out', settings.includes('onAdd={onAddAccount}') && /onCancelAdd=\{cfg && !reauthProfile \? \(\) => setScreen\(\{ name: 'settings' \}\) : undefined\}/.test(app));
ck('S13 移除 in the switcher goes through the existing confirm (local only)', settings.includes('onRemove={profile => setRemoveTarget('));
ck('S14 the current account is resolved for migrated sessions too (no profileId on cfg)', settings.includes('const currentId = sessionIdOf(cfg);') && storage.includes('cfg.profileId ?? (isTauriDesktop() ? undefined : LEGACY_SESSION_ID)'));
// ── 退出登录 ──
const logout = app.slice(app.indexOf('const removeActiveProfile = async'), app.indexOf('const finishLocalDataDeletion'));
ck('S15 退出登录 removes only the current account', logout.includes('await removeHubProfile(cfg.profileId)') && logout.includes('await clearConfig()'));
ck('S16 …then continues with the remaining account, or the login page when none is left', logout.includes('const next = await loadConfig();') && logout.includes("setScreen(next ? { name: 'agents' } : { name: 'login' });"));
ck('S17 phone clearConfig removes the active account only (not every saved one)', /export const clearConfig = async[\s\S]*?const index = await mobileSessions\.loadIndex\(\);\s*if \(index\.active\) await removeHubProfile\(index\.active\);/.test(storage));

// ── strings ──
const ids = ['accounts.switch', 'accounts.add', 'accounts.manage', 'accounts.remove', 'accounts.current', 'accounts.addTitle', 'accounts.cancelAdd'];
setLanguagePreference('zh');
const zh = ids.map(id => translate(id));
setLanguagePreference('en');
const en = ids.map(id => translate(id));
ck('S18 strings exist in zh and en', zh.every((v, i) => v !== ids[i] && /\p{Script=Han}/u.test(v)) && en.every((v, i) => v !== ids[i] && !/\p{Script=Han}/u.test(v)), `${zh.join('/')} | ${en.join('/')}`);

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
