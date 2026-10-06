// 修改密码 + 弱密码横幅(#653)。ck 风格,自执行,失败 exit 1。
//   run: bun src/change-password.test.ts
// 行为:强度规则与 hub 一致、表单校验、hub 失败怎么分类、POST /api/auth/password 的请求形状、成功后换令牌、
// 弱密码标记(登录记、改完清、不覆盖别的账号)。接线:登录把 must_change_password 交给标记、设置里入口与页面、
// 横幅在手机 / 桌面各自的位置。几何与真实点击在 tests/test-change-password/drive.mjs。
// 只用桩:不连任何 hub,不用真账号。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setLanguagePreference } from './i18n';
import { changePasswordFormProblem, classifyChangePasswordFailure, isCommonPassword, passwordStrengthProblem, strengthHint } from './password-policy';
import { changeHubPassword } from './change-password-api';
import { runChangePassword, strengthHintText } from './useChangePassword';
import { createWeakPasswordFlags, weakPasswordKey, WEAK_PASSWORD_STORAGE_KEY } from './weak-password-flag-core';
import { fetchStatus, login } from './api';
import { onProfileUnauthorized, reportProfileAuthResponse, clearProfileUnauthorized } from './profile-auth-state';
import { SETTINGS_CATEGORIES, SETTINGS_DETAIL_PARENT, SETTINGS_DETAIL_TITLE, clearPendingSettingsDetail, filterSettings, peekPendingSettingsDetail, rememberedSettingsView, requestSettingsDetail, resetSettingsViewMemory, settingsDetailFromQuery } from './settings-model';
import { settingsText } from './i18n-settings';
import { settingsWindowUrl, requestedSettingsDetail } from './desktop-settings-window';

