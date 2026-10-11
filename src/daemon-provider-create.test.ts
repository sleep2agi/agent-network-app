import assert from 'node:assert/strict';
import { buildCreateNodeSpec } from './create-node-request';
import { parseProviderSnapshot } from './daemon-provider-management';
import { changeCreateProviderSelection, createProviderOptions, EMPTY_CREATE_PROVIDER, managedCreateReference } from './daemon-provider-create';
import { describeProviderCreateError } from './provider-create-options';
import { createRequestVerdict } from './create-request-status';

const snapshot = parseProviderSnapshot({ network_id: 'net-fixture', daemon_node_id: 'daemon-a', source: 'daemon', revision: 7,
  providers: [
    { id: 'custom', label: 'Configured Provider', enabled: true, runtimes: [{ runtime: 'codex-tui', auth: [
      { id: 'work', kind: 'api_key', models: ['configured-model'], baseUrl: 'https://api.example.test/v1', credential_present: true, verification: 'not_checked', application: 'not_applied' },
    ] }] },
    { id: 'openai', label: 'Official login', enabled: true, runtimes: [{ runtime: 'codex-tui', auth: [
      { id: 'account', kind: 'chatgpt', models: ['official-model'], account_id: '00000000-0000-0000-0000-000000000001', credential_present: true, verification: 'not_checked', application: 'not_applied' },
    ] }] },
  ] }, { networkId: 'net-fixture', daemonId: 'daemon-a' })!;
assert(snapshot);
const selected = { providerId: 'custom', authId: 'work', model: 'configured-model' };
assert.deepEqual(createProviderOptions(snapshot, selected).providers.map(p => p.id), ['custom']);
assert.deepEqual(createProviderOptions(snapshot, selected).auth.map(a => a.id), ['work']);
assert.deepEqual(createProviderOptions(snapshot, selected).models, ['configured-model']);
assert.equal(managedCreateReference(snapshot, 'codex-sdk', selected), null);
assert.equal(managedCreateReference(snapshot, 'codex-app-server', EMPTY_CREATE_PROVIDER), null);
assert.equal(managedCreateReference(snapshot, 'codex-app-server', { ...selected, model: 'not-configured' }), null);
console.log('PASS choices use enabled Daemon API-key profiles, never clone official accounts');

assert.deepEqual(changeCreateProviderSelection(selected, 'providerId', 'other'), { providerId: 'other', authId: '', model: '' });
assert.deepEqual(changeCreateProviderSelection(selected, 'authId', 'other'), { providerId: 'custom', authId: 'other', model: '' });
const ref = managedCreateReference(snapshot, 'codex-app-server', selected)!;
assert.deepEqual(ref, { revision: 7, provider_id: 'custom', auth_id: 'work', model: 'configured-model' });
console.log('PASS dependent selections reset and exact catalog revision is retained');

const input = { name: 'fixture', runtimeId: 'codex-app-server', runtimeModels: [], model: 'stale-model', permissionMode: 'default', maxTurns: '', budget: '', workdirField: {} };
const spec = buildCreateNodeSpec({ ...input, daemonProvider: ref });
assert.equal(spec.model, 'configured-model');
assert.deepEqual(spec.flags?.daemonProvider, ref);
assert.equal(spec.flags?.copresence, true);
assert(!JSON.stringify(spec).includes('baseUrl'));
assert.throws(() => buildCreateNodeSpec({ ...input, runtimeId: 'codex-sdk', daemonProvider: ref }), /invalid_daemon_provider_create/);
assert.throws(() => buildCreateNodeSpec({ ...input, daemonProvider: { ...ref, key: 'TEST-ONLY' } as typeof ref }), /invalid_daemon_provider_create/);
assert(!('daemonProvider' in (buildCreateNodeSpec(input).flags ?? {})));
console.log('PASS create request is identifier-only, selected model wins, legacy mode unchanged');
const upgrade = describeProviderCreateError({ error: 'flag_key_unknown', field: 'daemonProvider' });
assert(upgrade, 'old Hub must name the upgrade needed for the managed Provider flag');
for (const version of ['0.9.0-preview.124', '2.3.0-preview.166', '2.5.0-preview.132']) assert(upgrade.includes(version));
assert.equal(describeProviderCreateError({ error: 'validate: flag_key_unknown:daemonProvider' }), upgrade);
const rejected = createRequestVerdict({ status: 'failed', error: 'validate: flag_key_unknown:daemonProvider' });
assert.equal(rejected.kind, 'failed');
assert(rejected.kind === 'failed' && rejected.text.includes(upgrade));
assert.equal(describeProviderCreateError({ error: 'forbidden', field: 'daemonProvider' }), null);
assert.equal(describeProviderCreateError({ error: 'provider_revision_conflict' }), null);
assert.equal(describeProviderCreateError({ error: 'flag_key_unknown', field: 'unrelated' }), null);
console.log('PASS exact upgrade targets for old Hub/Daemon; permission and revision errors are not mislabeled');
console.log('4/4 Provider creation core groups PASS');
