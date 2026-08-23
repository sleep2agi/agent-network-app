// REST sends must carry the authenticated username so CommHub message feeds
// never label desktop-originated work as the transport fallback `api`.
import { sendTask, type HubConfig } from './api';

let passed = 0;
let total = 0;
const check = (name: string, ok: boolean) => {
  total++;
  if (ok) { passed++; console.log('✅', name); }
  else console.error('❌', name);
};

const originalFetch = globalThis.fetch;
try {
  const calls: Array<{ url: string; body?: any }> = [];
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    if (url.endsWith('/api/auth/me')) {
      return new Response(JSON.stringify({
        user: { username: 'admin' },
        current_network: { network_id: 'net_main' },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ ok: true, task_id: 't1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  const fresh: HubConfig = { serverUrl: 'https://hub.example.test', token: 'utok_test', networkId: 'net_main', username: 'admin' };
  await sendTask(fresh, '通信牛', 'hello');
  check('fresh config sends authenticated username as from', calls[0]?.body?.from === 'admin');
  check('fresh config needs no auth/me lookup', calls.length === 1);

  calls.length = 0;
  const legacy: HubConfig = { serverUrl: 'https://hub.example.test', token: 'utok_old' };
  await sendTask(legacy, '通信牛', 'legacy hello');
  check('legacy config resolves identity before send', calls[0]?.url.endsWith('/api/auth/me') === true);
  check('legacy config sends resolved username', calls[1]?.body?.from === 'admin');
  check('legacy config sends resolved network', calls[1]?.body?.network_id === 'net_main');
  check('resolved identity is cached in memory', legacy.username === 'admin' && legacy.networkId === 'net_main');
} finally {
  globalThis.fetch = originalFetch;
}

console.log(`\n${passed}/${total} passed`);
if (passed !== total) process.exit(1);
