// 登录设备 + 登录过期(安全审计 2026-09-29;hub 侧 agent-network 的 /api/auth/sessions)。ck 风格,自执行,失败 exit 1。
//   run: bun src/login-sessions.test.ts
// 行为:响应怎么解释(🔴 旧 hub 对未知路径回 200 纯文本,不是 404)、设备怎么称呼、时间怎么说、
// 401 token_expired 怎么变成「登录已过期」、切换账号面板怎么验别的账号。接线:设置里入口在哪、
// 旧 hub 上不出现、手机 / 宽屏各自的画法。几何在 tests/test-login-devices/drive.mjs 实测。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setLanguagePreference, t as translate } from './i18n';
import {
  clientLabelForLogin, describeDevice, interpretSessionsResponse, isTokenExpiredBody, lastUsedText, orderSessions,
  groupSessions, groupSubtitle, memberSubtitle, otherSessionCount, probeSavedSessionsWith, sessionGroupKey, sessionSubtitle, visibleSessions,
  SESSIONS_VISIBLE_DEFAULT, type LoginSession,
} from './login-sessions';
import { clearProfileUnauthorized, onProfileUnauthorized, profileUnauthorizedReason, reportProfileAuthResponse } from './profile-auth-state';
import { authProfileId, fetchHubNodes, login } from './api';
import { fetchLoginSessions, revokeLoginSession, revokeOtherLoginSessions } from './login-sessions-api';
import { SETTINGS_CATEGORIES, SETTINGS_DETAIL_PARENT, SETTINGS_DETAIL_TITLE, filterSettings } from './settings-model';
import { settingsText } from './i18n-settings';

