import { test, expect } from 'bun:test';
import { nodeProviderDaemon, daemonProviderNodeRuntime } from './node-provider-target';
import { EMPTY_PROVIDER_SELECTION, providerApplicationWrite } from './daemon-provider-selection';
import type { ProviderSnapshot } from './daemon-provider-management';

test('node scope comes from binding, not host or pending adoption', () => {
  const n = { node_id: 'n_one', alias: 'one', hostname: 'same-host' };
  expect(nodeProviderDaemon(n)).toBeNull();
  expect(nodeProviderDaemon({ ...n, lifecycle_daemon_node_id: 'daemon-a' })).toBe('daemon-a');
  expect(nodeProviderDaemon({ ...n, adoption: { request_id: 'r', daemon_node_id: 'daemon-b', status: 'pending', error: null } })).toBeNull();
  expect(nodeProviderDaemon({ ...n, adoption: { request_id: 'r', daemon_node_id: 'daemon-b', status: 'active', error: null } })).toBe('daemon-b');
  expect(daemonProviderNodeRuntime('codex-app-server')).toBe(true);
  expect(daemonProviderNodeRuntime('codex-sdk')).toBe(false);
});
test('pinned node produces the existing daemon apply request and refuses foreign node', () => {
  const snapshot: ProviderSnapshot = { network_id: 'net-a', daemon_node_id: 'daemon-a', source: 'daemon', revision: 3,
    providers: [{ id: 'deepseek', label: 'DeepSeek', enabled: true, runtimes: [{ runtime: 'codex-tui', auth: [{
      id: 'work', kind: 'api_key', models: ['model-one'], baseUrl: 'https://example.test/v1', credential_present: true,
      verification: 'not_checked', application: 'not_applied',
    }] }] }], codex_inventory: { observed_at: 1, scope: 'hub_bound_nodes', rows: [{ node_id: 'n_one', alias: 'one',
      status: 'observed', runtime: 'codex-app-server', config_revision: 'a'.repeat(64) }] } };
  const s = { ...EMPTY_PROVIDER_SELECTION, nodeId: 'n_one', providerId: 'deepseek', authId: 'work', model: 'model-one' };
  expect(providerApplicationWrite(snapshot, s, true)?.provider).toEqual({ node_id: 'n_one', node_revision: 'a'.repeat(64),
    provider_id: 'deepseek', auth_id: 'work', model: 'model-one', confirm_restart: true });
  expect(providerApplicationWrite(snapshot, { ...s, nodeId: 'foreign' }, true)).toBeNull();
  expect(providerApplicationWrite(snapshot, { ...s, model: 'foreign-model' }, true)).toBeNull();
});
