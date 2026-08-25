import { sendTask, type HubConfig } from './api';

let passed = 0;
let total = 0;
const check = (name: string, condition: boolean) => {
  total++;
  if (!condition) throw new Error(`FAIL: ${name}`);
  passed++;
};

const cfg: HubConfig = { serverUrl: 'https://hub.example', token: 'utok_test', networkId: 'net_1' };
const originalFetch = globalThis.fetch;

try {
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: false, error: 'duplicate_send' }), {
    status: 429,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch;
  const duplicate = await sendTask(cfg, '通信牛', 'same task');
  check('structured duplicate_send is treated as already delivered', duplicate.ok === true && duplicate.deduplicated === true);

  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: false, error: 'rate_limited' }), {
    status: 429,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch;
  let other429 = '';
  try { await sendTask(cfg, '通信牛', 'different task'); } catch (error) { other429 = String(error); }
  check('an unrelated 429 remains a failure', other429.includes('HTTP 429'));

  globalThis.fetch = (async () => new Response('not json', { status: 502 })) as typeof fetch;
  let malformed = '';
  try { await sendTask(cfg, '通信牛', 'gateway failure'); } catch (error) { malformed = String(error); }
  check('a malformed error response remains a failure', malformed.includes('HTTP 502'));
} finally {
  globalThis.fetch = originalFetch;
}

console.log(`send duplicate response: ${passed}/${total} checks passed`);
