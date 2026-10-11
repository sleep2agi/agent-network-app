import assert from 'node:assert/strict';
import { providerAccountWrite } from './daemon-provider-account-binding';
import { parseProviderSnapshot, providerEnabledWrite, providerKeyWrite } from './daemon-provider-management';
const account = '11111111-1111-4111-8111-111111111111';
const snapshot = { network_id: 'net', daemon_node_id: 'daemon', source: 'daemon' as const, revision: 4, providers: [] };
const write = providerAccountWrite(snapshot, account, 'model-a,model-a,model-b')!;
assert.equal(write.revision, 4);
assert.deepEqual(write.provider.runtimes[0].auth[0].models, ['model-a', 'model-b']);
assert.equal(providerAccountWrite(snapshot, '../auth.json', 'model-a'), null);
assert.equal(providerAccountWrite(snapshot, account, ''), null);
const provider = { ...write.provider, runtimes: write.provider.runtimes.map(r => ({ ...r, auth: r.auth.map(a => ({ ...a,
  credential_present: true, verification: 'not_checked', application: 'not_applied' })) })) };
const parsed = parseProviderSnapshot({ ...snapshot, providers: [provider] }, { networkId: 'net', daemonId: 'daemon' })!;
assert(parsed);
assert.equal((providerEnabledWrite(parsed, 'openai', false)!.provider as any).runtimes[0].auth[0].account_id, account);
const key = providerKeyWrite(parsed, { id: 'openai', label: 'OpenAI', authId: 'api', baseUrl: 'https://api.example.test/v1', models: 'model-a', key: 'TEST-ONLY' })!;
assert.equal((key.provider as any).runtimes[0].auth[0].account_id, account);
assert.equal(parseProviderSnapshot({ ...snapshot, providers: [{ ...provider, runtimes: [{ runtime: 'codex-tui', auth: [{ ...provider.runtimes[0].auth[0], account_id: undefined }] }] }] }, { networkId: 'net', daemonId: 'daemon' }), null);
console.log('5/5 saved account binding core checks passed');
