// 切换账号(Vincent 2026-09-29):手机 / 网页的多账号存储。ck 风格,自执行,失败 exit 1。
//   A  添加 / 切换 / 移除;切换不吊销、不删别的账号的凭据
//   B  从升级前的单账号存储(hub_config_v1)迁移:不丢登录、不搬不改那个键、迁移账号不带 profileId
//   C  索引里没有 token;凭据只在各自的键里
//   D  退出登录 = 只移除当前账号;还有别的 → 当前换成剩下的;一个不剩 → null
import {
  LEGACY_CONFIG_KEY,
  LEGACY_SESSION_ID,
  SESSIONS_INDEX_KEY,
  createSessionStore,
  credentialKey,
  sameAccount,
  type SessionKv,
} from './session-registry';

let p = 0, t = 0;
const ck = (name: string, ok: boolean, extra = '') => { t++; if (ok) p++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`); };

const memKv = (seed: Record<string, string> = {}) => {
  const m = new Map(Object.entries(seed));
  const kv: SessionKv = {
    get: async k => m.get(k) ?? null,
    set: async (k, v) => { m.set(k, v); },
    del: async k => { m.delete(k); },
  };
  return { m, kv };
};
let seq = 0;
const store = (kv: SessionKv) => createSessionStore(kv, { now: () => 1000 + seq, newId: () => `m-${++seq}` });

const A = { serverUrl: 'https://hub-a.example.com', token: 'utok_aaa', username: 'alice', networkId: 'net_a' };
const B = { serverUrl: 'http://127.0.0.1:9311', token: 'utok_bbb', username: 'bob', networkId: 'net_b' };

// ── A. add / switch / remove ─────────────────────────────────────────────────────────────────
{
  const { m, kv } = memKv();
  const s = store(kv);
  ck('A0 empty store has no active account', (await s.activeConfig()) === null);
  const a = await s.save(A);
  ck('A1 first login becomes the active account', (await s.activeConfig())?.token === 'utok_aaa');
  ck('A1 a new account gets a profileId (its local data is keyed by it)', !!a.profileId && a.profileId.startsWith('m-'));
  const b = await s.save(B);
  const idx = await s.loadIndex();
  ck('A2 adding B keeps A: two saved accounts', idx.sessions.length === 2, idx.sessions.map(x => x.username).join(','));
  ck('A2 adding B makes B active', idx.active === b.profileId && (await s.activeConfig())?.token === 'utok_bbb');
  ck('A2 A\'s credential is untouched after adding B', JSON.parse(m.get(credentialKey(a.profileId!))!).token === 'utok_aaa');
  const back = await s.switchTo(a.profileId!);
  ck('A3 switch B→A returns A\'s saved token (no password)', back.token === 'utok_aaa' && back.profileId === a.profileId);
  ck('A3 switching does not revoke/delete B', JSON.parse(m.get(credentialKey(b.profileId!))!).token === 'utok_bbb');
  const again = await s.switchTo(b.profileId!);
  ck('A4 switch A→B again works', again.token === 'utok_bbb' && (await s.activeConfig())?.token === 'utok_bbb');
  // Same account again (e.g. token refresh) updates instead of duplicating.
  await s.save({ ...A, serverUrl: 'https://HUB-A.example.com/', token: 'utok_aaa2' });
  const idx2 = await s.loadIndex();
  ck('A5 logging into the same account again updates it, no duplicate', idx2.sessions.length === 2 && JSON.parse(m.get(credentialKey(a.profileId!))!).token === 'utok_aaa2');
  ck('A5 …and makes it active', idx2.active === a.profileId);
  // Same server, different user = a different account.
  const c = await s.save({ ...A, username: 'carol', token: 'utok_ccc' });
  ck('A6 same server + other username is a separate account', (await s.loadIndex()).sessions.length === 3 && c.profileId !== a.profileId);
  // Remove a non-active account.
  await s.switchTo(a.profileId!);
  const act = await s.remove(c.profileId!);
  ck('A7 removing a non-active account keeps the active one', act === a.profileId && (await s.activeConfig())?.token === 'utok_aaa2');
  ck('A7 removing deletes that account\'s credential key', !m.has(credentialKey(c.profileId!)));
  let threw = false;
  try { await s.switchTo(c.profileId!); } catch { threw = true; }
  ck('A8 switching to a removed account fails loudly', threw);
  // Re-auth: a 401 marks the account; logging in again clears the mark.
  await s.markReauth(b.profileId!, true);
  ck('A9 markReauth flags only that account', (await s.loadIndex()).sessions.find(x => x.id === b.profileId)?.requiresReauth === true
    && !(await s.loadIndex()).sessions.find(x => x.id === a.profileId)?.requiresReauth);
  await s.save({ ...B, profileId: b.profileId, token: 'utok_bbb2' });
  ck('A9 re-login with the profileId clears the flag and updates the token', !(await s.loadIndex()).sessions.find(x => x.id === b.profileId)?.requiresReauth
    && JSON.parse(m.get(credentialKey(b.profileId!))!).token === 'utok_bbb2');
}

// ── B. migration from the old single-session storage ─────────────────────────────────────────
{
  const legacyRaw = JSON.stringify(A); // exactly what saveConfig wrote before: SecureStore hub_config_v1 = JSON(HubConfig)
  const { m, kv } = memKv({ [LEGACY_CONFIG_KEY]: legacyRaw });
  const s = store(kv);
  const cfg = await s.activeConfig();
  ck('B1 upgraded user is still logged in (same server/token/user/network)', !!cfg && cfg.serverUrl === A.serverUrl && cfg.token === A.token && cfg.username === A.username && cfg.networkId === A.networkId);
  ck('B2 migrated account has NO profileId (pins/cache/notify keys stay what they were)', cfg?.profileId === undefined);
  ck('B3 the old key is left byte-identical (rollback to the old app still logs in)', m.get(LEGACY_CONFIG_KEY) === legacyRaw);
  const idx = await s.loadIndex();
  ck('B4 index created with the legacy account active', idx.active === LEGACY_SESSION_ID && idx.sessions.length === 1 && idx.sessions[0].username === 'alice');
  ck('B4 index persisted', !!m.get(SESSIONS_INDEX_KEY));
  // Adding a second account after migration keeps the legacy one.
  const b = await s.save(B);
  ck('B5 add after migration: legacy + new', (await s.loadIndex()).sessions.map(x => x.id).join(',') === `${LEGACY_SESSION_ID},${b.profileId}`);
  const back = await s.switchTo(LEGACY_SESSION_ID);
  ck('B6 switch back to the migrated account: token + no profileId', back.token === A.token && back.profileId === undefined);
  ck('B6 legacy key still byte-identical after switching around', m.get(LEGACY_CONFIG_KEY) === legacyRaw);
  // Re-login to the migrated account writes the legacy key, still without a profileId.
  await s.save({ ...A, token: 'utok_new' });
  ck('B7 re-login to the migrated account updates hub_config_v1 in place, no profileId written', (() => { const v = JSON.parse(m.get(LEGACY_CONFIG_KEY)!); return v.token === 'utok_new' && !('profileId' in v); })());
  ck('B7 …and does not create a duplicate', (await s.loadIndex()).sessions.length === 2);
  // Second load reads the index, it does not re-migrate.
  const again = await store(kv).loadIndex();
  ck('B8 a second launch reads the index (no re-migration, both kept)', again.sessions.length === 2);
  // A corrupt / missing legacy value is "not logged in", not a crash.
  const bad = store(memKv({ [LEGACY_CONFIG_KEY]: '{not json' }).kv);
  ck('B9 corrupt legacy value → logged out, no throw', (await bad.activeConfig()) === null);
  // Legacy value that somehow carries a profileId is still treated as the migrated account.
  const withPid = store(memKv({ [LEGACY_CONFIG_KEY]: JSON.stringify({ ...A, profileId: 'x' }) }).kv);
  ck('B10 migrated account never exposes a stray profileId', (await withPid.activeConfig())?.profileId === undefined);
}

// ── C. tokens only in credential keys ────────────────────────────────────────────────────────
{
  const { m, kv } = memKv({ [LEGACY_CONFIG_KEY]: JSON.stringify(A) });
  const s = store(kv);
  await s.save(B);
  const index = m.get(SESSIONS_INDEX_KEY)!;
  ck('C1 the account index carries no token', !index.includes('utok_'), index);
  const keys = [...m.keys()].filter(k => (m.get(k) ?? '').includes('utok_')).sort();
  ck('C2 tokens live only under the per-account credential keys', keys.every(k => k === LEGACY_CONFIG_KEY || k.startsWith('hub_session_')), keys.join(','));
  ck('C3 credential keys are SecureStore-legal ([A-Za-z0-9._-])', keys.every(k => /^[A-Za-z0-9._-]+$/.test(k)));
}

// ── D. 退出登录 semantics ────────────────────────────────────────────────────────────────────
{
  const { m, kv } = memKv({ [LEGACY_CONFIG_KEY]: JSON.stringify(A) });
  const s = store(kv);
  const b = await s.save(B);
  const next = await s.removeActive();
  ck('D1 signing out B (active) switches to the remaining account', next === LEGACY_SESSION_ID && (await s.activeConfig())?.token === A.token);
  ck('D1 only B\'s credential is deleted', !m.has(credentialKey(b.profileId!)) && m.has(LEGACY_CONFIG_KEY));
  const none = await s.removeActive();
  ck('D2 signing out the last account → no active account (login page)', none === null && (await s.activeConfig()) === null);
  ck('D2 the legacy key is deleted when that account signs out', !m.has(LEGACY_CONFIG_KEY));
  ck('D3 a later launch does not resurrect it by re-migrating', (await store(kv).activeConfig()) === null);
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────────
ck('E1 sameAccount ignores trailing slash + host case, not username', sameAccount({ serverUrl: 'https://H.x/', username: 'u' }, { serverUrl: 'https://h.x', username: 'u' }) && !sameAccount({ serverUrl: 'https://h.x', username: 'u' }, { serverUrl: 'https://h.x', username: 'v' }));

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
