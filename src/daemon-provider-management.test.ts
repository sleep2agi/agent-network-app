import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadProviderSnapshot, parseProviderRpc, parseProviderSnapshot, providerConfiguredCounts, providerKeyWrite, providerEnabledWrite, scopedProviderSave, type ProviderRpc } from './daemon-provider-management';
import { changeProviderSelection, EMPTY_PROVIDER_SELECTION, providerSelectionOptions, resolveProviderSelection, providerApplicationWrite } from './daemon-provider-selection';
import { runProviderApplication } from './daemon-provider-application';
let passed = 0;
const test = async (name: string, run: () => void | Promise<void>) => { await run(); passed++; console.log(`PASS ${name}`); };
const scope = { networkId: 'net-fixture', daemonId: 'daemon-a' };
const requestId = 'dps_00000000-0000-0000-0000-000000000001';
const snapshot = () => ({ network_id: scope.networkId, daemon_node_id: scope.daemonId, revision: 2, source: 'daemon', providers: [
  { id: 'deepseek', label: 'DeepSeek', enabled: true, runtimes: [{ runtime: 'codex-tui', auth: [
    { id: 'work', kind: 'api_key', models: ['deepseek-chat'], baseUrl: 'https://api.example.test/v1', credential_present: true, verification: 'not_checked', application: 'not_applied' },
  ] }] },
] });
const pending = () => ({ kind: 'payload' as const, value: { ok: true, request_id: requestId, status: 'pending', daemon_node_id: scope.daemonId } });
const receipt = () => ({ kind: 'payload' as const, value: { ...pending().value, status: 'succeeded', snapshot: snapshot(), observed_at: 1000 } });
const rpcBody = (v: unknown) => JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(v) }] } });
await test('application submits once, accepts only exact receipt and never treats timeout as rollback', async () => {
  const applicationId = 'dpa_00000000-0000-0000-0000-000000000001';
  const write = { revision: 2, provider: { node_id: 'n_a', node_revision: 'a'.repeat(64), provider_id: 'deepseek', auth_id: 'work', model: 'deepseek-chat', confirm_restart: true as const } };
  for (const mode of ['ok', 'foreign', 'wrong-model', 'hang'] as const) {
    let submits = 0;
    const result = await runProviderApplication(scope, write, async action => {
      if (action === 'apply') { submits++; return { kind: 'payload', value: { status: 'pending', request_id: applicationId } }; }
      if (mode === 'hang') return new Promise(() => {});
      return { kind: 'payload', value: { status: 'succeeded', request_id: applicationId, daemon_node_id: mode === 'foreign' ? 'another' : scope.daemonId,
        application: { status: 'applied', request_id: applicationId, node_id: 'n_a', provider_id: 'deepseek', auth_id: 'work', model: mode === 'wrong-model' ? 'wrong' : 'deepseek-chat',
          runtime_provider: 'anet_' + 'b'.repeat(20), node_revision: 'c'.repeat(64), provider_revision: 2, verification: 'runtime_confirmed', applied_at: Date.now() } } };
    }, new AbortController().signal, { timeoutMs: 25, pollMs: 0 });
    assert.equal(result.kind, mode === 'ok' ? 'applied' : 'unconfirmed'); assert.equal(submits, 1);
  }
});
await test('valid snapshot detached and configured is not healthy', () => {
  const v = snapshot(); const parsed = parseProviderSnapshot(v, scope)!;
  assert(parsed); v.providers[0].label = 'changed'; assert.equal(parsed.providers[0].label, 'DeepSeek');
  assert.equal(parsed.providers[0].runtimes[0].auth[0].verification, 'not_checked');
});
await test('scope mismatches cannot expose a foreign daemon/network', () => {
  assert.equal(parseProviderSnapshot(snapshot(), { ...scope, daemonId: 'daemon-b' }), null);
  assert.equal(parseProviderSnapshot(snapshot(), { ...scope, networkId: 'net-b' }), null);
});
await test('secret-shaped extensions and false verified claims rejected', () => {
  for (const change of [
    (v: any) => { v.api_key = 'FAKE-secret'; },
    (v: any) => { v.providers[0].runtimes[0].auth[0].key = 'FAKE-secret'; },
    (v: any) => { v.providers[0].runtimes[0].auth[0].verification = 'verified'; },
    (v: any) => { v.providers[0].runtimes[0].auth[0].baseUrl += '?key=FAKE-secret'; },
  ]) { const v = snapshot(); change(v); assert.equal(parseProviderSnapshot(v, scope), null); }
});
await test('malformed nested arrays and duplicate identities rejected without throwing', () => {
  for (const change of [
    (v: any) => { v.providers = [null]; },
    (v: any) => { v.providers[0].runtimes[0].auth = [null]; },
    (v: any) => { v.providers.push(v.providers[0]); },
    (v: any) => { v.revision = -1; },
    (v: any) => { v.providers[0].runtimes[0].auth[0].models.push('deepseek-chat'); },
  ]) { const v = snapshot(); change(v); assert.equal(parseProviderSnapshot(v, scope), null); }
});
await test('official login only under openai and never inferred from configuration', () => {
  const v: any = snapshot(); const a = v.providers[0].runtimes[0].auth[0];
  a.kind = 'chatgpt'; a.credential_present = false; delete a.baseUrl;
  assert.equal(parseProviderSnapshot(v, scope), null); v.providers[0].id = 'openai'; assert(parseProviderSnapshot(v, scope));
});
await test('count tuple provider/runtime/model once across auth profiles; disabled explicitly counted', () => {
  const v = snapshot(); const auth = v.providers[0].runtimes[0].auth;
  auth.push({ ...auth[0], id: 'personal' }); v.providers[0].enabled = false;
  const parsed = parseProviderSnapshot(v, scope)!;
  assert.deepEqual(providerConfiguredCounts(parsed), { providers: 1, enabled: 0, models: 1 });
});
await test('valid empty configuration differs from unsupported/offline', () => {
  const v = snapshot(); v.providers = [];
  assert.deepEqual(providerConfiguredCounts(parseProviderSnapshot(v, scope)!), { providers: 0, enabled: 0, models: 0 });
});
await test('JSON and SSE envelope parsed; errors do not leak raw server text', () => {
  const body = rpcBody(receipt().value);
  assert.equal(parseProviderRpc(200, body).kind, 'payload');
  assert.equal(parseProviderRpc(200, `event: message\r\ndata: ${body}\r\n\r\n`).kind, 'payload');
  assert.deepEqual(parseProviderRpc(200, rpcBody({ ok: false, error: 'FAKE-secret' })), { kind: 'error' });
  assert.deepEqual(parseProviderRpc(200, '<html>bad proxy</html>'), { kind: 'error' });
});
await test('unauthorized/unsupported are explicit with no network fallback', () => {
  assert.deepEqual(parseProviderRpc(401, ''), { kind: 'forbidden' });
  assert.deepEqual(parseProviderRpc(200, rpcBody({ ok: false, error: 'provider_admin_required' })), { kind: 'forbidden' });
  assert.deepEqual(parseProviderRpc(200, JSON.stringify({ error: { message: 'Unknown tool daemon_provider_snapshot' } })), { kind: 'unsupported' });
  assert.deepEqual(parseProviderRpc(404, ''), { kind: 'unsupported' });
});
await test('refresh → pending read → exact scoped receipt', async () => {
  const calls: string[] = [];
  const result = await loadProviderSnapshot(scope, async (action, id) => {
    calls.push(`${action}:${id}`); return calls.length < 3 ? pending() : receipt();
  }, new AbortController().signal, { pollMs: 1 });
  assert.equal(result.kind, 'ready'); assert.deepEqual(calls, [`refresh:${scope.daemonId}`, `read:${requestId}`, `read:${requestId}`]);
});
await test('foreign receipt target rejected', async () => {
  const result = await loadProviderSnapshot(scope, async action => action === 'refresh' ? pending() : {
    ...receipt(), value: { ...receipt().value, daemon_node_id: 'daemon-b' },
  }, new AbortController().signal);
  assert.equal(result.kind, 'error');
});
await test('deadline bounds hung transport even when native fetch ignores abort', async () => {
  const result = await loadProviderSnapshot(scope, () => new Promise(() => {}), new AbortController().signal, { timeoutMs: 10 });
  assert.equal(result.kind, 'timeout');
});
await test('cancel navigation and stop polling without processing late responses', async () => {
  const ctrl = new AbortController(); let calls = 0;
  const result = loadProviderSnapshot(scope, async () => { calls++; return pending(); }, ctrl.signal, { pollMs: 1000 });
  setTimeout(() => ctrl.abort(), 5);
  assert.equal((await result).kind, 'cancelled'); assert.equal(calls, 2);
});
await test('pre-cancel and missing scope make zero requests', async () => {
  const ctrl = new AbortController(); ctrl.abort();
  const rpc: ProviderRpc = () => { throw new Error('must not call'); };
  assert.equal((await loadProviderSnapshot(scope, rpc, ctrl.signal)).kind, 'cancelled');
  assert.equal((await loadProviderSnapshot({ ...scope, networkId: '' }, rpc, new AbortController().signal)).kind, 'error');
});
await test('terminal error/expired stop without retrying writes or interpreting snapshot', async () => {
  for (const status of ['failed', 'expired', 'unknown']) {
    let calls = 0;
    const result = await loadProviderSnapshot(scope, async action => {
      calls++; return action === 'refresh' ? pending() : { ...receipt(), value: { ...receipt().value, status } };
    }, new AbortController().signal);
    assert.equal(result.kind, status === 'expired' ? 'timeout' : 'error'); assert.equal(calls, 2);
  }
});
await test('screen entry is real and render-time identity barrier includes auth/network/daemon', () => {
  const screen = readFileSync(new URL('./DaemonManagementScreen.tsx', import.meta.url), 'utf8');
  const pane = readFileSync(new URL('./DaemonProvidersPane.tsx', import.meta.url), 'utf8');
  assert(screen.includes("pendingSection === 'provider'")); assert(screen.includes('<DaemonProvidersPane'));
  assert(pane.includes('result?.identity === identity')); assert(pane.includes('cfg.serverUrl, cfg.networkId, cfg.token, daemonId'));
  assert(pane.includes('return () => { ctrl.abort(); writeController.current?.abort(); }')); assert(!pane.includes('list_providers'));
});
await test('API key edit preserves sibling auth; endpoint change needs key; saved revision is explicit', () => {
  const current = parseProviderSnapshot(snapshot(), scope)!;
  current.providers[0].runtimes[0].auth.push({ ...current.providers[0].runtimes[0].auth[0], id: 'personal' });
  const form = { id: 'deepseek', label: 'Updated', authId: 'work', baseUrl: 'https://api.example.test/v1', models: 'model-b', key: '' };
  const write = providerKeyWrite(current, form)!;
  assert.equal(write.revision, 2); const p = write.provider as any;
  assert.equal(p.runtimes[0].auth.length, 2); assert.equal(p.runtimes[0].auth[0].key, undefined);
  assert.deepEqual(p.runtimes[0].auth[1].models, ['deepseek-chat']);
  assert.equal(providerKeyWrite(current, { ...form, baseUrl: 'https://other.example.test' }), null);
  assert(providerKeyWrite(current, { ...form, id: 'another', key: 'FAKE-test-only-key' }));
});
await test('existing inventory stays separate, unknown credentials are not logout and secret additions fail closed', () => {
  const v: any = { ...snapshot(), codex_inventory: { observed_at: 1000, scope: 'hub_bound_nodes', rows: [{
    node_id: 'n_existing', alias: 'existing', status: 'observed', runtime: 'codex-app-server', home_ref: '1234567890abcdef', home_source: 'node-codex-home',
    config_status: 'read', configured_provider: 'deepseek', configured_model: 'test-model', node_configured_model: null, provider_ids: ['deepseek'],
    auth_kind: 'api_key', credential_status: 'unknown', account_fingerprint: null, verification: 'not_checked', effective_state: 'not_checked',
  }] } };
  assert(parseProviderSnapshot(v, scope)); assert.equal(providerConfiguredCounts(parseProviderSnapshot(v, scope)!).providers, 1);
  v.codex_inventory.rows[0].key = 'TEST-ONLY'; assert.equal(parseProviderSnapshot(v, scope), null);
  delete v.codex_inventory.rows[0].key; v.codex_inventory.rows[0].effective_state = 'applied'; assert.equal(parseProviderSnapshot(v, scope), null);
});
await test('save status never crosses Hub, credential, network, daemon or refresh scope', () => {
  const parts = ['https://hub.example.test', 'net-a', 'TEST-ONLY-token-a', 'daemon-a', false, 0];
  const identity = JSON.stringify(parts);
  for (const phase of ['saving', 'saved', 'unconfirmed'] as const) {
    const state = { identity, phase };
    assert.equal(scopedProviderSave(state, identity), phase);
    for (let i = 0; i < parts.length; i++) {
      const changed = [...parts]; changed[i] = `${changed[i]}-changed`;
      assert.equal(scopedProviderSave(state, JSON.stringify(changed)), '');
    }
  }
  assert.equal(scopedProviderSave(null, identity), '');
  const pane = readFileSync(new URL('./DaemonProvidersPane.tsx', import.meta.url), 'utf8');
  assert(pane.includes('scopedProviderSave(saveState, identity)'));
  assert(pane.includes("const saving = saveNote === 'saving'"));
});
await test('selection is scoped to scanned TUI nodes and enabled provider/auth/model tuples', () => {
  const v = parseProviderSnapshot(snapshot(), scope)!;
  v.codex_inventory = { observed_at: 1000, scope: 'hub_bound_nodes', rows: [
    { node_id: 'n_a', alias: 'a', status: 'observed', runtime: 'codex-app-server' },
    { node_id: 'n_sdk', alias: 'sdk', status: 'observed', runtime: 'codex-sdk' },
    { node_id: 'n_unknown', alias: 'unknown', status: 'unavailable' },
  ] };
  const selected = { nodeId: 'n_a', providerId: 'deepseek', authId: 'work', model: 'deepseek-chat' };
  assert.deepEqual(providerSelectionOptions(v, selected).nodes.map(n => n.node_id), ['n_a']);
  const resolved = resolveProviderSelection(v, selected)!;
  assert.equal(resolved.daemonId, scope.daemonId); assert.equal(resolved.providerRevision, 2);
  assert.equal(resolved.authKind, 'api_key'); assert.equal('key' in resolved, false);
  assert.equal(providerApplicationWrite(v, selected, true), null); // old scan has no revision
  v.codex_inventory.rows[0].config_revision = 'a'.repeat(64);
  assert.equal(providerApplicationWrite(v, selected, false), null);
  assert.deepEqual(providerApplicationWrite(v, selected, true), { revision: 2, provider: {
    node_id: 'n_a', node_revision: 'a'.repeat(64), provider_id: 'deepseek', auth_id: 'work', model: 'deepseek-chat', confirm_restart: true,
  } });
  for (const change of [{ nodeId: 'foreign' }, { providerId: 'foreign' }, { authId: 'foreign' }, { model: 'foreign' }]) {
    assert.equal(resolveProviderSelection(v, { ...selected, ...change }), null);
  }
  v.providers[0].enabled = false; assert.equal(resolveProviderSelection(v, selected), null);
  v.providers[0].enabled = true; delete v.codex_inventory; assert.equal(resolveProviderSelection(v, selected), null);
});
await test('changing node/provider/auth clears dependent selections without inferring a default', () => {
  const selected = { nodeId: 'n_a', providerId: 'deepseek', authId: 'work', model: 'shared-model' };
  assert.deepEqual(changeProviderSelection(selected, 'nodeId', 'n_b'), { ...EMPTY_PROVIDER_SELECTION, nodeId: 'n_b' });
  assert.deepEqual(changeProviderSelection(selected, 'providerId', 'new'), { ...selected, providerId: 'new', authId: '', model: '' });
  assert.deepEqual(changeProviderSelection(selected, 'authId', 'new'), { ...selected, authId: 'new', model: '' });
  assert.deepEqual(changeProviderSelection(selected, 'model', 'new'), { ...selected, model: 'new' });
});
await test('enable/disable writes preserve profiles, omit secrets and carry expected revision', () => {
  const current = parseProviderSnapshot(snapshot(), scope)!;
  const before = JSON.stringify(current);
  current.providers[0].runtimes[0].auth.push({ ...current.providers[0].runtimes[0].auth[0], id: 'personal' });
  const write = providerEnabledWrite(current, 'deepseek', false)!;
  assert.equal(write.revision, 2);
  assert.deepEqual(write.provider, { id: 'deepseek', label: 'DeepSeek', enabled: false, runtimes: [{ runtime: 'codex-tui', auth: [
    { id: 'work', kind: 'api_key', models: ['deepseek-chat'], baseUrl: 'https://api.example.test/v1' },
    { id: 'personal', kind: 'api_key', models: ['deepseek-chat'], baseUrl: 'https://api.example.test/v1' },
  ] }] });
  assert.equal(current.providers[0].enabled, true);
  assert.equal(providerEnabledWrite(current, 'foreign', false), null);
  assert.equal(providerEnabledWrite(current, 'deepseek', true), null);
  (write.provider as any).runtimes[0].auth[0].models.push('no-aliasing');
  assert.deepEqual(current.providers[0].runtimes[0].auth[0].models, JSON.parse(before).providers[0].runtimes[0].auth[0].models);
});
console.log(`${passed}/${passed} passed`);
