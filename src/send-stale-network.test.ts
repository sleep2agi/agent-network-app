// #552 —— 受限成员从 iPhone 给 Agent 发了 3 条,全部「未送达 · 点击重试」,Hub 一条没收到。
// 用生产库副本重放 app 的原请求:network_id = 被授权的团队网络 → 200;= 她自己的个人网络 → 404 alias_not_found;
// 不带 → 400 network_id_required。app 记着的网络过期了(登录时落盘的是个人网络,之后管理员才把她拉进团队)。
//
// 这里锁住:
//   1. 发送回 404 alias_not_found / 400 network_id_required / 403「access denied to requested network」→
//      丢掉缓存的身份、重新读 /api/auth/me、网络真变了才用**同一个** client_request_id 再发一次,并落盘新网络;
//   2. 第二次还失败、或网络没变 → 原样抛,绝不循环;
//   3. 错误码 → 「未送达」下面那行原因;
//   4. 启动 / 切账号时的网络复核(reconcileNetworkId)。
import { sendTask, setNetworkIdPersister, SendTaskError, forgetSendIdentity, type HubConfig } from './api';
import { forgetAuthMe } from './user-admin-api';
import { sendFailureReason, isNetworkScopedSendFailure } from './send-failure-reason';
import { reconcileNetworkId, type AuthMe } from './user-admin';
import { t as translate, setLanguagePreference } from './i18n';
import './i18n-chat';
import { readFileSync } from 'node:fs';
import { createSessionStore, type SessionKv } from './session-registry';

let passed = 0;
let total = 0;
const ck = (name: string, ok: boolean) => {
  total++;
  if (ok) { passed++; console.log('✅', name); }
  else { console.error('❌', name); }
};

const PERSONAL = 'net_personal';
const TEAM = 'net_team';
const me = (extra: Partial<AuthMe> = {}): AuthMe => ({
  user: { user_id: 'u_lin', username: 'lin', role: 'user' },
  current_network: null,
  networks: [
    { network_id: PERSONAL, member_role: 'owner', agent_access: 'all' },
    { network_id: TEAM, member_role: 'member', agent_access: 'granted' },
  ],
  ...extra,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Call = { url: string; body?: any };
const originalFetch = globalThis.fetch;
const install = (handler: (url: string, body: any) => Response, calls: Call[]) => {
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    return handler(url, body);
  }) as typeof fetch;
};
const reset = () => { forgetSendIdentity(); forgetAuthMe(); };
const taskCalls = (calls: Call[]) => calls.filter(c => c.url.endsWith('/api/task'));
const meCalls = (calls: Call[]) => calls.filter(c => c.url.endsWith('/api/auth/me'));
// The hub as replayed against the prod DB copy: only TEAM knows the agent.
const hub = (authMe: AuthMe) => (url: string, body: any) => {
  if (url.endsWith('/api/auth/me')) return json({ ok: true, ...authMe });
  if (!body?.network_id) return json({ ok: false, error: 'network_id_required' }, 400);
  if (body.network_id !== TEAM) return json({ ok: false, error: 'alias_not_found', alias: body.alias, queued: false }, 404);
  return json({ ok: true, task_id: 'task_ok' });
};

