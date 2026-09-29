// @ts-nocheck -- repository test scripts run directly under Bun; the app
// tsconfig intentionally excludes Node ambient types.
import { readFileSync } from 'node:fs';
import { appFetch, decodePooledResponse } from './app-fetch';

let passed = 0;
let total = 0;
const ck = (name: string, condition: boolean) => {
  total++;
  if (condition) { passed++; console.log('✅', name); }
  else console.log('❌', name);
};

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const transportSource = readFileSync(new URL('./app-fetch.ts', import.meta.url), 'utf8');
const capabilities = JSON.parse(readFileSync(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8'));
const httpPermission = capabilities.permissions.find((permission: unknown) =>
  typeof permission === 'object' && permission !== null && permission.identifier === 'http:default'
);
const allowedHubUrls = new Set(httpPermission?.allow?.map(({ url }: { url: string }) => url));

ck('App never replaces the global fetch used by Tauri IPC', !/globalThis[^\n]*\.fetch\s*=/.test(appSource));
ck('Tauri transport calls the plugin explicitly', /tauriFetch\(input, init\)/.test(transportSource));
ck('web transport delegates to the current global fetch', /globalThis\.fetch\(input, init\)/.test(transportSource));
ck('Tauri transport permits HTTP hubs on explicit ports', allowedHubUrls.has('http://*:*/*'));
ck('Tauri transport permits HTTPS hubs on explicit ports', allowedHubUrls.has('https://*:*/*'));

const originalFetch = globalThis.fetch;
try {
  let seen = '';
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    seen = String(input);
    return new Response('{"ok":true}', { status: 200 });
  }) as typeof fetch;
  const response = await appFetch('http://127.0.0.1/test');
  ck('non-Tauri runtime uses the browser/RN transport', seen === 'http://127.0.0.1/test' && response.ok);
} finally {
  globalThis.fetch = originalFetch;
}

// ── Desktop: one pooled client (src-tauri/src/hub_http.rs) instead of a new client per request ──
const libSource = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const hubHttpSource = readFileSync(new URL('../src-tauri/src/hub_http.rs', import.meta.url), 'utf8');
const cargoToml = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
ck('pooled_fetch is registered with the Tauri shell', /hub_http::pooled_fetch,/.test(libSource));
ck('pooled_fetch keeps ONE client for the process (not a builder per request)', /static CLIENT: LazyLock</.test(hubHttpSource) && !/async fn pooled_fetch[\s\S]*ClientBuilder::new\(\)/.test(hubHttpSource));
const poolDep = cargoToml.match(/reqwest_pool = \{[^\n]*\}/)?.[0] ?? '';
// Same TLS / proxy / gzip as tauri-plugin-http's defaults + our gzip, so only the pooling changes.
ck('pooled client uses the plugin\'s reqwest line and features', /version = "0\.12"/.test(poolDep) && ['rustls-tls', 'http2', 'charset', 'macos-system-configuration', 'gzip'].every(f => poolDep.includes(`"${f}"`)));

const frame = (meta: object, body: string | Uint8Array) => {
  const m = new TextEncoder().encode(JSON.stringify(meta));
  const b = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const out = new Uint8Array(4 + m.length + b.length);
  new DataView(out.buffer).setUint32(0, m.length, false);
  out.set(m, 4); out.set(b, 4 + m.length);
  return out.buffer;
};
{
  const r = decodePooledResponse(frame({ status: 201, statusText: 'Created', url: 'http://h/x', headers: [['content-type', 'application/json'], ['etag', '"v1"']] }, '{"ok":true}'));
  ck('decoded response keeps status, url, headers and body', r.status === 201 && r.url === 'http://h/x' && r.headers.get('etag') === '"v1"' && (await r.json()).ok === true);
  const empty = decodePooledResponse(frame({ status: 204, statusText: 'No Content', url: 'http://h/x', headers: [] }, ''));
  ck('null-body status (204) decodes without throwing', empty.status === 204 && (await empty.text()) === '');
}