let p = 0, t = 0;
const ck = (name: string, ok: boolean, extra = '') => { t++; if (ok) p++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`); };
const root = join(import.meta.dir, '..');
const read = (f: string) => readFileSync(join(root, f), 'utf8').replace(/\r\n?/g, '\n');
setLanguagePreference('zh');

// Placeholder passwords only (none of these is anyone's real password).
const STRONG = 'Plac3holder-Strong-9';
const STRONG2 = 'An0ther-Placeholder!';

// ── A. 强度规则(照抄 hub validatePasswordStrength + password-dict) ──
ck('A1 < 8 chars → too-short', passwordStrengthProblem('abc1234') === 'too-short' && passwordStrengthProblem('') === 'too-short');
ck('A2 8+ chars on the hub list → too-common (case-insensitive)', passwordStrengthProblem('password') === 'too-common' && passwordStrengthProblem('PassWord123') === 'too-common' && passwordStrengthProblem('12345678') === 'too-common');
ck('A3 generated entries: password0–999 / qwerty0–999 / 000000–000999', isCommonPassword('password999') && isCommonPassword('qwerty42') && isCommonPassword('000123') && !isCommonPassword('password1000'));
ck('A4 the bootstrap default "anethub" is short → too-short (it is what the banner is for)', passwordStrengthProblem('anethub') === 'too-short');
ck('A5 a long uncommon password passes', passwordStrengthProblem(STRONG) === null);
ck('A6 hint: empty → rule, short → too-short, common → too-common, good → ok', strengthHint('') === 'rule' && strengthHint('abc') === 'too-short' && strengthHint('iloveyou') === 'too-common' && strengthHint(STRONG) === 'ok');
ck('A7 hint text counts the missing characters', strengthHintText('too-short', 'abc12') === '还差 3 个字符（至少 8 个）', strengthHintText('too-short', 'abc12'));
// The hub's own words. If a hub change renames them, classification below falls to 'server' and this pins why.
const HUB_SHORT = 'new password must be at least 8 characters';
const HUB_COMMON = 'new password is too common';
const HUB_WRONG = 'incorrect current password';

// ── B. 表单校验(不发请求) ──
const F = (current: string, next: string, confirm = next) => ({ current, next, confirm });
ck('B1 current password required first', changePasswordFormProblem(F('', STRONG)) === 'current-required');
ck('B2 weak new password: too short', changePasswordFormProblem(F('old-placeholder', 'short1')) === 'too-short');
ck('B3 weak new password: too common', changePasswordFormProblem(F('old-placeholder', 'sunshine')) === 'too-common');
ck('B4 mismatch', changePasswordFormProblem(F('old-placeholder', STRONG, STRONG2)) === 'mismatch');
ck('B5 same as current', changePasswordFormProblem(F(STRONG, STRONG)) === 'same-as-current');
ck('B6 valid form → null', changePasswordFormProblem(F('old-placeholder', STRONG)) === null);

// ── C. hub 失败分类 ──
ck('C1 400 incorrect current password → wrong-current', classifyChangePasswordFailure({ network: false, status: 400, error: HUB_WRONG }) === 'wrong-current');
ck('C2 400 at least 8 characters → too-short', classifyChangePasswordFailure({ network: false, status: 400, error: HUB_SHORT }) === 'too-short');
ck('C3 400 too common → too-common', classifyChangePasswordFailure({ network: false, status: 400, error: HUB_COMMON }) === 'too-common');
ck('C4 401 → signed-out', classifyChangePasswordFailure({ network: false, status: 401, error: 'invalid token' }) === 'signed-out');
ck('C5 fetch threw → network', classifyChangePasswordFailure({ network: true }) === 'network');
ck('C6 500 / 403 / unknown → server', classifyChangePasswordFailure({ network: false, status: 500, error: 'boom' }) === 'server' && classifyChangePasswordFailure({ network: false, status: 403, error: 'user_token_required' }) === 'server');

// ── D. 请求形状 + 结果(fetch 桩) ──
const g = globalThis as any;
const realFetch = g.fetch;
type Reply = { status: number; body: string } | 'throw';
let reply: Reply = { status: 200, body: '{}' };
const calls: { url: string; method: string; auth: string | undefined; body: any }[] = [];
g.fetch = async (url: string, init: any) => {
  const h = init?.headers ?? {};
  calls.push({ url: String(url), method: init?.method ?? 'GET', auth: h.Authorization ?? h.authorization, body: init?.body ? JSON.parse(init.body) : null });
  if (reply === 'throw') throw new TypeError('Failed to fetch');
  const r = reply;
  return { ok: r.status < 300, status: r.status, text: async () => r.body, json: async () => JSON.parse(r.body) };
};
const cfg = { serverUrl: 'http://hub.invalid', token: 'utok_placeholder_old' };
{
  calls.length = 0;
  reply = { status: 200, body: JSON.stringify({ ok: true, revoked: 2, token: 'utok_placeholder_new', token_id: 'tok_new' }) };
  const r = await changeHubPassword(cfg, 'old-placeholder', STRONG);
  const c = calls[0];
  ck('D1 POST /api/auth/password with the bearer token and {old_password,new_password}', !!c && c.method === 'POST' && c.url === 'http://hub.invalid/api/auth/password' && c.auth === 'Bearer utok_placeholder_old' && c.body?.old_password === 'old-placeholder' && c.body?.new_password === STRONG && Object.keys(c.body).length === 2);
  ck('D2 success carries the new token and revoked count (the hub revokes the token it was called with)', r.ok && r.token === 'utok_placeholder_new' && r.revoked === 2);
}
{
  reply = { status: 200, body: JSON.stringify({ ok: true }) };
  const r = await changeHubPassword(cfg, 'old-placeholder', STRONG);
  ck('D3 an older hub without a token in the reply → ok, no token (keep the current one)', r.ok && !('token' in r));
}
{
  reply = { status: 400, body: JSON.stringify({ ok: false, error: HUB_WRONG }) };
  const r = await changeHubPassword(cfg, 'wrong-placeholder', STRONG);
  ck('D4 wrong current password → kind wrong-current', !r.ok && r.kind === 'wrong-current');
  reply = { status: 400, body: JSON.stringify({ ok: false, error: HUB_COMMON }) };
  const w = await changeHubPassword(cfg, 'old-placeholder', 'some-list-word');
  ck('D5 hub says too common (its list may be newer than ours) → kind too-common', !w.ok && w.kind === 'too-common');
  reply = 'throw';
  const n = await changeHubPassword(cfg, 'old-placeholder', STRONG);
  ck('D6 network error → kind network', !n.ok && n.kind === 'network');
  reply = { status: 502, body: '<html>bad gateway</html>' };
  const s = await changeHubPassword(cfg, 'old-placeholder', STRONG);
  ck('D7 non-JSON 502 → kind server', !s.ok && s.kind === 'server');
}

// ── E. 一次完整的提交(runChangePassword:校验 → 请求 → 换令牌) ──
{
  calls.length = 0;
  reply = { status: 200, body: JSON.stringify({ ok: true, revoked: 1, token: 'utok_placeholder_new' }) };
  let got: string | undefined | null = null;
  const out = await runChangePassword(cfg, F('old-placeholder', STRONG), async token => { got = token; });
  ck('E1 success: onChanged gets the new token, outcome ok', out.ok && got === 'utok_placeholder_new' && calls.length === 1);
}
{
  calls.length = 0;
  reply = { status: 400, body: JSON.stringify({ ok: false, error: HUB_WRONG }) };
  let changed = false;
  const out = await runChangePassword(cfg, F('wrong-placeholder', STRONG), async () => { changed = true; });
  ck('E2 wrong old password: error says so, current field is cleared, nothing saved', !out.ok && out.error === '当前密码不对，请重新输入' && out.clearCurrent === true && !changed);
}
{
  calls.length = 0;
  const out = await runChangePassword(cfg, F('old-placeholder', 'qwerty123'), async () => {});
  ck('E3 weak new password: rejected locally, no request', !out.ok && out.error === '新密码太简单（是常见密码），换一个' && calls.length === 0);
  const short = await runChangePassword(cfg, F('old-placeholder', 'abc'), async () => {});
  ck('E4 short new password: rejected locally', !short.ok && short.error === '新密码至少 8 个字符' && calls.length === 0);
}
{
  calls.length = 0;
  const out = await runChangePassword(cfg, F('old-placeholder', STRONG, STRONG2), async () => {});
  ck('E5 mismatch: rejected locally, no request', !out.ok && out.error === '两次输入的新密码不一致' && calls.length === 0);
}
{
  reply = 'throw';
  const out = await runChangePassword(cfg, F('old-placeholder', STRONG), async () => {});
  ck('E6 network error: says the password was not changed', !out.ok && out.error.startsWith('连不上服务器，密码没有修改'));
  reply = { status: 200, body: JSON.stringify({ ok: true, token: 'utok_placeholder_new' }) };
  const save = await runChangePassword(cfg, F('old-placeholder', STRONG), async () => { throw new Error('keychain locked'); });
  ck('E7 changed but this device could not store the new token → says so (sign in again)', !save.ok && save.error.includes('keychain locked') && save.error.includes('重新登录'));
}

// ── F. 登录把 must_change_password 交出来 ──
{
  const loginReply = (extra: object) => async (url: string) => {
    const u = String(url);
    const body = u.endsWith('/api/auth/login') ? { ok: true, token: 'utok_placeholder_login', ...extra } : { ok: true, user: { username: 'tester' }, networks: [{ network_id: 'net_x' }] };
    return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body };
  };
  g.fetch = loginReply({ must_change_password: true });
  const weak = await login('http://hub-a.invalid', 'tester', 'pw-placeholder');
  g.fetch = loginReply({});
  const fine = await login('http://hub-b.invalid', 'tester', 'pw-placeholder');
  ck('F1 login: must_change_password true → mustChangePassword true; absent → false', weak.ok && weak.mustChangePassword === true && fine.ok && fine.mustChangePassword === false);
}
g.fetch = realFetch;

// ── G. 弱密码标记(横幅出现 / 消失的依据) ──
{
  const disk = new Map<string, string>();
  disk.set(WEAK_PASSWORD_STORAGE_KEY, JSON.stringify([weakPasswordKey({ serverUrl: 'https://other.invalid', username: 'bob' })]));
  const kv = { get: async (k: string) => disk.get(k) ?? null, set: async (k: string, v: string) => { disk.set(k, v); } };
  const flags = createWeakPasswordFlags(kv);
  let notified = 0;
  flags.subscribe(() => { notified++; });
  const alice = { serverUrl: 'https://hub.invalid/', username: 'alice' };
  ck('G1 key: trailing slash and case of the hub address do not matter; no username → no key', weakPasswordKey(alice) === weakPasswordKey({ serverUrl: 'HTTPS://HUB.invalid', username: 'alice' }) && weakPasswordKey({ serverUrl: 'https://hub.invalid', username: '' }) === null);
  await flags.recordLogin(alice, true);
  ck('G2 weak login → flagged (banner shows), listeners told', flags.isFlagged(alice) && flags.isFlagged({ serverUrl: 'https://hub.invalid', username: 'alice' }) && notified > 0);
  ck('G3 recording one account before hydrate kept the other account already on disk', flags.isFlagged({ serverUrl: 'https://other.invalid', username: 'bob' }) && JSON.parse(disk.get(WEAK_PASSWORD_STORAGE_KEY)!).length === 2);
  ck('G4 other users on the same hub are not flagged', !flags.isFlagged({ serverUrl: 'https://hub.invalid', username: 'carol' }) && !flags.isFlagged(null));
  await flags.clear(alice);
  ck('G5 after a successful change → cleared (banner gone) and persisted', !flags.isFlagged(alice) && !JSON.parse(disk.get(WEAK_PASSWORD_STORAGE_KEY)!).includes(weakPasswordKey(alice)));
  await flags.recordLogin(alice, true);
  await flags.recordLogin(alice, false);
  ck('G6 a later normal login (changed elsewhere) clears it too', !flags.isFlagged(alice));
  const fresh = createWeakPasswordFlags(kv);
  await fresh.hydrate();
  ck('G7 a new window / restart reads it back from storage', fresh.isFlagged({ serverUrl: 'https://other.invalid', username: 'bob' }) && !fresh.isFlagged(alice));
  const broken = createWeakPasswordFlags({ get: async () => '{not json', set: async () => { throw new Error('read-only'); } });
  await broken.hydrate();
  await broken.recordLogin(alice, true);
  ck('G8 corrupt storage / failing writes: still works for this session', broken.isFlagged(alice));
}

// ── H. 设置模型:入口、三级页、从外面直接打开 ──
{
  const account = SETTINGS_CATEGORIES.find(c => c.key === 'account')!;
  ck('H1 账号 has a 修改密码 row, searchable by 密码 / password', account.rows.some(r => r.key === 'changePassword') && filterSettings('密码').some(c => c.key === 'account' && c.rows.some(r => r.key === 'changePassword')) && filterSettings('password').some(c => c.rows.some(r => r.key === 'changePassword')));
  ck('H2 detail page changePassword belongs to 账号, title 修改密码 (translated)', SETTINGS_DETAIL_PARENT.changePassword === 'account' && SETTINGS_DETAIL_TITLE.changePassword === '修改密码' && settingsText('修改密码') === '修改密码');
  resetSettingsViewMemory();
  requestSettingsDetail('changePassword');
  const view = rememberedSettingsView();
  ck('H3 banner → requestSettingsDetail: category and phone page become 账号, the detail is pending once', view.category === 'account' && view.page === 'account' && peekPendingSettingsDetail() === 'changePassword');
  clearPendingSettingsDetail();
  ck('H4 cleared after the settings screen read it', peekPendingSettingsDetail() === null);
  ck('H5 desktop settings window URL carries detail=changePassword; unknown details are dropped', settingsWindowUrl('account', 'changePassword') === '/?settings=1&category=account&detail=changePassword' && settingsWindowUrl('account', 'nope') === '/?settings=1&category=account' && requestedSettingsDetail('?settings=1&category=account&detail=changePassword') === 'changePassword' && settingsDetailFromQuery('toString') === null);
  resetSettingsViewMemory();
}

// ── I. 接线(静态) ──
{
  const app = read('App.tsx');
  const settings = read('src/SettingsScreen.tsx');
  const phone = read('src/SettingsPhonePages.tsx');
  const edit = read('src/SettingsEditPages.tsx');
  const banner = read('src/WeakPasswordBanner.tsx');
  const panel = read('src/ChangePasswordPanel.tsx');
  ck('I1 login screen records must_change_password before entering the workspace', /recordLogin\(result\.cfg, result\.mustChangePassword\)[\s\S]{0,80}await onLogin\(result\.cfg\)/.test(app));
  ck('I2 phone banner sits in navContent before the screens, only on tab home screens, and opens 修改密码', /styles\.navContent[\s\S]{0,400}PHONE_BANNER_SCREENS\.has\(screen\.name\)[\s\S]{0,200}<WeakPasswordBanner cfg=\{cfg\} onOpen=\{\(\) => \{ requestSettingsDetail\('changePassword'\); setScreen\(\{ name: 'settings' \}\); \}\} \/>[\s\S]{0,40}\{twoPaneSelection \?/.test(app) && !/new Set\(\[[^\]]*'chat'/.test(app.match(/PHONE_BANNER_SCREENS[^;]*;/)?.[0] ?? ''));
  ck('I3 desktop banner tops the content column and opens the settings window on 修改密码', /<View style=\{desktopStyles\.content\}>[\s\S]{0,200}<WeakPasswordBanner cfg=\{cfg\} desktop onOpen=\{\(\) => \{ void openSettingsWindow\('account', 'changePassword'\)/.test(app));
  ck('I4 settings window boot / category event honour the detail', app.includes('const detail = requestedSettingsDetail();') && app.includes('const detail = settingsDetailFromQuery(event.payload?.detail);'));
  ck('I5 success: clear the flag, store the new token for this account, reload it in place, toast 密码已修改', /weakPasswordFlags\.clear\(cfg\)[\s\S]{0,120}saveConfig\(\{ \.\.\.cfg, token \}\)[\s\S]{0,400}onProfileEdited \?\? onSwitchProfile[\s\S]{0,200}setToast\(tr\('password\.done'\)\)/.test(settings));
  ck('I6 wide: 安全 group has the 修改密码 row; its page replaces the account section', settings.includes('testID="settings-change-password-row"') && settings.includes('<ChangePasswordPanel pw={password} weak={weakPassword}') && settings.includes("!showWideDevices && !showWidePassword ? ("));
  ck('I7 phone: account sub-page row → detail page with the three fields', phone.includes('testID="settings-change-password"') && phone.includes("ctx.detail === 'changePassword' && ctx.canChangePassword ? <ChangePasswordEditPage ctx={ctx} />") && ['change-password-current', 'change-password-new', 'change-password-confirm'].every(id => edit.includes(`testID="${id}"`)));
  ck('I8 not offered for the local workspace account', settings.includes('const canChangePassword = cfg.profileId !== LOCAL_HUB_PROFILE_ID;'));
  ck('I9 theme blue only: banner and panel use accent / tonalBg tokens, no literal colours', !/['"]#[0-9a-f]{3,8}['"]|rgba?\(/i.test(banner + panel) && banner.includes('colors.tonalBg') && banner.includes('colors.accent'));
  ck('I10 banner text is the owner\'s wording', read('src/i18n-password.ts').includes("'password.weakBanner': ['当前密码过于简单，请修改'") && read('src/i18n-password.ts').includes("'password.done': ['密码已修改'"));
}

// ── J. N1:hub 在改密码时吊销旧令牌 —— 同时在飞的请求拿旧令牌回 401,不许把人踢回登录页 ──
{
  const PID = 'p-rotate';
  const OLD = 'utok_placeholder_rot_old', NEW = 'utok_placeholder_rot_new';
  const rcfg = { serverUrl: 'http://hub-rot.invalid', token: OLD, profileId: PID, networkId: 'net_x' };
  const kicked: string[] = [];
  const off = onProfileUnauthorized(id => { kicked.push(id); });
  // the hub's view: OLD is live until the password POST, then only NEW is.
  let live = new Set([OLD]);
  const statusCalls: number[] = [];
  g.fetch = async (url: string, init: any) => {
    const tok = String(init?.headers?.Authorization ?? '').replace('Bearer ', '');
    const ok = live.has(tok);
    const status = ok ? 200 : 401;
    if (String(url).includes('/api/status')) statusCalls.push(status);
    const body = ok ? { sessions: [] } : { ok: false, error: 'invalid token' };
    return { ok, status, headers: { get: () => null }, text: async () => JSON.stringify(body), json: async () => body };
  };
  let concurrent: Promise<unknown> | null = null;
  const api = async () => {
    live = new Set([NEW]); // revoked during the POST …
    concurrent = fetchStatus(rcfg).catch(() => null); // … while a poll with the old token is in flight
    await concurrent;
    return { ok: true as const, token: NEW, revoked: 3 };
  };
  let saved: string | undefined;
  const out = await runChangePassword(rcfg, F('old-placeholder', STRONG), async token => { saved = token; }, api);
  ck('J1 a request that 401s on the old token during the change does not log the user out', out.ok && saved === NEW && statusCalls.includes(401) && kicked.length === 0, JSON.stringify({ statusCalls, kicked }));
  await fetchStatus(rcfg).catch(() => null);
  ck('J2 a late request still holding the old token after the change: 401 ignored too', kicked.length === 0);
  const after = await fetchStatus({ ...rcfg, token: NEW }).then(() => true, () => false);
  ck('J3 the new token reads fine (user stays signed in)', after && kicked.length === 0);
  live = new Set();
  await fetchStatus({ ...rcfg, token: NEW }).catch(() => null);
  ck('J4 a 401 on the NEW token still logs out', kicked.length === 1 && kicked[0] === PID);
  clearProfileUnauthorized(PID);
  // failed change: the old token was never revoked, so its 401 means what it always meant.
  const PID2 = 'p-rotate-fail';
  const fcfg = { ...rcfg, profileId: PID2, token: 'utok_placeholder_fail' };
  const failed = await runChangePassword(fcfg, F('wrong-placeholder', STRONG), async () => {}, async () => ({ ok: false as const, kind: 'wrong-current' as const, message: 'incorrect current password' }));
  reportProfileAuthResponse(401, PID2, undefined, fcfg.token);
  ck('J5 after a failed change the old token is not exempt any more (its 401 is reported)', !failed.ok && kicked.includes(PID2));
  const OLDHUB = 'p-rotate-oldhub';
  const ocfg = { ...rcfg, profileId: OLDHUB, token: 'utok_placeholder_oldhub' };
  await runChangePassword(ocfg, F('old-placeholder', STRONG), async () => {}, async () => ({ ok: true as const }));
  reportProfileAuthResponse(401, OLDHUB, undefined, ocfg.token);
  ck('J6 an older hub that returns no new token (and revokes nothing): the kept token is not exempt', kicked.includes(OLDHUB));
  off();
  g.fetch = realFetch;
  ck('J7 both 401 reporters pass the token they used', read('src/api.ts').includes("expired ? 'token_expired' : undefined, cfg.token);") && read('src/login-sessions-api.ts').includes("'token_expired' : undefined, cfg.token);"));
}

// ── K. N7:本地工作区账号到不了修改密码页 ──
{
  const phone = read('src/SettingsPhonePages.tsx');
  const settings = read('src/SettingsScreen.tsx');
  ck('K1 phone router renders the page only when canChangePassword', phone.includes("ctx.detail === 'changePassword' && ctx.canChangePassword ? <ChangePasswordEditPage ctx={ctx} />") && !/ctx\.detail === 'changePassword' \?/.test(phone));
  ck('K2 a deep link (banner / detail=changePassword) for the local account is dropped, wide page gated too', settings.includes("initialDetail === 'changePassword' && cfg.profileId === LOCAL_HUB_PROFILE_ID ? null : initialDetail") && /const showWidePassword = [^;]*canChangePassword/.test(settings));
}

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