let p = 0, t = 0;
const ck = (name: string, ok: boolean, extra = '') => { t++; if (ok) p++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`); };
const root = join(import.meta.dir, '..');
const read = (f: string) => readFileSync(join(root, f), 'utf8').replace(/\r\n?/g, '\n');
setLanguagePreference('zh');

const S = (o: Partial<LoginSession>): LoginSession => ({ token_id: 'tok_x', name: 'user-login', created_at: '2026-09-01 00:00:00', last_used_at: null, client_label: null, user_agent: null, is_current: false, ...o });
const NOW = Date.parse('2026-09-30T12:00:00Z');

// ── A. 响应解释 ──
const okBody = JSON.stringify({ ok: true, current_token_id: 'tok_a', idle_timeout_days: 30, sessions: [
  { token_id: 'tok_a', name: 'user-login', created_at: '2026-09-30 08:00:00', last_used_at: '2026-09-30 11:00:00', client_label: 'macOS · 0.2.155', user_agent: 'x', is_current: true },
  { token_id: 'tok_b', name: 'user-login', created_at: '2026-09-20 08:00:00', last_used_at: null, client_label: null, user_agent: null, is_current: false },
  { name: 'broken row without id' },
] });
const a1 = interpretSessionsResponse(200, okBody);
ck('A1 200 + ok JSON → ok, rows parsed, row without token_id dropped', a1.kind === 'ok' && a1.sessions.length === 2 && a1.sessions[0].is_current && a1.idleDays === 30);
const helpPage = 'CommHub MCP Server v0.9.0-preview.68 (Streamable HTTP + SSE Push)\n\nEndpoints:\n  POST /mcp';
ck('A2 🔴 old hub: 200 text/plain help page → unsupported (not ok, not error)', interpretSessionsResponse(200, helpPage).kind === 'unsupported');
ck('A3 404 → unsupported', interpretSessionsResponse(404, '{"ok":false,"error":"not found"}').kind === 'unsupported');
ck('A4 200 JSON without a sessions array → unsupported', interpretSessionsResponse(200, '{"ok":true,"tokens":[]}').kind === 'unsupported');
const a5 = interpretSessionsResponse(401, '{"ok":false,"error":"token_expired","message":"expired"}');
ck('A5 401 → error (the page shows it; the account flow handles the re-login)', a5.kind === 'error' && a5.message === 'expired');
ck('A6 403 user_token_required → error, not unsupported', interpretSessionsResponse(403, '{"ok":false,"error":"user_token_required"}').kind === 'error');
ck('A7 isTokenExpiredBody only for error=token_expired', isTokenExpiredBody({ error: 'token_expired' }) && !isTokenExpiredBody({ error: 'invalid token' }) && !isTokenExpiredBody(null) && !isTokenExpiredBody('token_expired'));

// ── B. 排序 / 截断 / 计数 ──
const list = [
  S({ token_id: 'old', last_used_at: '2026-09-01 00:00:00' }),
  S({ token_id: 'cur', last_used_at: '2026-09-10 00:00:00', is_current: true }),
  S({ token_id: 'new', last_used_at: '2026-09-29 00:00:00' }),
  S({ token_id: 'never', created_at: '2026-09-20 00:00:00' }),
];
ck('B1 this device first, then most recently used (never-used by created_at)', orderSessions(list).map(s => s.token_id).join(',') === 'cur,new,never,old', orderSessions(list).map(s => s.token_id).join(','));
const many = Array.from({ length: 45 }, (_, i) => S({ token_id: `t${i}` }));
ck('B2 long lists show the first 20 until 显示全部', visibleSessions(many, false).length === SESSIONS_VISIBLE_DEFAULT && visibleSessions(many, true).length === 45);
ck('B3 other-device count excludes this device', otherSessionCount(list) === 3);

// ── C. 设备称呼 ──
ck('C1 client_label wins', describeDevice(S({ client_label: 'Android · 0.2.155', user_agent: 'okhttp/4' })).label === 'Android · 0.2.155' && describeDevice(S({ client_label: 'Android · 0.2.155' })).kind === 'phone');
ck('C2 desktop / web labels get desktop / browser icons', describeDevice(S({ client_label: 'macOS · 0.2.155' })).kind === 'desktop' && describeDevice(S({ client_label: 'Web · 0.2.155' })).kind === 'browser');
ck('C3 old tokens: okhttp UA → Android App', describeDevice(S({ user_agent: 'okhttp/4.12.0' })).label === 'Android App');
const chromeMac = describeDevice(S({ user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' }));
ck('C4 desktop browser UA → 「Chrome · macOS」, browser icon', chromeMac.label === 'Chrome · macOS' && chromeMac.kind === 'browser', chromeMac.label);
ck('C5 node / undici UA → 命令行或脚本', describeDevice(S({ user_agent: 'node' })).label === '命令行或脚本' && describeDevice(S({ user_agent: 'undici' })).kind === 'terminal');
ck('C6 nothing known → 未知设备', describeDevice(S({})).label === '未知设备' && describeDevice(S({ user_agent: 'weird/1' })).kind === 'unknown');
ck('C7 login self-label per platform (not translated)', [
  clientLabelForLogin({ os: 'android', shell: null, version: '1.2.3' }) === 'Android · 1.2.3',
  clientLabelForLogin({ os: 'ios', shell: null, version: '1.2.3' }) === 'iOS · 1.2.3',
  clientLabelForLogin({ os: 'web', shell: 'mac', version: '1.2.3' }) === 'macOS · 1.2.3',
  clientLabelForLogin({ os: 'web', shell: 'windows', version: '1.2.3' }) === 'Windows · 1.2.3',
  clientLabelForLogin({ os: 'web', shell: 'other', version: '1.2.3' }) === 'Linux · 1.2.3',
  clientLabelForLogin({ os: 'web', shell: null, version: '1.2.3' }) === 'Web · 1.2.3',
].every(Boolean));

// ── D. 时间 ──
const ago = (ms: number) => new Date(NOW - ms).toISOString().replace('T', ' ').slice(0, 19);
ck('D1 zh: 刚刚 / 分钟前 / 小时前 / 天前 (hub UTC strings)', [
  lastUsedText(S({ last_used_at: ago(20_000) }), NOW) === '刚刚',
  lastUsedText(S({ last_used_at: ago(5 * 60_000) }), NOW) === '5 分钟前',
  lastUsedText(S({ last_used_at: ago(3 * 3600_000) }), NOW) === '3 小时前',
  lastUsedText(S({ last_used_at: ago(4 * 86400_000) }), NOW) === '4 天前',
].every(Boolean), lastUsedText(S({ last_used_at: ago(3 * 3600_000) }), NOW));
ck('D2 never used → counts from created_at', lastUsedText(S({ created_at: ago(2 * 86400_000) }), NOW) === '2 天前');
ck('D3 subtitle: 正在使用 for this device (本机 is already the badge / value), 最近使用 … for others', sessionSubtitle(S({ is_current: true }), NOW) === '正在使用' && sessionSubtitle(S({ last_used_at: ago(3 * 3600_000) }), NOW) === '最近使用 3 小时前');
setLanguagePreference('en');
ck('D4 en', lastUsedText(S({ last_used_at: ago(3 * 3600_000) }), NOW) === '3 h ago' && sessionSubtitle(S({ is_current: true }), NOW) === 'In use now' && describeDevice(S({})).label === 'Unknown device');
setLanguagePreference('zh');

// ── E. 401 的原因 ──
const events: string[] = [];
const off = onProfileUnauthorized((id, reason) => events.push(`${id}:${reason ?? '-'}`));
reportProfileAuthResponse(401, 'p1', 'token_expired');
ck('E1 reason travels with the 401 and is readable until re-login', events.includes('p1:token_expired') && profileUnauthorizedReason('p1') === 'token_expired');
clearProfileUnauthorized('p1');
ck('E2 signing in again clears it', profileUnauthorizedReason('p1') === undefined);
ck('E3 migrated phone account (no profileId) reports as legacy, same id the account list uses', authProfileId({}) === 'legacy' && authProfileId({ profileId: 'x' }) === 'x');

const g = globalThis as { fetch: unknown };
const realFetch = g.fetch;
{
  events.length = 0;
  g.fetch = async () => ({ ok: false, status: 401, json: async () => ({ ok: false, error: 'token_expired' }), text: async () => '' });
  await fetchHubNodes({ serverUrl: 'http://h', token: 't', profileId: 'p2' }).catch(() => {});
  ck('E4 polling read: 401 token_expired → reported as token_expired', events.includes('p2:token_expired'), events.join(','));
  events.length = 0;
  g.fetch = async () => ({ ok: false, status: 401, json: async () => ({ ok: false, error: 'invalid token' }), text: async () => '' });
  await fetchHubNodes({ serverUrl: 'http://h', token: 't', profileId: 'p3' }).catch(() => {});
  ck('E5 other 401 → reported without a reason (generic re-verify)', events.includes('p3:-'), events.join(','));
  events.length = 0;
  g.fetch = async () => ({ ok: false, status: 401, json: async () => ({ ok: false, error: 'token_expired' }), text: async () => '' });
  await fetchHubNodes({ serverUrl: 'http://h', token: 't' }).catch(() => {});
  ck('E6 🔴 migrated phone account without profileId is no longer ignored', events.includes('legacy:token_expired'), events.join(','));
  clearProfileUnauthorized('legacy'); clearProfileUnauthorized('p2'); clearProfileUnauthorized('p3');
}
off();

// ── F. hub 调用 ──
{
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  let reply: { status: number; body: string } = { status: 200, body: okBody };
  g.fetch = async (url: string, init: any) => { calls.push({ url, method: init?.method ?? 'GET', body: init?.body }); return { ok: reply.status < 300, status: reply.status, text: async () => reply.body, json: async () => JSON.parse(reply.body) }; };
  const cfg = { serverUrl: 'http://h', token: 'utok_1', profileId: 'p4' };
  const l = await fetchLoginSessions(cfg);
  ck('F1 GET /api/auth/sessions', l.kind === 'ok' && calls[0].url === 'http://h/api/auth/sessions' && calls[0].method === 'GET');
  reply = { status: 200, body: helpPage };
  ck('F2 old hub → unsupported (entry hidden)', (await fetchLoginSessions(cfg)).kind === 'unsupported');
  reply = { status: 200, body: '{"ok":true,"was_current":false}' };
  const r1 = await revokeLoginSession(cfg, 'tok b/c');
  ck('F3 DELETE /api/auth/sessions/:id (id encoded)', r1.ok && calls.at(-1)!.method === 'DELETE' && calls.at(-1)!.url === 'http://h/api/auth/sessions/tok%20b%2Fc');
  reply = { status: 200, body: '{"ok":true,"revoked":3,"kept_token_id":"tok_a"}' };
  const r2 = await revokeOtherLoginSessions(cfg);
  ck('F4 POST /api/auth/sessions/revoke-others → revoked count', r2.ok && (r2 as any).revoked === 3 && calls.at(-1)!.method === 'POST' && calls.at(-1)!.url.endsWith('/api/auth/sessions/revoke-others'));
  reply = { status: 404, body: '{"ok":false,"error":"session_not_found"}' };
  const r3 = await revokeLoginSession(cfg, 'gone');
  ck('F5 failure surfaces the hub error', !r3.ok && (r3 as any).error === 'session_not_found');
  reply = { status: 200, body: '{"ok":true,"token":"utok_new","token_id":"tok_new"}' };
  calls.length = 0;
  await login('http://h', 'u', 'pw', 'Android · 0.2.155');
  const loginCall = calls.find(c => c.url.endsWith('/api/auth/login'));
  ck('F6 login sends client_label', !!loginCall && JSON.parse(loginCall.body!).client_label === 'Android · 0.2.155');
  calls.length = 0;
  await login('http://h', 'u', 'pw');
  ck('F7 …and omits it when not given (old callers unchanged)', !('client_label' in JSON.parse(calls.find(c => c.url.endsWith('/api/auth/login'))!.body!)));
}
g.fetch = realFetch;

// ── G. 切换账号面板验别的账号 ──
{
  const marked: string[] = [];
  const statuses: Record<string, number | null> = { expired: 401, fine: 200, down: null, broken: 500 };
  const res = await probeSavedSessionsWith(
    [{ profileId: 'cur' }, { profileId: 'local-workspace' }, { profileId: 'expired' }, { profileId: 'fine' }, { profileId: 'down' }, { profileId: 'broken' }, { profileId: 'already', requiresReauth: true }, { profileId: 'nocreds' }, { profileId: 'throws' }],
    ['cur', 'local-workspace'],
    {
      load: async id => { if (id === 'nocreds') return null; if (id === 'throws') throw new Error('keychain'); return { serverUrl: 'http://h', token: id }; },
      status: async c => statuses[c.token] ?? 200,
      mark: async id => { marked.push(id); },
    },
  );
  ck('G1 only a 401 marks an account as needing re-login', res.join(',') === 'expired' && marked.join(',') === 'expired', res.join(','));
  const probed: string[] = [];
  await probeSavedSessionsWith([{ profileId: 'cur' }, { profileId: 'local-workspace' }, { profileId: 'already', requiresReauth: true }], ['cur', 'local-workspace'], {
    load: async id => { probed.push(id); return { serverUrl: 'h', token: 't' }; }, status: async () => 401, mark: async () => {},
  });
  ck('G2 current account, local workspace and already-flagged accounts are not probed', probed.length === 0);
}

// ── H. 接线 ──
const settings = read('src/SettingsScreen.tsx');
const phone = read('src/SettingsPhonePages.tsx');
const app = read('App.tsx');
const account = SETTINGS_CATEGORIES.find(c => c.key === 'account')!;
const keys = account.rows.map(r => r.key);
ck('H1 account category has 登录设备 after 添加账号 and before 切换账号 / 移除当前账号', keys.indexOf('devices') === keys.indexOf('addAccount') + 1 && keys.indexOf('switchAccount') === keys.indexOf('logout') - 1, keys.join(','));
ck('H2 on every platform; searchable in both languages', ['android', 'ios', 'desktop', 'web'].every(pl => filterSettings('', {}, undefined, pl as any).some(c => c.rows.some(r => r.key === 'devices'))) && ['登录设备', '退出其他设备', 'sessions', 'signed-in'].every(q => filterSettings(q).some(c => c.rows.some(r => r.key === 'devices'))));
ck('H3 phone: 三级页 under 账号, title translated', SETTINGS_DETAIL_PARENT.loginDevices === 'account' && SETTINGS_DETAIL_TITLE.loginDevices === '登录设备' && settingsText('登录设备') === '登录设备');
ck('H4 phone: the entry is gated on the hub supporting it (old hub → no row)', /const devices = show\('account', 'devices'\) && ctx\.sessions\.available;/.test(phone) && phone.includes("onPress={() => ctx.openDetail('loginDevices')}"));
ck('H5 phone: this device says 本机 and cannot be signed out from the list', phone.includes("value={session.is_current ? tr('sessions.thisDevice') : tr('sessions.signOut')}") && phone.includes('onPress={session.is_current ? undefined : () => s.askRevokeOne(session, label)}'));
ck('H6 phone: 退出其他所有设备 is a destructive full-width button, only when there are others', /s\.others > 0 \? \(\s*<SettingsButton variant="destructive" label=\{tr\('sessions\.signOutOthers'\)\}/.test(phone));
ck('H7 wide: row gated on support, opens its own pane page with a back to 账号', settings.includes("{show('account', 'devices') && sessions.available ? (") && settings.includes('testID="settings-login-devices-row"') && settings.includes('testID="settings-devices-back"') && settings.includes('const showWideDevices = wideDevices && !compact && !searching && active === \'account\' && sessions.available;'));
ck('H8 both layouts confirm before revoking (one shared dialog)', settings.includes('<Modal visible={!!sessions.confirm}') && settings.includes('onPress={sessions.runConfirm}') && (settings.match(/sessions\.askRevokeOthers/g) ?? []).length >= 1 && phone.includes('onPress={s.askRevokeOthers}'));
ck('H9 changing category leaves the wide devices page', settings.includes('setCategoryState(key); setWideDevices(false); };'));
ck('H10 expired login: login page title says 登录已过期，请重新登录', app.includes("const expired = !!initialProfile && profileUnauthorizedReason(initialProfile.profileId) === 'token_expired';") && app.includes("{expired ? t('sessions.expiredTitle') : initialProfile ? '重新验证账号'"));
ck('H11 App matches the 401 against sessionIdOf(cfg) (legacy phone accounts included) and clears it after re-login', app.includes('if (!cfg || profileId !== sessionIdOf(cfg)) return;') && app.includes('clearProfileUnauthorized(sessionIdOf(saved));'));
ck('H12 login and register both send the device label', app.includes('await login(norm.url, username.trim(), password, clientLabel)') && app.includes('client_label: clientLabel'));
ck('H13 switcher: opening it probes the other saved accounts', settings.includes('void probeSavedSessions(registry.profiles, sessionIdOf(cfg))'));

// ── J. 按设备分组 + 「退出其他所有登录」的确认(2026-09-30:生产 admin 2617 条 user-login,client_label / UA 全空) ──
{
  const at = (h: number) => new Date(NOW - h * 3600_000).toISOString().replace('T', ' ').slice(0, 19);
  const cur = S({ token_id: 'cur', is_current: true, client_label: 'macOS · 0.2.163', last_used_at: at(0) });
  const scripts = Array.from({ length: 2617 }, (_, i) => S({ token_id: `s${i}`, last_used_at: at(1 + i) }));
  const list = orderSessions([
    ...scripts,
    cur,
    S({ token_id: 'mac2', client_label: 'macOS · 0.2.163', last_used_at: at(5) }),  // 另一台同版本 Mac:与本机同名,但不和本机并组
    S({ token_id: 'a1', client_label: 'Android · 0.2.160', last_used_at: at(2) }),
    S({ token_id: 'a2', client_label: 'Android · 0.2.160', last_used_at: at(30) }),
    S({ token_id: 'curl', user_agent: 'curl/8.5.0', last_used_at: at(3) }),
  ]);
  const items = groupSessions(list);
  const unnamed = items.find(x => x.type === 'group' && x.unnamed);
  ck('J1 本机 stays its own first row, even when others share its label', items[0].type === 'session' && items[0].session.token_id === 'cur' && items.some(x => x.type === 'session' && x.session.token_id === 'mac2'));
  ck('J2 NULL label + NULL UA → one 「未命名（多为脚本 / 命令行）」 group holding all 2617',
    unnamed?.type === 'group' && unnamed.sessions.length === 2617 && unnamed.label === '未命名（多为脚本 / 命令行）', `${unnamed?.label} ${unnamed?.type === 'group' ? unnamed.sessions.length : '-'}`);
  ck('J3 same client_label → one group with a count; a UA-only session groups by what the UA says', items.some(x => x.type === 'group' && x.label === 'Android · 0.2.160' && x.sessions.length === 2) && items.some(x => x.type === 'session' && x.label === '命令行或脚本'));
  ck('J4 2622 sign-ins collapse to 5 top-level rows (本机, 未命名, Android, 命令行, other Mac)', items.length === 5, String(items.length));
  ck('J5 groups ordered by their most recent sign-in', items.map(x => x.type === 'session' ? x.session.token_id : x.label).join('|') === 'cur|未命名（多为脚本 / 命令行）|Android · 0.2.160|curl|mac2', items.map(x => x.type === 'session' ? x.session.token_id : x.label).join('|'));
  ck('J6 group subtitle: 「N 个登录 · 最近使用 …」; member subtitle: 「登录于 …」',
    groupSubtitle((unnamed as any).sessions, NOW) === '2617 个登录 · 最近使用 1 小时前' && memberSubtitle(S({ created_at: at(48) }), NOW) === '登录于 2 天前', groupSubtitle((unnamed as any).sessions, NOW));
  ck('J7 group key: label wins over UA; blank strings count as missing', sessionGroupKey(S({ client_label: 'iOS · 1', user_agent: 'okhttp' })).key === 'label:iOS · 1' && sessionGroupKey(S({ client_label: '  ', user_agent: ' ' })).unnamed);
  ck('J8 the confirm states the exact count, names scripts and agents, and the button repeats the count',
    translate('sessions.confirmOthersBody', { n: otherSessionCount(list) }) === '将退出其他 2621 个登录，包括脚本和 agent 使用的登录，它们需要重新登录。' && translate('sessions.confirmOthersOk', { n: 2621 }) === '退出 2621 个登录');
  ck('J9 counts say 登录, not 台 (a login is not a device)', translate('sessions.count', { n: 2617 }) === '2617 个登录' && !/台/.test(translate('sessions.revokedOthers', { n: 3 })));
  ck('J10 wide confirm: filled red destructive button carrying the count', settings.includes("style={[styles.modalButton, styles.modalDestructive]} onPress={sessions.runConfirm}") && /modalDestructive: \{ backgroundColor: colors\.failed/.test(settings) && settings.includes("tr('sessions.confirmOthersOk', { n: sessions.confirm.count })"));
  ck('J11 both layouts render sessions.items (grouped), not the flat list', settings.includes('visibleSessions(sessions.items, sessions.showAll)') && phone.includes('visibleSessions(s.items, s.showAll)') && !settings.includes('visibleSessions(sessions.sessions') && !phone.includes('visibleSessions(s.sessions'));
}

// ── I. 文案 ──
const used = new Set<string>();
for (const src of [settings, phone, app, read('src/login-sessions.ts'), read('src/useLoginSessions.ts')]) for (const m of src.matchAll(/\bt(?:r)?\('(sessions\.[\w.]+)'/g)) used.add(m[1]);
setLanguagePreference('zh');
const zh = [...used].map(k => [k, translate(k)] as const);
setLanguagePreference('en');
const en = [...used].map(k => [k, translate(k)] as const);
ck('I1 every sessions.* key used in code exists in zh (Chinese) and en (no Chinese)', used.size >= 20 && zh.every(([k, v]) => v !== k && /\p{Script=Han}/u.test(v)) && en.every(([k, v]) => v !== k && !/\p{Script=Han}/u.test(v)), `${used.size} keys; missing: ${zh.filter(([k, v]) => v === k).map(([k]) => k).join(',')}`);
setLanguagePreference('zh');

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
