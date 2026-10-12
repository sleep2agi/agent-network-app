import assert from 'node:assert/strict';
import { runProviderLogin } from './daemon-provider-login';
const scope = { networkId: 'net-fixture', daemonId: 'daemon-fixture' };
const session = 'b86c3ca5-5022-434d-bc9f-aa1c82ecf419';
const request = `dpl_${session}`;
const intent = { action: 'start' as const, session_id: session };
const view = { request_id: session, status: 'awaiting_user', challenge: {
  loginId: session, verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'TEST-ONLY' } };
const pending = { kind: 'payload' as const, value: { ok: true, request_id: request, status: 'pending' } };
const receipt = (login: unknown = view, daemon = scope.daemonId) => ({ kind: 'payload' as const,
  value: { ok: true, request_id: request, daemon_node_id: daemon, status: 'succeeded', login } });
let passed = 0;
async function test(name: string, run: () => Promise<void>) { await run(); passed++; console.log(`PASS ${name}`); }
await test('one login submission followed by exact scoped receipt', async () => {
  const calls: string[] = [];
  const result = await runProviderLogin(scope, intent, async action => { calls.push(action); return action === 'login' ? pending : receipt(); }, new AbortController().signal);
  assert.deepEqual(result, { kind: 'ready', value: view });
  assert.deepEqual(calls, ['login', 'read']);
});
await test('wrong daemon and secret-bearing or foreign-link replies are not displayed', async () => {
  for (const result of [receipt(view, 'other'), receipt({ ...view, token: 'SECRET' }),
    receipt({ ...view, challenge: { ...view.challenge, verificationUrl: 'https://example.test/login' } })]) {
    assert.equal((await runProviderLogin(scope, intent, async action => action === 'login' ? pending : result, new AbortController().signal)).kind, 'unconfirmed');
  }
});
await test('a pending or hung request is bounded, without resubmitting login', async () => {
  let submissions = 0;
  const result = await runProviderLogin(scope, intent, async action => {
    if (action === 'login') { submissions++; return pending; }
    return new Promise(() => {});
  }, new AbortController().signal, { timeoutMs: 10 });
  assert.equal(result.kind, 'unconfirmed'); assert.equal(submissions, 1);
});
await test('saved-account list is scoped and never upgrades not_checked to verified', async () => {
  const accounts = [{ version: 1, network_id: scope.networkId, daemon_node_id: scope.daemonId,
    account_id: session, label: 'Work', created_at: 1, auth_state: 'not_checked' }];
  const run = (rows: unknown[]) => runProviderLogin(scope, { action: 'accounts' }, async action => action === 'login' ? pending : receipt({ accounts: rows }), new AbortController().signal);
  assert.equal((await run(accounts)).kind, 'ready');
  assert.equal((await run([{ ...accounts[0], auth_state: 'verified' }])).kind, 'unconfirmed');
});
await test('forbidden is not empty inventory; aborted start performs no request', async () => {
  assert.equal((await runProviderLogin(scope, intent, async () => ({ kind: 'forbidden' }), new AbortController().signal)).kind, 'forbidden');
  const ctrl = new AbortController(); ctrl.abort();
  assert.equal((await runProviderLogin(scope, intent, async () => { throw Error('must not call'); }, ctrl.signal)).kind, 'unconfirmed');
});
console.log(`${passed} login command core checks passed`);
