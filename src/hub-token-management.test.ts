import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hubTokenInput, parseHubTokenNames } from './hub-token-management';
let passed = 0;
const test = (name: string, run: () => void) => { run(); passed++; console.log(`PASS ${name}`); };
test('write names match Hub schema without changing secret bytes', () => {
  assert.deepEqual(hubTokenInput(' DEEPSEEK_API_KEY ', 'secret bytes '), { key: 'DEEPSEEK_API_KEY', value: 'secret bytes ' });
  for (const key of ['lower', '', 'BAD-NAME', 'A'.repeat(65)]) assert.equal(hubTokenInput(key, 'test-only'), null);
  assert.equal(hubTokenInput('KEY', ''), null); assert.equal(hubTokenInput('KEY', 'a'.repeat(16385)), null);
});
test('only key names are accepted from names-only API', () => {
  assert.deepEqual(parseHubTokenNames({ ok: true, keys: ['Z_KEY', 'A_KEY'] }), ['A_KEY', 'Z_KEY']);
  assert.deepEqual(parseHubTokenNames({ ok: true, keys: [] }), []);
  for (const row of [{ ok: false, keys: [] }, { ok: true, keys: ['KEY', 'KEY'] }, { ok: true, keys: ['bad'] }, { ok: true, keys: [], value: 'secret' }]) assert.equal(parseHubTokenNames(row), null);
});
test('both actual routes select scoped write-only screen', () => {
  const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
  assert(read('../App.tsx').includes("screen.name === 'hubTokens' ? <HubTokenManagementScreen cfg={cfg}"));
  assert(read('./HubPendingScreen.tsx').includes("if (tab === 'tokens') return <HubTokenManagementScreen cfg={cfg}"));
  const ui = read('./HubTokenManagementScreen.tsx');
  assert(ui.includes('key={JSON.stringify([cfg.serverUrl, cfg.networkId, cfg.token])}'));
  assert(ui.includes("setValue('')")); assert(!/localStorage|AsyncStorage|demoToken/.test(ui));
  const api = read('./hub-token-management-api.ts');
  assert(api.includes("'upsert_network_secret', input, signal, true"));
  assert(api.includes("'list_network_secrets'")); assert(!api.includes('get_network_secret'));
});
console.log(`${passed}/3 Hub token core groups passed`);
