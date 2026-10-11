import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EMPTY_HUB_PROVIDER, hubProviderInput, parseHubProvider, parseHubProviderCatalog } from './hub-provider-management';
let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log(`PASS ${name}`); };
const row = () => ({ id: 'shared', label: 'Shared', enabled: true, protocol: 'openai-responses', baseUrl: 'https://api.example.test/v1',
  models: ['model-a'], revision: 1, updated_at: 100, source: 'hub', credential_present: true, verification: 'not_checked', compatible_runtimes: ['codex-tui'] });
test('new config requires key; edit can omit it, models and protocol remain exact', () => {
  const f = { ...EMPTY_HUB_PROVIDER, id: 'shared', label: ' Shared ', baseUrl: 'https://api.example.test/v1', models: 'model-a, model-b', key: 'TEST-ONLY-key' };
  assert.deepEqual(hubProviderInput(f)?.models, ['model-a', 'model-b']); assert.equal(hubProviderInput(f)?.label, 'Shared');
  assert.equal(hubProviderInput({ ...f, key: '' }), null);
  assert(!('key' in hubProviderInput({ ...f, key: '', revision: 1 })!));
  assert.equal(hubProviderInput({ ...f, protocol: 'openai-chat-completions' })?.protocol, 'openai-chat-completions');
  for (const baseUrl of ['http://api.example.test', 'https://api.example.test?key=fake', 'https://user:pass@api.example.test']) assert.equal(hubProviderInput({ ...f, baseUrl }), null);
});
test('catalog pins network, metadata, revision and adapter capabilities', () => {
  const catalog = { ok: true, network_id: 'net-a', source: 'hub', providers: [row()] };
  const rows = parseHubProviderCatalog(catalog, 'net-a')!; assert.equal(rows.length, 1);
  catalog.providers[0].label = 'changed'; assert.equal(rows[0].label, 'Shared');
  assert.equal(parseHubProviderCatalog(catalog, 'net-b'), null);
  assert.equal(parseHubProviderCatalog({ ...catalog, providers: [row(), row()] }, 'net-a'), null);
  for (const patch of [{ key: 'TEST-ONLY-key' }, { revision: 0 }, { verification: 'verified' }, { id: null }, { label: null }, { compatible_runtimes: ['opencode-v2'] }]) assert.equal(parseHubProvider({ ...row(), ...patch }), null);
  assert(parseHubProvider({ ...row(), protocol: 'anthropic-messages', compatible_runtimes: [] }));
});
test('both live routes select the real scoped page, not demo storage', () => {
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const pending = readFileSync(new URL('./HubPendingScreen.tsx', import.meta.url), 'utf8');
  assert(app.includes("screen.name === 'hubProviders' ? <HubProviderManagementScreen cfg={cfg}"));
  assert(pending.includes("if (tab === 'provider') return <HubProviderManagementScreen cfg={cfg}"));
  const screen = readFileSync(new URL('./HubProviderManagementScreen.tsx', import.meta.url), 'utf8');
  assert(!/demo|localStorage|AsyncStorage|simulateProvider/.test(screen));
  assert(screen.includes('key={JSON.stringify([cfg.serverUrl, cfg.networkId, cfg.token])}'));
});
console.log(`${passed}/3 core tests passed`);
