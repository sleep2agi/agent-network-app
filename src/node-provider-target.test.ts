import assert from 'node:assert/strict';
import { nodeProviderDaemon, daemonProviderNodeRuntime } from './node-provider-target';
import { EMPTY_PROVIDER_SELECTION, providerApplicationWrite } from './daemon-provider-selection';
import type { ProviderSnapshot } from './daemon-provider-management';

const test = (name: string, run: () => void) => { run(); console.log(`PASS ${name}`); };
test('node scope comes from binding, not host or pending adoption', () => {
  const n = { node_id: 'n_one', alias: 'one', hostname: 'same-host' };
  assert.equal(nodeProviderDaemon(n), null);
  assert.equal(nodeProviderDaemon({ ...n, lifecycle_daemon_node_id: 'daemon-a' }), 'daemon-a');
  assert.equal(nodeProviderDaemon({ ...n, adoption: { request_id: 'r', daemon_node_id: 'daemon-b', status: 'pending', error: null } }), null);
  assert.equal(nodeProviderDaemon({ ...n, adoption: { request_id: 'r', daemon_node_id: 'daemon-b', status: 'active', error: null } }), 'daemon-b');
  assert.equal(daemonProviderNodeRuntime('codex-app-server'), true);
  assert.equal(daemonProviderNodeRuntime('codex-sdk'), false);
});
test('pinned node produces the existing daemon apply request and refuses foreign node', () => {
  const snapshot: ProviderSnapshot = { network_id: 'net-a', daemon_node_id: 'daemon-a', source: 'daemon', revision: 3,
    providers: [{ id: 'deepseek', label: 'DeepSeek', enabled: true, runtimes: [{ runtime: 'codex-tui', auth: [{
      id: 'work', kind: 'api_key', models: ['model-one'], baseUrl: 'https://example.test/v1', credential_present: true,
      verification: 'not_checked', application: 'not_applied',
    }] }] }], codex_inventory: { observed_at: 1, scope: 'hub_bound_nodes', rows: [{ node_id: 'n_one', alias: 'one',
      status: 'observed', runtime: 'codex-app-server', config_revision: 'a'.repeat(64) }] } };
  const s = { ...EMPTY_PROVIDER_SELECTION, nodeId: 'n_one', providerId: 'deepseek', authId: 'work', model: 'model-one' };
  assert.deepEqual(providerApplicationWrite(snapshot, s, true)?.provider, { node_id: 'n_one', node_revision: 'a'.repeat(64),
    provider_id: 'deepseek', auth_id: 'work', model: 'model-one', confirm_restart: true });
  assert.equal(providerApplicationWrite(snapshot, { ...s, nodeId: 'foreign' }, true), null);
  assert.equal(providerApplicationWrite(snapshot, { ...s, model: 'foreign-model' }, true), null);
});