const g = globalThis as any;
const hadWindow = 'window' in g;
const origWindow = g.window;
g.window = g;
try {
  const calls: { cmd: string; args: any }[] = [];
  let answer: (cmd: string, args: any) => unknown = () => null;
  g.__TAURI_INTERNALS__ = { invoke: async (cmd: string, args: any) => { calls.push({ cmd, args }); return answer(cmd, args); }, transformCallback: () => 1 };

  answer = (cmd) => cmd === 'pooled_fetch' ? frame({ status: 200, statusText: 'OK', url: 'http://h/api/task', headers: [['content-type', 'application/json']] }, '{"ok":true,"n":1}') : null;
  const res = await appFetch('http://h/api/task', { method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: '{"a":1}' });
  const sent = calls.find(c => c.cmd === 'pooled_fetch')?.args?.request;
  ck('desktop sends through pooled_fetch with method, url, headers and body bytes',
    !!sent && sent.method === 'POST' && sent.url === 'http://h/api/task'
    && sent.headers.some(([k, v]: [string, string]) => k === 'authorization' && v === 'Bearer t')
    && new TextDecoder().decode(new Uint8Array(sent.data)) === '{"a":1}');
  ck('desktop pooled response is readable as JSON', res.ok && (await res.json()).n === 1);
  ck('pooled path never touches the per-request plugin client', !calls.some(c => c.cmd.startsWith('plugin:http|')));

  calls.length = 0;
  const bodyless = await appFetch('http://h/api/status');
  ck('GET without a body sends data: null', calls[0]?.args?.request?.data === null && bodyless.ok);

  // A network error from Rust must surface as the error — never retried through the plugin,
  // which would send a POST twice.
  calls.length = 0;
  answer = (cmd) => { if (cmd === 'pooled_fetch') throw 'error sending request for url (http://h/api/task)'; return null; };
  let err: unknown = null;
  try { await appFetch('http://h/api/task', { method: 'POST', body: '{}' }); } catch (e) { err = e; }
  ck('Rust-side failure rejects with its message', String(err).includes('error sending request'));
  ck('Rust-side failure is not replayed through the plugin', !calls.some(c => c.cmd.startsWith('plugin:http|')));

  // Abort: rejects with the plugin's own message so callers see one shape.
  answer = (cmd) => cmd === 'pooled_fetch' ? new Promise(() => {}) : null;
  const ctrl = new AbortController();
  const pending = appFetch('http://h/slow', { signal: ctrl.signal }).then(() => 'resolved', (e) => String(e?.message ?? e));
  setTimeout(() => ctrl.abort(), 5);
  ck('abort rejects a pending pooled request with "Request cancelled"', (await pending) === 'Request cancelled');

  // A shell that does not answer pooled_fetch (test stubs) falls back to the plugin.
  calls.length = 0;
  let rid = 0;
  answer = (cmd) => {
    if (cmd === 'pooled_fetch') return null;
    if (cmd === 'plugin:http|fetch') return ++rid;
    if (cmd === 'plugin:http|fetch_send') return { status: 200, statusText: 'OK', url: 'http://h/x', headers: [['content-type', 'application/json']], rid: ++rid };
    if (cmd === 'plugin:http|fetch_read_body') { const once = calls.filter(c => c.cmd === cmd).length === 1; return once ? [...new TextEncoder().encode('{"via":"plugin"}'), 0] : [1]; }
    return null;
  };
  const fallback = await appFetch('http://h/x');
  ck('shell without pooled_fetch falls back to the plugin', (await fallback.json()).via === 'plugin' && calls.some(c => c.cmd === 'plugin:http|fetch'));
} finally {
  delete g.__TAURI_INTERNALS__;
  if (hadWindow) g.window = origWindow; else delete g.window;
}

console.log(`\n${passed}/${total} passed`);
if (passed !== total) process.exit(1);
