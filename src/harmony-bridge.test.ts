import {
  base64ToBytes,
  bytesToBase64,
  harmonyFetch,
  harmonyKv,
  isHarmonyShell,
  parseHarmonyInsets,
  readHarmonyInsets,
  registerHarmonyBackHandler,
  type HarmonyHttpRequestPayload,
} from './harmony-bridge';
import { appFetch } from './app-fetch';

let p = 0;
let t = 0;
const ck = (name: string, ok: boolean) => {
  t++;
  if (ok) {
    p++;
    console.log(`PASS: ${name}`);
  } else {
    console.log(`FAIL: ${name}`);
  }
};

const g = globalThis as Record<string, unknown>;

async function run() {
  // 1) Inactive when bridge is absent
  delete g.__ANET_HARMONY__;
  delete g.__ANET_HARMONY_INSETS__;
  ck('isHarmonyShell false without global bridge', !isHarmonyShell());
  ck('readHarmonyInsets null when absent', readHarmonyInsets() === null);

  // 2) Base64 roundtrip (UTF-8 Chinese + binary)
  const utf8 = new TextEncoder().encode('你好，鸿蒙阔直板！');
  const utf8Dec = new TextDecoder().decode(base64ToBytes(bytesToBase64(utf8)));
  ck('base64 UTF-8 roundtrip', utf8Dec === '你好，鸿蒙阔直板！');
  const bin = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
  const binDec = base64ToBytes(bytesToBase64(bin));
  ck('base64 binary roundtrip', binDec.length === bin.length && binDec.every((v, i) => v === bin[i]));

  // 3) Native HTTP fetch bridge (POST JSON + 204 + error + abort)
  const received: HarmonyHttpRequestPayload[] = [];
  const kvStore = new Map<string, string>();
  g.__ANET_HARMONY__ = {
    httpFetch: async (reqJson: string) => {
      const req = JSON.parse(reqJson) as HarmonyHttpRequestPayload;
      received.push(req);
      if (req.url.endsWith('/empty')) {
        return JSON.stringify({ ok: true, status: 204, statusText: 'No Content', url: req.url, headers: [] });
      }
      if (req.url.endsWith('/fail')) {
        return JSON.stringify({ ok: false, status: 0, error: 'DNS failed' });
      }
      if (req.url.endsWith('/slow')) {
        return new Promise<string>(() => { /* never resolves; abort should reject */ });
      }
      const echo = req.bodyBase64 ? new TextDecoder().decode(base64ToBytes(req.bodyBase64)) : '';
      const replyBytes = new TextEncoder().encode(JSON.stringify({ ok: true, echo, method: req.method }));
      return JSON.stringify({
        ok: true,
        status: 200,
        statusText: 'OK',
        url: req.url,
        headers: [['content-type', 'application/json'], ['x-bridge', 'harmony']],
        bodyBase64: bytesToBase64(replyBytes),
      });
    },
    kvGet: (k: string) => kvStore.get(k) ?? null,
    kvSet: (k: string, v: string) => { kvStore.set(k, v); },
    kvDel: (k: string) => { kvStore.delete(k); },
    getInsetsJson: () => JSON.stringify({ top: 38, right: 0, bottom: 28, left: 0 }),
  };

  ck('isHarmonyShell true with global bridge', isHarmonyShell());

  const res = await harmonyFetch('https://hub.example.test/api/task', {
    method: 'POST',
    headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg: '鸿蒙测试' }),
  });
  const json = await res.json() as { ok: boolean; echo: string; method: string };
  ck('harmonyFetch POST returns 200 & JSON body', res.status === 200 && json.ok && json.method === 'POST');
  ck('harmonyFetch preserves UTF-8 payload & headers',
    json.echo === '{"msg":"鸿蒙测试"}'
    && res.headers.get('x-bridge') === 'harmony'
    && received[0].headers.some(([k, v]) => k.toLowerCase() === 'authorization' && v === 'Bearer tok'));

  const res204 = await harmonyFetch('https://hub.example.test/empty');
  ck('harmonyFetch handles 204 null-body status without throwing', res204.status === 204 && (await res204.text()) === '');

  let errMsg = '';
  try {
    await harmonyFetch('https://hub.example.test/fail');
  } catch (e) {
    errMsg = e instanceof Error ? e.message : String(e);
  }
  ck('harmonyFetch propagates native transport errors', errMsg === 'DNS failed');

  const ctrl = new AbortController();
  const slowPromise = harmonyFetch('https://hub.example.test/slow', { signal: ctrl.signal });
  ctrl.abort();
  let abortMsg = '';
  try {
    await slowPromise;
  } catch (e) {
    abortMsg = e instanceof Error ? e.message : String(e);
  }
  ck('harmonyFetch honors AbortSignal', abortMsg === 'Request cancelled');

  // 4) Native KV storage
  await harmonyKv.set('session_idx', '{"active":"p1"}');
  ck('harmonyKv set/get roundtrip', (await harmonyKv.get('session_idx')) === '{"active":"p1"}');
  await harmonyKv.del('session_idx');
  ck('harmonyKv del clears entry', (await harmonyKv.get('session_idx')) === null);

  // 5) Safe-area insets parsing + live read
  const insets = readHarmonyInsets();
  ck('readHarmonyInsets reads bridge JSON', !!insets && insets.top === 38 && insets.bottom === 28 && insets.left === 0 && insets.right === 0);
  g.__ANET_HARMONY_INSETS__ = { top: 0, right: 24, bottom: 20, left: 38 };
  const rotated = readHarmonyInsets();
  ck('readHarmonyInsets prefers updated global object on rotation', !!rotated && rotated.left === 38 && rotated.right === 24);
  ck('parseHarmonyInsets rejects out-of-range / malformed', parseHarmonyInsets({ top: -1, right: 0, bottom: 0, left: 0 }) === null && parseHarmonyInsets('not-json') === null);

  // 6) Swipe-back registration
  let calls = 0;
  const unsub = registerHarmonyBackHandler(() => { calls++; return true; });
  const backFn = g.__ANET_HARMONY_BACK__ as (() => boolean) | undefined;
  ck('registerHarmonyBackHandler wires global handler', typeof backFn === 'function' && backFn() === true && calls === 1);
  unsub();
  ck('unregister clears global handler', g.__ANET_HARMONY_BACK__ === undefined);

  // 7) ArkWeb asyncMethodList callback bridge (httpFetchAsync + HTTP/2 pseudo-header filtering)
  const asyncReqIds: string[] = [];
  g.__ANET_HARMONY__ = {
    httpFetchAsync: (reqId: string, reqJson: string) => {
      asyncReqIds.push(reqId);
      const req = JSON.parse(reqJson) as HarmonyHttpRequestPayload;
      if (req.url.endsWith('/never')) return;
      queueMicrotask(() => {
        const resolver = g.__ANET_HARMONY_HTTP_RESOLVE__ as ((id: string, raw: string) => void) | undefined;
        const body = new TextEncoder().encode(JSON.stringify({ ok: false, error: 'invalid username or password' }));
        resolver?.(reqId, JSON.stringify({
          ok: true,
          status: 401,
          statusText: '',
          url: req.url,
          headers: [[':status', '401'], [':authority', 'y.vansin.top'], ['content-type', 'application/json'], ['x-h2', 'ok']],
          bodyBase64: bytesToBase64(body),
        }));
      });
    },
  };
  ck('isHarmonyShell true with httpFetchAsync-only bridge', isHarmonyShell());
  const h2Res = await harmonyFetch('https://y.vansin.top/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'demo', password: 'bad' }),
  });
  const h2Body = await h2Res.json() as { ok: boolean; error: string };
  ck('httpFetchAsync resolves via __ANET_HARMONY_HTTP_RESOLVE__ and strips HTTP/2 :status pseudo-headers',
    h2Res.status === 401
    && h2Body.error === 'invalid username or password'
    && h2Res.headers.get('x-h2') === 'ok'
    && Array.from(h2Res.headers.keys()).every(k => !k.startsWith(':'))
    && asyncReqIds.length === 1);

  const asyncAbortCtrl = new AbortController();
  const asyncAbortPromise = harmonyFetch('https://y.vansin.top/never', { signal: asyncAbortCtrl.signal });
  asyncAbortCtrl.abort();
  let asyncAbortErr = '';
  try {
    await asyncAbortPromise;
  } catch (e) {
    asyncAbortErr = e instanceof Error ? e.message : String(e);
  }
  ck('httpFetchAsync honors AbortSignal', asyncAbortErr === 'Request cancelled');

  // 8) appFetch delegates to HarmonyOS bridge without calling globalThis.fetch
  const origGlobalFetch = globalThis.fetch;
  let globalFetchCalled = false;
  globalThis.fetch = (async () => { globalFetchCalled = true; return new Response('unexpected'); }) as typeof fetch;
  try {
    const viaAppFetch = await appFetch('https://y.vansin.top/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'demo', password: 'bad' }),
    });
    ck('appFetch routes through HarmonyOS httpFetchAsync bridge instead of global fetch',
      !globalFetchCalled && viaAppFetch.status === 401 && viaAppFetch.headers.get('x-h2') === 'ok');
  } finally {
    globalThis.fetch = origGlobalFetch;
  }

  delete g.__ANET_HARMONY__;
  delete g.__ANET_HARMONY_INSETS__;
  delete g.__ANET_HARMONY_HTTP_RESOLVE__;
  console.log(`${p}/${t} passed`);
  process.exit(p === t ? 0 : 1);
}

void run();
