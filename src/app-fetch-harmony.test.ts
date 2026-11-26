// @ts-nocheck -- repository test scripts run directly under Bun.
// 鸿蒙外壳的原生请求桥：appFetch 发现 globalThis.anetHarmony 就走它，请求 / 响应体 base64 往返不失真。
import { appFetch } from './app-fetch';

let passed = 0;
let total = 0;
const ck = (name: string, condition: boolean) => {
  total++;
  if (condition) { passed++; console.log('✅', name); }
  else console.log('❌', name);
};

let lastReq: any = null;
globalThis.anetHarmony = {
  async fetch(json: string) {
    lastReq = JSON.parse(json);
    if (lastReq.url.endsWith('/down')) return JSON.stringify({ status: 0, error: 'timeout' });
    const echo = lastReq.bodyBase64 ? new TextDecoder().decode(Uint8Array.from(atob(lastReq.bodyBase64), c => c.charCodeAt(0))) : '';
    const bytes = new TextEncoder().encode(JSON.stringify({ ok: true, echo }));
    let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
    return JSON.stringify({ status: 201, headers: { 'content-type': 'application/json', 'x-n': '1' }, bodyBase64: btoa(bin) });
  },
};
const originalFetch = globalThis.fetch;
let globalFetchCalled = false;
globalThis.fetch = async () => { globalFetchCalled = true; return new Response(''); };

try {
  const res = await appFetch('https://hub.example/api/x', { method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '你好' }) });
  const json = await res.json();
  ck('走鸿蒙桥而不是全局 fetch', !globalFetchCalled && lastReq?.url === 'https://hub.example/api/x');
  ck('方法与请求头原样带过去', lastReq.method === 'POST' && lastReq.headers.authorization === 'Bearer t');
  ck('中文请求体 base64 往返不失真', json.echo === JSON.stringify({ text: '你好' }));
  ck('状态码与响应头还原', res.status === 201 && res.headers.get('x-n') === '1');

  const get = await appFetch('https://hub.example/api/y');
  ck('GET 不带请求体', get.ok && lastReq.method === 'GET' && !('bodyBase64' in lastReq));

  let err = '';
  try { await appFetch('https://hub.example/down'); } catch (e) { err = String(e?.message ?? e); }
  ck('原生请求失败时抛出带原因的错误', err.includes('timeout'));

  const ctl = new AbortController(); ctl.abort();
  let aborted = false;
  try { await appFetch('https://hub.example/api/z', { signal: ctl.signal }); } catch (e) { aborted = e?.name === 'AbortError'; }
  ck('已取消的请求按取消返回', aborted);
} finally {
  globalThis.fetch = originalFetch;
  delete globalThis.anetHarmony;
}

console.log(`\n${passed}/${total} passed`);
if (passed !== total) process.exit(1);
