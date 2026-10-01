// 设置 → 账号:每行的「复制」「编辑」(Vincent 2026-09-30「账号 支持一下复制 编辑」)。ck 风格,自执行,失败 exit 1。
//   run: bun src/account-row-actions.test.ts
// A 复制文本不带任何秘密 · B 每行有哪些动作 · C 编辑前的验证(地址格式 / 连不上 / 不是 Hub / 令牌被拒 / 别的用户)·
// D 原地更新一个账号、其他账号一个字节不动 · E 接线(宽屏行尾按钮、手机底部面板带平台判定、编辑走 DialogFrame、桌面 Rust 命令)。
// 几何 + 截图在 tests/test-account-copy-edit/drive.mjs 实测。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setLanguagePreference, t as translate } from './i18n';
import './i18n-accounts';
import { HUB_EDIT_FAILURE_KEY, accountCopyText, accountRowActions, offersRelogin, validateHubEdit, type EditFetch } from './account-row-actions';
import { createSessionStore, credentialKey, LEGACY_CONFIG_KEY, SESSIONS_INDEX_KEY, type SessionKv } from './session-registry';

let p = 0, t = 0;
const ck = (name: string, ok: boolean, extra = '') => { t++; if (ok) p++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`); };
const root = join(import.meta.dir, '..');
const read = (f: string) => readFileSync(join(root, f), 'utf8').replace(/\r\n?/g, '\n');
setLanguagePreference('zh');

// ── A. 复制文本 ──
const SECRET_TOKEN = 'utok_SECRET_should_never_be_copied';
const SECRET_PW = 'pw-SECRET-never';
// 故意把整个 HubConfig(含令牌)和一个带 password 的对象喂进去:入参类型只收三格,运行时也只能读三格。
const full = { serverUrl: 'http://hub.example.com:9300', username: 'demo-user', networkId: 'net_0123456789ab', token: SECRET_TOKEN, password: SECRET_PW, profileId: 'p1', displayName: 'Demo' } as any;
const line = accountCopyText(full);
ck('A1 copy text is 「Hub 地址 · 用户名 · 网络 ID」', line === 'http://hub.example.com:9300 · demo-user · net_0123456789ab', line);
ck('A2 🔴 copy text never contains the token or a password', !line.includes(SECRET_TOKEN) && !line.includes(SECRET_PW) && !/utok_|ntok_|Bearer/i.test(line));
ck('A3 missing network id → no dangling separator', accountCopyText({ serverUrl: 'https://hub.example', username: 'alice' }) === 'https://hub.example · alice');
ck('A4 missing username too → just the address', accountCopyText({ serverUrl: 'https://hub.example', username: '' }) === 'https://hub.example');
const copyFn = read('src/AccountRowActions.tsx').match(/export async function copyAccountLine[\s\S]*?\n}\n/)?.[0] ?? '';
ck('A5 🔴 the clipboard path builds its input from exactly serverUrl / username / networkId (no spread of the profile)',
  copyFn.includes('accountCopyText({ serverUrl: profile.serverUrl, username: profile.username, networkId: profile.networkId })') && !/\.\.\.profile|token/i.test(copyFn), copyFn.slice(0, 120));

// ── B. 动作清单 ──
const P = (o: any) => ({ profileId: 'p1', requiresReauth: false, ...o });
ck('B1 a normal account on desktop: 复制 · 编辑 · 新窗口 · 移除', accountRowActions(P({}), { canOpenWindow: true }).join(',') === 'copy,edit,openWindow,remove');
ck('B2 on phone (no windows): 复制 · 编辑 · 移除', accountRowActions(P({}), { canOpenWindow: false }).join(',') === 'copy,edit,remove');
ck('B3 Local workspace: 复制 only (+ 新窗口 on desktop) — no 编辑, no 移除',
  accountRowActions(P({ profileId: 'local-workspace' }), { canOpenWindow: false }).join(',') === 'copy'
  && accountRowActions(P({ profileId: 'local-workspace' }), { canOpenWindow: true }).join(',') === 'copy,openWindow');
ck('B4 an account that needs re-login can still be copied / edited / removed, but not opened in a window', accountRowActions(P({ requiresReauth: true }), { canOpenWindow: true }).join(',') === 'copy,edit,remove');
ck('B5 the current account gets the same actions (no special-casing)', accountRowActions(P({ profileId: 'cur' }), { canOpenWindow: true }).includes('edit'));

// ── C. 编辑前的验证 ──
type Call = { url: string; auth?: string };
const fake = (routes: Record<string, number | 'throw' | 'hang' | { status: number; body: unknown }>) => {
  const calls: Call[] = [];
  const f: EditFetch = async (url, init) => {
    calls.push({ url, auth: init.headers?.Authorization });
    const path = new URL(url).pathname;
    const r = routes[path];
    if (r === 'throw' || r === undefined) throw new TypeError('Failed to fetch');
    if (r === 'hang') return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    const status = typeof r === 'number' ? r : r.status;
    const body = typeof r === 'number' ? {} : r.body;
    return { status, json: async () => { if (body === 'not-json') throw new SyntaxError('bad'); return body; } };
  };
  return { f, calls };
};
const ME = { status: 200, body: { ok: true, user: { username: 'demo-user' }, networks: [] } };
const base = { currentServerUrl: 'http://hub.example.com:9300', token: 'utok_saved', username: 'demo-user' };

const c1 = fake({});
const r1 = await validateHubEdit({ ...base, serverUrl: 'ht tp://bad url' }, c1.f);
ck('C1 bad URL → bad-url, and no request is made', !r1.ok && r1.kind === 'bad-url' && c1.calls.length === 0);
const c2 = fake({});
const r2 = await validateHubEdit({ ...base, serverUrl: 'HTTP://hub.example.com:9300/' }, c2.f);
ck('C2 same address (case / trailing slash) → ok, unchanged, no request (label-only edit)', r2.ok && !r2.changed && c2.calls.length === 0);
const c3 = fake({ '/health': 'throw' });
const r3 = await validateHubEdit({ ...base, serverUrl: 'http://10.0.0.9:9300' }, c3.f);
ck('C3 unreachable (fetch throws on /health) → unreachable, auth/me never called', !r3.ok && r3.kind === 'unreachable' && c3.calls.length === 1);
const c4 = fake({ '/health': 'hang' });
const r4 = await validateHubEdit({ ...base, serverUrl: 'http://10.0.0.9:9300' }, c4.f, 50);
ck('C4 a hanging /health is aborted by the timeout → unreachable (the dialog does not spin forever)', !r4.ok && r4.kind === 'unreachable');
const c5 = fake({ '/health': 502 });
const r5 = await validateHubEdit({ ...base, serverUrl: 'http://10.0.0.9:9300' }, c5.f);
ck('C5 /health non-2xx → not-hub', !r5.ok && r5.kind === 'not-hub' && r5.detail === 'HTTP 502');
for (const status of [401, 403]) {
  const c = fake({ '/health': 200, '/api/auth/me': status });
  const r = await validateHubEdit({ ...base, serverUrl: 'https://new-hub.example' }, c.f);
  ck(`C6 token rejected (${status}) → token-rejected and the dialog offers 重新登录`, !r.ok && r.kind === 'token-rejected' && offersRelogin(r.kind));
}
ck('C7 only token-rejected offers 重新登录', (['bad-url', 'unreachable', 'not-hub', 'other-user', 'server-error'] as const).every(k => !offersRelogin(k)));
const c8 = fake({ '/health': 200, '/api/auth/me': 500 });
const r8 = await validateHubEdit({ ...base, serverUrl: 'https://new-hub.example' }, c8.f);
ck('C8 auth/me 5xx → server-error (not token-rejected: a 500 says nothing about the token)', !r8.ok && r8.kind === 'server-error');
const c9 = fake({ '/health': 200, '/api/auth/me': { status: 200, body: { ok: true, user: { username: 'someone-else' } } } });
const r9 = await validateHubEdit({ ...base, serverUrl: 'https://new-hub.example' }, c9.f);
ck('C9 token valid there but for another user → other-user (that is a different account, not a new address)', !r9.ok && r9.kind === 'other-user' && r9.detail === 'someone-else');
const c10 = fake({ '/health': 200, '/api/auth/me': { status: 200, body: 'not-json' } });
const r10 = await validateHubEdit({ ...base, serverUrl: 'https://new-hub.example' }, c10.f);
ck('C10 old-hub style 200 text on auth/me → not-hub', !r10.ok && r10.kind === 'not-hub');
const c11 = fake({ '/health': 200, '/api/auth/me': ME });
const r11 = await validateHubEdit({ ...base, serverUrl: '  new-hub.example/  ' }, c11.f);
ck('C11 ok → normalized address (https added, trailing slash dropped), changed=true', r11.ok && r11.changed && r11.serverUrl === 'https://new-hub.example', JSON.stringify(r11));
ck('C12 order is /health then /api/auth/me, on the NEW address', c11.calls.map(c => c.url).join(' ') === 'https://new-hub.example/health https://new-hub.example/api/auth/me');
ck('C13 the stored token goes only to auth/me (health is unauthenticated)', c11.calls[0].auth === undefined && c11.calls[1].auth === 'Bearer utok_saved');
ck('C14 every failure kind has a zh + en message', Object.values(HUB_EDIT_FAILURE_KEY).every(key => {
  setLanguagePreference('zh'); const zh = translate(key, { detail: 'x' });
  setLanguagePreference('en'); const en = translate(key, { detail: 'x' });
  setLanguagePreference('zh');
  return zh !== key && en !== key && zh !== en;
}));

// ── D. 原地更新(手机 / 网页的 session store;桌面的 Rust 同形状有 cargo 单测)──
const memKv = (seed: Record<string, string> = {}) => {
  const data = new Map(Object.entries(seed));
  const kv: SessionKv = { get: async k => data.get(k) ?? null, set: async (k, v) => { data.set(k, v); }, del: async k => { data.delete(k); } };
  return { kv, data };
};
let seq = 0;
const { kv, data } = memKv();
const store = createSessionStore(kv, { now: () => 1000 + seq, newId: () => `m-${++seq}` });
await store.save({ serverUrl: 'https://a.example', token: 'tok-a', username: 'alice', networkId: 'net_a', displayName: 'A' });
await store.save({ serverUrl: 'https://b.example', token: 'tok-b', username: 'bob', networkId: 'net_b' });
await store.save({ serverUrl: 'https://c.example', token: 'tok-c', username: 'carol', networkId: 'net_c' });
await store.switchTo('m-1');
const before = new Map(data);
const idxBefore = JSON.parse(before.get(SESSIONS_INDEX_KEY)!);
seq = 50;
const updated = await store.update('m-2', { serverUrl: 'https://b2.example', displayName: '  Bob work  ' });
const idxAfter = JSON.parse(data.get(SESSIONS_INDEX_KEY)!);
const bCred = JSON.parse(data.get(credentialKey('m-2'))!);
ck('D1 the edited account has the new address + label and keeps its token / username / network', bCred.serverUrl === 'https://b2.example' && bCred.displayName === 'Bob work' && bCred.token === 'tok-b' && bCred.username === 'bob' && bCred.networkId === 'net_b' && bCred.profileId === 'm-2' && updated.token === 'tok-b');
ck('D2 its index row changed in place (same position, createdAt kept, updatedAt bumped)',
  idxAfter.sessions.map((s: any) => s.id).join(',') === 'm-1,m-2,m-3' && idxAfter.sessions[1].serverUrl === 'https://b2.example' && idxAfter.sessions[1].displayName === 'Bob work'
  && idxAfter.sessions[1].createdAt === idxBefore.sessions[1].createdAt && idxAfter.sessions[1].updatedAt === 1050);
ck('D3 🔴 the other accounts are untouched, byte for byte (credentials and index rows)',
  data.get(credentialKey('m-1')) === before.get(credentialKey('m-1')) && data.get(credentialKey('m-3')) === before.get(credentialKey('m-3'))
  && JSON.stringify(idxAfter.sessions[0]) === JSON.stringify(idxBefore.sessions[0]) && JSON.stringify(idxAfter.sessions[2]) === JSON.stringify(idxBefore.sessions[2]));
ck('D4 editing a non-current account does not switch to it', idxAfter.active === 'm-1');
ck('D5 no token ever lands in the index', !data.get(SESSIONS_INDEX_KEY)!.includes('tok-'));
await store.update('m-2', { serverUrl: 'https://b2.example', displayName: '   ' });
const cleared = JSON.parse(data.get(SESSIONS_INDEX_KEY)!).sessions[1];
ck('D6 an empty label clears it (the row falls back to the username)', cleared.displayName === undefined && JSON.parse(data.get(credentialKey('m-2'))!).displayName === undefined);
let threw = false; try { await store.update('nope', { serverUrl: 'https://x.example' }); } catch { threw = true; }
ck('D7 unknown account → throws, nothing written', threw && JSON.parse(data.get(SESSIONS_INDEX_KEY)!).sessions.length === 3);
const legacy = memKv({ [LEGACY_CONFIG_KEY]: JSON.stringify({ serverUrl: 'https://old.example', token: 'tok-old', username: 'olduser' }) });
const legacyStore = createSessionStore(legacy.kv, { now: () => 7 });
await legacyStore.update('legacy', { serverUrl: 'https://new.example' });
const legacyCred = JSON.parse(legacy.data.get(LEGACY_CONFIG_KEY)!);
ck('D8 the migrated (legacy) account is edited in its old key, still without a profileId', legacyCred.serverUrl === 'https://new.example' && legacyCred.token === 'tok-old' && !('profileId' in legacyCred));

// ── E. 接线 ──
const settings = read('src/SettingsScreen.tsx');
const phone = read('src/SettingsPhonePages.tsx');
const actionsUi = read('src/AccountRowActions.tsx');
const storage = read('src/storage.ts');
const rust = read('src-tauri/src/lib.rs');
const app = read('App.tsx');
// #427:宽屏行尾不再挤一排文字按钮,动作收进 ⋯(鼠标 = 锚定菜单,手指 = 底部动作面板);菜单项 = 同一份 accountRowActions(+ 切换)。
const menuUi = actionsUi.slice(actionsUi.indexOf('export function AccountMoreMenu'), actionsUi.indexOf('export function AccountActionSheet'));
ck('E1 wide rows: 复制 · 编辑 · 新窗口 · 移除 live in the ⋯ menu (no inline text buttons), ids kept', !settings.includes('styles.inlineButton') && menuUi.includes('`settings-${item}-${profile.profileId}`') && settings.includes('accountMenuItems(profileActions(menuFor.profile)'));
ck('E2 the menu only lists what the action list has (Local workspace = copy only) + 切换 for other, signed-in accounts', /export function accountMenuItems[\s\S]*?if \(!opts\.current && !opts\.requiresReauth\) have\.add\('switch'\);/.test(read('src/account-row-actions.ts')));
ck('E3 ⋯: pointer → anchored menu, touch → the bottom action sheet (phone pages hand ⋯ to SettingsScreen)', /const openProfileMore = \(profile: HubProfile, el: any\) => \{\n    if \(!pointer \|\| !el\?\.measureInWindow\) \{ setSheetTarget\(profile\); return; \}/.test(settings) && phone.includes('onMore={el => ctx.onProfileMore(profile, el)}'));
ck('E4 the bottom sheet is gated on the touch predicate', settings.includes('visible={!pointer && !!sheetTarget}'));
ck('E5 the edit dialog uses the shared DialogFrame', actionsUi.includes("import DialogFrame from './DialogFrame'") && actionsUi.includes('<DialogFrame') && actionsUi.includes('testID="account-edit-dialog"'));
ck('E6 save validates first and saves only on ok; 重新登录 only on token-rejected', /const check = await validateHubEdit[\s\S]*?if \(!check\.ok\) \{ setError[\s\S]*?return; \}[\s\S]*?await updateHubProfile/.test(actionsUi) && actionsUi.includes('offersRelogin(error.kind)'));
ck('E7 editing the current account reconnects in place (App reloads it without leaving settings)', settings.includes('onProfileEdited ? onProfileEdited(profileId) : onSwitchProfile(profileId)') && app.includes('const reloadEditedProfile = (profileId: string) => activateProfile(profileId, true);') && (app.match(/onProfileEdited=\{/g) ?? []).length >= 4);
ck('E8 storage reuses the existing profile stores (desktop Rust command / mobile session store), no new storage', storage.includes("invoke('update_desktop_profile'") && storage.includes('mobileSessions.update(profileId, patch)'));
ck('E9 the Rust command is registered, refuses the local workspace, and never touches the keyring', rust.includes('            update_desktop_profile,') && /fn update_desktop_profile[\s\S]*?is_local_profile[\s\S]*?apply_profile_edit/.test(rust) && !/fn apply_profile_edit[\s\S]*?set_password[\s\S]*?\n}\n/.test(rust.slice(rust.indexOf('fn apply_profile_edit'), rust.indexOf('fn apply_profile_edit') + 1200)));
ck('E10 copy shows 「已复制」', settings.includes("setToast(tr('accounts.copied'))") && translate('accounts.copied') === '已复制');

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