try {
  // ── 1. stale persisted network → 404 → re-resolve → retry succeeds with the same client_request_id
  {
    reset();
    const calls: Call[] = [];
    install(hub(me()), calls);
    const persisted: Array<[string, string]> = [];
    const off = setNetworkIdPersister((c, id) => { persisted.push([c.token, id]); });
    const cfg: HubConfig = { serverUrl: 'https://hub.example.test', token: 'utok_lin', username: 'lin', networkId: PERSONAL };
    const res = await sendTask(cfg, '通信牛', 'hello', undefined, 'normal', 'dreq_00000000000000000000000000000552');
    const tasks = taskCalls(calls);
    ck('stale network: send succeeds after one retry', res.ok === true && res.task_id === 'task_ok');
    ck('stale network: exactly two POST /api/task', tasks.length === 2);
    ck('stale network: first POST used the stale personal network', tasks[0]?.body?.network_id === PERSONAL);
    ck('stale network: retry used the granted team network', tasks[1]?.body?.network_id === TEAM);
    ck('stale network: retry reuses the same client_request_id',
      tasks[0]?.body?.meta?.client_request_id === 'dreq_00000000000000000000000000000552'
      && tasks[1]?.body?.meta?.client_request_id === tasks[0]?.body?.meta?.client_request_id);
    ck('stale network: identity re-read from /api/auth/me once', meCalls(calls).length === 1);
    ck('stale network: cfg.networkId corrected in memory', cfg.networkId === TEAM);
    ck('stale network: corrected network handed to the persister once', persisted.length === 1 && persisted[0][0] === 'utok_lin' && persisted[0][1] === TEAM);

    // next send goes straight to the corrected network
    calls.length = 0;
    await sendTask(cfg, '通信牛', 'again');
    ck('after correction: next send is one POST on the team network, no auth/me', taskCalls(calls).length === 1 && taskCalls(calls)[0]?.body?.network_id === TEAM && meCalls(calls).length === 0);
    off();
  }

  // ── 1b. the 60 s shared /api/auth/me cache must not answer the re-resolve with the old network
  {
    reset();
    const calls: Call[] = [];
    let current: AuthMe = me({ networks: [{ network_id: PERSONAL, member_role: 'owner', agent_access: 'all' }] });
    install((url, body) => hub(current)(url, body), calls);
    const cfg: HubConfig = { serverUrl: 'https://hub.example.test', token: 'utok_cache' };
    // first send resolves (and caches) the personal network → 404
    let first: unknown = null;
    try { await sendTask(cfg, '通信牛', 'before grant'); } catch (e) { first = e; }
    ck('before grant: personal-only identity → send fails 404 alias_not_found', first instanceof SendTaskError && (first as SendTaskError).code === 'alias_not_found');
    // admin grants access; within the cache TTL the retry path must read the new answer
    current = me();
    calls.length = 0;
    const res = await sendTask(cfg, '通信牛', 'after grant');
    ck('after grant (inside auth/me TTL): retry re-reads /api/auth/me and lands on the team network', res.ok === true && taskCalls(calls).at(-1)?.body?.network_id === TEAM && meCalls(calls).length === 1);
  }

  // ── 2. second failure does not loop
  {
    reset();
    const calls: Call[] = [];
    install((url, body) => {
      if (url.endsWith('/api/auth/me')) return json({ ok: true, ...me() });
      return json({ ok: false, error: 'alias_not_found' }, 404); // agent gone in every network
    }, calls);
    const cfg: HubConfig = { serverUrl: 'https://hub.example.test', token: 'utok_gone', username: 'lin', networkId: PERSONAL };
    let err: unknown = null;
    try { await sendTask(cfg, '已删除的Agent', 'hi'); } catch (e) { err = e; }
    ck('second failure: rejects with SendTaskError alias_not_found', err instanceof SendTaskError && (err as SendTaskError).status === 404 && (err as SendTaskError).code === 'alias_not_found');
    ck('second failure: exactly two POSTs (one retry, no loop)', taskCalls(calls).length === 2);
    ck('second failure: auth/me read once', meCalls(calls).length === 1);
  }

  // ── 2b. network unchanged after re-resolve → no retry at all
  {
    reset();
    const calls: Call[] = [];
    install((url) => {
      if (url.endsWith('/api/auth/me')) return json({ ok: true, ...me() });
      return json({ ok: false, error: 'alias_not_found' }, 404);
    }, calls);
    const cfg: HubConfig = { serverUrl: 'https://hub.example.test', token: 'utok_same', username: 'lin', networkId: TEAM };
    let err: unknown = null;
    try { await sendTask(cfg, '没有的Agent', 'hi'); } catch (e) { err = e; }
    ck('same network after re-resolve: one POST only, original error surfaces', taskCalls(calls).length === 1 && err instanceof SendTaskError && (err as SendTaskError).code === 'alias_not_found');
    ck('same network after re-resolve: cfg.networkId untouched', cfg.networkId === TEAM);
  }

  // ── 2c. 400 network_id_required and 403 network access denial also re-resolve; agent_not_granted does not
  {
    reset();
    const calls: Call[] = [];
    install((url, body) => {
      if (url.endsWith('/api/auth/me')) return json({ ok: true, ...me() });
      if (body?.network_id === TEAM) return json({ ok: true, task_id: 'task_ok' });
      return json({ ok: false, error: 'access denied to requested network' }, 403);
    }, calls);
    const cfg: HubConfig = { serverUrl: 'https://hub.example.test', token: 'utok_removed', username: 'lin', networkId: 'net_removed_from' };
    const res = await sendTask(cfg, '通信牛', 'hi');
    ck('403 access denied to requested network → re-resolve → retry on team network', res.ok === true && taskCalls(calls).length === 2 && taskCalls(calls)[1]?.body?.network_id === TEAM);

    reset();
    calls.length = 0;
    install((url) => {
      if (url.endsWith('/api/auth/me')) return json({ ok: true, ...me() });
      return json({ ok: false, error: 'agent_not_granted', message: 'ask a network admin' }, 403);
    }, calls);
    const cfg2: HubConfig = { serverUrl: 'https://hub.example.test', token: 'utok_ng', username: 'lin', networkId: TEAM };
    let err: unknown = null;
    try { await sendTask(cfg2, '没授权的Agent', 'hi'); } catch (e) { err = e; }
    ck('403 agent_not_granted: no re-resolve, no retry', taskCalls(calls).length === 1 && meCalls(calls).length === 0);
    ck('403 agent_not_granted: error carries the hub code', err instanceof SendTaskError && (err as SendTaskError).code === 'agent_not_granted');
  }

  // ── 3. reason mapping
  {
    const e = (status: number, code?: string) => new SendTaskError('x', status, code);
    ck('reason: alias_not_found → aliasNotFound', sendFailureReason(e(404, 'alias_not_found')) === 'aliasNotFound');
    ck('reason: agent_not_granted → notGranted', sendFailureReason(e(403, 'agent_not_granted')) === 'notGranted');
    ck('reason: permission_denied → notGranted', sendFailureReason(e(403, 'permission_denied')) === 'notGranted');
    ck('reason: network_id_required → network', sendFailureReason(e(400, 'network_id_required')) === 'network');
    ck('reason: access denied to requested network → network', sendFailureReason(e(403, 'access denied to requested network')) === 'network');
    ck('reason: attachment_not_accessible → attachment', sendFailureReason(e(403, 'attachment_not_accessible')) === 'attachment');
    ck('reason: timeout / plain Error → none (bare 未送达)', sendFailureReason(new Error('服务器 12 秒内没有响应')) === null);
    ck('reason: unknown hub code → none', sendFailureReason(e(500, 'boom')) === null);
    ck('recoverable set: only the three network-scoped failures',
      isNetworkScopedSendFailure(e(404, 'alias_not_found')) && isNetworkScopedSendFailure(e(400, 'network_id_required'))
      && isNetworkScopedSendFailure(e(403, 'access denied to requested network'))
      && !isNetworkScopedSendFailure(e(403, 'agent_not_granted')) && !isNetworkScopedSendFailure(e(404, 'not_found'))
      && !isNetworkScopedSendFailure(new Error('alias_not_found')));
    setLanguagePreference('zh');
    ck('reason copy: zh aliasNotFound', translate('chat.failReason.aliasNotFound') === '没有找到这个 Agent（可能已删除、改名，或你已不在它所在的网络）');
    ck('reason copy: zh notGranted', translate('chat.failReason.notGranted') === '没有给这个 Agent 发消息的权限');
    const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
    ck('ChatScreen renders the reason under 未送达 via t()', /t\('chat\.notDelivered'\)\}<\/Text>\s*\{item\._failReason \? <Text[^>]*>\{t\(`chat\.failReason\.\$\{item\._failReason\}`\)\}/.test(chat));
    ck('ChatScreen keeps the reason from the caught send error', chat.includes('const failReason = sendFailureReason(sendError) ?? undefined;') && chat.includes('_failed: true, _failReason: failReason'));
    ck('ChatScreen retry clears the old reason', chat.includes('_failed: false, _failReason: undefined'));
  }

  // ── 4. login / restore reconcile
  {
    ck('reconcile: stale personal network while restricted in team → team', reconcileNetworkId(me(), PERSONAL) === TEAM);
    ck('reconcile: already on team → no change', reconcileNetworkId(me(), TEAM) === undefined);
    ck('reconcile: saved network no longer listed → re-pick', reconcileNetworkId(me({ networks: [{ network_id: 'net_a', member_role: 'owner', agent_access: 'all' }] }), 'net_removed') === 'net_a');
    ck('reconcile: no saved network → pick', reconcileNetworkId(me(), undefined) === TEAM);
    ck('reconcile: plain owner (no restriction anywhere) keeps its saved listed network',
      reconcileNetworkId(me({ networks: [{ network_id: 'net_a', member_role: 'owner', agent_access: 'all' }, { network_id: 'net_b', member_role: 'admin', agent_access: 'all' }] }), 'net_b') === undefined);
    ck('reconcile: old hub (no agent_access) keeps saved listed network', reconcileNetworkId(me({ networks: [{ network_id: 'net_a' }, { network_id: 'net_b' }] }), 'net_b') === undefined);
    ck('reconcile: token bound to a network (current_network) wins', reconcileNetworkId(me({ current_network: 'net_bound' }), PERSONAL) === 'net_bound');
    ck('reconcile: /api/auth/me unreadable → no change (fail-open)', reconcileNetworkId(null, PERSONAL) === undefined);
    ck('reconcile: empty networks → no change', reconcileNetworkId(me({ networks: [] }), PERSONAL) === undefined);
    ck('reconcile: hub admin outside saved network is left alone', reconcileNetworkId(me({ user: { role: 'admin' }, networks: [{ network_id: 'net_a', member_role: 'owner', agent_access: 'all' }] }), 'net_x') === undefined);
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    ck('App revalidates the network on restore and on account activation', (app.match(/revalidateNetworkId\((saved|next)\);/g) ?? []).length >= 2);
    ck('App installs the send-path network persister', app.includes('setNetworkIdPersister('));
  }

  // ── 5. persisting the corrected network on phone / web: in place, active account untouched
  {
    const mem = new Map<string, string>();
    const kv: SessionKv = { get: async k => mem.get(k) ?? null, set: async (k, v) => { mem.set(k, v); }, del: async k => { mem.delete(k); } };
    let n = 0;
    const store = createSessionStore(kv, { newId: () => `s${++n}`, now: () => 1000 });
    const a = await store.save({ serverUrl: 'https://hub.example.test', token: 'utok_lin', username: 'lin', networkId: PERSONAL });
    const b = await store.save({ serverUrl: 'https://other.example.test', token: 'utok_b', username: 'bob', networkId: 'net_b' });
    await store.setNetworkId(a.profileId!, TEAM);
    const idx = await store.loadIndex();
    const aNow = await store.loadSession(a.profileId!);
    ck('persist: corrected network written to the account credential', aNow?.networkId === TEAM && aNow?.token === 'utok_lin');
    ck('persist: index row updated', idx.sessions.find(s => s.id === a.profileId)?.networkId === TEAM);
    ck('persist: active account unchanged', idx.active === b.profileId);
    ck('persist: other account untouched', (await store.loadSession(b.profileId!))?.networkId === 'net_b');
    await store.setNetworkId('missing', TEAM);
    ck('persist: unknown account is a no-op', (await store.loadIndex()).sessions.length === 2);
  }
} finally {
  globalThis.fetch = originalFetch;
  setNetworkIdPersister(null);
}

console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
