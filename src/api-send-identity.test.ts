// REST sends must carry the authenticated username so older CommHubs
// never label desktop-originated work as the transport fallback `api`.
// Production hub 0.9.0-preview.38 already runs #1156 (omit `from` →
// authenticatedUsername). This client still sends `from` when it has a
// username; lookup is lazy and fail-open.
//
// Replaces the implementation path of sleep2agi/agent-network-app#68.
import { sendTask, type HubConfig } from './api';

let passed = 0;
let total = 0;
const check = (name: string, ok: boolean) => {
  total++;
  if (ok) { passed++; console.log('✅', name); }
  else { console.error('❌', name); }
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

  const fresh: HubConfig = {
    serverUrl: 'https://hub.example.test',
    token: 'utok_test',
    networkId: 'net_main',
    username: 'admin',
  };
  await sendTask(fresh, '通信牛', 'hello');
  const freshSend = calls.find(c => c.url.endsWith('/api/task'));
  check('fresh config sends authenticated username as from', freshSend?.body?.from === 'admin');
  check('fresh config needs no auth/me lookup', calls.every(c => !c.url.endsWith('/api/auth/me')));
  check('fresh config keeps dashboard steering meta', freshSend?.body?.meta?.source === 'dashboard-chat');

  calls.length = 0;
  const legacy: HubConfig = { serverUrl: 'https://hub.example.test', token: 'utok_old' };
  await sendTask(legacy, '通信牛', 'legacy hello');
  check('legacy config resolves identity before send', calls[0]?.url.endsWith('/api/auth/me') === true);
  const legacySend = calls.find(c => c.url.endsWith('/api/task'));
  check('legacy config sends resolved username', legacySend?.body?.from === 'admin');
  check('legacy config sends resolved network', legacySend?.body?.network_id === 'net_main');
  check('resolved identity is cached in memory', legacy.username === 'admin' && legacy.networkId === 'net_main');

  calls.length = 0;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    if (url.endsWith('/api/auth/me')) {
      return new Response('nope', { status: 500 });
    }
    return new Response(JSON.stringify({ ok: true, task_id: 't2' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  const broken: HubConfig = { serverUrl: 'https://hub.example.test', token: 'utok_old', networkId: 'net_main' };
  await sendTask(broken, '通信牛', 'degraded hello');
  const degradedSend = calls.find(c => c.url.endsWith('/api/task'));
  check('auth/me failure does not block the send', degradedSend?.body?.task === 'degraded hello');
  check('auth/me failure omits from instead of inventing api', !Object.prototype.hasOwnProperty.call(degradedSend?.body ?? {}, 'from'));
} finally {
  globalThis.fetch = originalFetch;
}

console.log(`\n${passed}/${total} passed`);
if (passed !== total) process.exit(1);
