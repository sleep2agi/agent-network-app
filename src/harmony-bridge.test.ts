import { readFileSync } from 'node:fs';
import {
  base64ToBytes,
  bytesToBase64,
  harmonyCancelNotification,
  harmonyDownloadFile,
  harmonyFetch,
  harmonyKv,
  harmonyNotificationId,
  harmonyOpenExternalUrl,
  harmonyOpenLocalFile,
  harmonyPostNotification,
  harmonyRequestNotificationPermission,
  harmonySaveBytes,
  hasHarmonyFileBridge,
  hasHarmonyNotificationBridge,
  hasHarmonySaveBytesBridge,
  hasHarmonySseBridge,
  installHarmonyBackHandlerShim,
  installHarmonyClipboardShim,
  isHarmonyShell,
  markHarmonyRootBackHandler,
  openHarmonySseStream,
  parseHarmonyInsets,
  readHarmonyInsets,
  registerHarmonyBackHandler,
  syncHarmonyTheme,
  type HarmonyHttpRequestPayload,
} from './harmony-bridge';
import { appFetch } from './app-fetch';
import { openUserEventStream } from './user-events-sse';

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

  // 6) Swipe-back registration (LIFO screen-level handlers intercept before AppRoot fallback)
  let calls = 0;
  const unsub = registerHarmonyBackHandler(() => { calls++; return true; });
  const backFn = g.__ANET_HARMONY_BACK__ as (() => boolean) | undefined;
  ck('registerHarmonyBackHandler wires global handler', typeof backFn === 'function' && backFn() === true && calls === 1);
  unsub();
  ck('unregister clears global handler', g.__ANET_HARMONY_BACK__ === undefined);

  {
    const trace: string[] = [];
    const fakeBack = {
      addEventListener: (_ev: string, _fn: () => boolean) => ({ remove: () => {} }),
    };
    installHarmonyBackHandlerShim(fakeBack);
    const rootSub = fakeBack.addEventListener('hardwareBackPress', markHarmonyRootBackHandler(() => {
      trace.push('root');
      return true;
    }));
    const screenSub = fakeBack.addEventListener('hardwareBackPress', () => {
      trace.push('screen');
      return true;
    });
    // Even if AppRoot re-registers after a screen mounts, screen handler still intercepts first!
    rootSub.remove();
    const rootSub2 = fakeBack.addEventListener('hardwareBackPress', markHarmonyRootBackHandler(() => {
      trace.push('root2');
      return true;
    }));
    const runBack = g.__ANET_HARMONY_BACK__ as (() => boolean) | undefined;
    const hitScreen = !!runBack?.();
    screenSub.remove();
    const hitRoot = !!runBack?.();
    rootSub2.remove();
    ck('Harmony BackHandler shim runs screen-level handlers before AppRoot fallback (even after root re-register)',
      hitScreen && hitRoot && trace.join(',') === 'screen,root2' && g.__ANET_HARMONY_BACK__ === undefined);
  }

  // Origin isolation check on Index.ets (Codex P1 finding)
  {
    const indexEts = readFileSync(new URL('../harmony/entry/src/main/ets/pages/Index.ets', import.meta.url), 'utf8');
    ck('Index.ets restricts javaScriptProxy to https://anet.local and guards main-frame navigation via onLoadIntercept',
      indexEts.includes('javascriptProxyPermission')
      && indexEts.includes('"host":"anet.local"')
      && indexEts.includes('.onLoadIntercept(')
      && indexEts.includes('req.isMainFrame()'));
  }

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

  // 9) Native SSE stream bridge (openUserEventStream + reconnect/close)
  const openedStreams: Array<{ id: string; url: string; headers: [string, string][] }> = [];
  const closedStreams: string[] = [];
  const fileDownloads: Array<{ id: string; payload: any }> = [];
  const fileOpens: Array<{ id: string; payload: any }> = [];
  const savedBytes: Array<{ id: string; payload: any }> = [];
  const externalUrls: string[] = [];
  const copiedTexts: string[] = [];
  const themes: string[] = [];
  const notifications: Array<{ kind: string; value: unknown }> = [];

  g.__ANET_HARMONY__ = {
    httpFetchAsync: () => {},
    openSseStream: (streamId: string, reqJson: string) => {
      const parsed = JSON.parse(reqJson) as { url: string; headers: [string, string][] };
      openedStreams.push({ id: streamId, url: parsed.url, headers: parsed.headers });
      queueMicrotask(() => {
        const dispatch = g.__ANET_HARMONY_SSE_EVENT__ as ((id: string, kind: string, data: string) => void) | undefined;
        dispatch?.(streamId, 'open', '');
        dispatch?.(streamId, 'chunk', 'data: {"type":"desktop_message","message":"hello"}\n\n');
      });
    },
    closeSseStream: (streamId: string) => { closedStreams.push(streamId); },
    downloadAndOpenFileAsync: (reqId: string, reqJson: string) => {
      const payload = JSON.parse(reqJson);
      fileDownloads.push({ id: reqId, payload });
      queueMicrotask(() => {
        const resolve = g.__ANET_HARMONY_FILE_RESOLVE__ as ((id: string, raw: string) => void) | undefined;
        resolve?.(reqId, JSON.stringify({ ok: true, path: `/cache/downloads/${payload.fileName}` }));
      });
    },
    openLocalFileAsync: (reqId: string, reqJson: string) => {
      const payload = JSON.parse(reqJson);
      fileOpens.push({ id: reqId, payload });
      queueMicrotask(() => {
        const resolve = g.__ANET_HARMONY_FILE_RESOLVE__ as ((id: string, raw: string) => void) | undefined;
        resolve?.(reqId, JSON.stringify({ ok: true, path: payload.path }));
      });
    },
    saveBytesAsync: (reqId: string, reqJson: string) => {
      const payload = JSON.parse(reqJson);
      savedBytes.push({ id: reqId, payload });
      queueMicrotask(() => {
        const resolve = g.__ANET_HARMONY_FILE_RESOLVE__ as ((id: string, raw: string) => void) | undefined;
        const path = payload.fileName === 'cancel.log'
          ? ''
          : `file://docs/storage/Users/currentUser/Download/${encodeURIComponent(payload.fileName)}`;
        resolve?.(reqId, JSON.stringify({ ok: true, path }));
      });
    },
    openExternalUrl: (url: string) => { externalUrls.push(url); return true; },
    copyText: (text: string) => { copiedTexts.push(text); },
    setThemeMode: (mode: string) => { themes.push(mode); },
    requestNotificationPermission: () => { notifications.push({ kind: 'perm', value: true }); },
    postNotification: (payloadJson: string) => { notifications.push({ kind: 'post', value: JSON.parse(payloadJson) }); },
    cancelNotification: (idNum: number) => { notifications.push({ kind: 'cancel', value: idNum }); },
  };

  ck('capability detectors report SSE / file / saveBytes / notification bridges',
    hasHarmonySseBridge() && hasHarmonyFileBridge() && hasHarmonySaveBytesBridge() && hasHarmonyNotificationBridge());

  const sseEvents: unknown[] = [];
  const sseStates: string[] = [];
  const closeUserSse = openUserEventStream(
    { serverUrl: 'https://y.vansin.top', token: 'utok_test', networkId: 'net_1' } as any,
    {
      onEvent: (ev) => sseEvents.push(ev),
      onState: (st) => sseStates.push(st),
    },
  );
  await new Promise(r => setTimeout(r, 15));
  closeUserSse();
  ck('openUserEventStream routes through HarmonyOS native SSE bridge & delivers frames',
    openedStreams.length === 1
    && openedStreams[0].url === 'https://y.vansin.top/events/users/me?network_id=net_1'
    && sseStates.includes('connected')
    && sseEvents.length === 1
    && (sseEvents[0] as any).message === 'hello'
    && closedStreams.includes(openedStreams[0].id));

  // Direct low-level SSE helper sanity check
  let rawChunks = '';
  const closeRaw = openHarmonySseStream('https://y.vansin.top/events/network/n1', [], {
    onOpen: () => {},
    onChunk: (c) => { rawChunks += c; },
    onClose: () => {},
  });
  await new Promise(r => setTimeout(r, 15));
  closeRaw();
  ck('openHarmonySseStream receives raw SSE chunk', rawChunks.includes('desktop_message'));

  // 10) Native file download / save / preview (zero Base64 OOM)
  const dlPath = await harmonyDownloadFile({
    url: 'https://y.vansin.top/api/files/f1',
    token: 'utok_test',
    fileName: 'report.pdf',
    mimeType: 'application/pdf',
    mode: 'open',
  });
  await harmonyOpenLocalFile({ path: dlPath, fileName: 'report.pdf', mimeType: 'application/pdf' });
  ck('harmonyDownloadFile & harmonyOpenLocalFile resolve via __ANET_HARMONY_FILE_RESOLVE__',
    dlPath === '/cache/downloads/report.pdf'
    && fileDownloads[0]?.payload?.mode === 'open'
    && fileOpens[0]?.payload?.path === dlPath);

  const rawLogBytes = new TextEncoder().encode('鸿蒙导出日志测试\n');
  const savedUri = await harmonySaveBytes({ bytes: rawLogBytes, fileName: '测试.log', mimeType: 'text/plain' });
  const cancelledUri = await harmonySaveBytes({ bytes: rawLogBytes, fileName: 'cancel.log', mimeType: 'text/plain' });
  const decodedSaved = savedBytes[0]?.payload?.bytesBase64
    ? new TextDecoder().decode(base64ToBytes(savedBytes[0].payload.bytesBase64))
    : '';
  ck('harmonySaveBytes encodes bytes to base64 and handles picker cancel',
    savedUri === 'file://docs/storage/Users/currentUser/Download/%E6%B5%8B%E8%AF%95.log'
    && decodedSaved === '鸿蒙导出日志测试\n'
    && cancelledUri === '');

  // 11) External URL + clipboard shim + theme sync + native notifications
  ck('harmonyOpenExternalUrl invokes native opener',
    harmonyOpenExternalUrl('https://www.anet.sh') === true && externalUrls[0] === 'https://www.anet.sh');

  const origNav = (globalThis as any).navigator;
  const fakeClipboard: Record<string, unknown> = {};
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: fakeClipboard }, configurable: true });
  try {
    installHarmonyClipboardShim();
    await (fakeClipboard.writeText as (t: string) => Promise<void>)('鸿蒙复制测试');
    ck('installHarmonyClipboardShim routes navigator.clipboard.writeText to bridge.copyText',
      copiedTexts.includes('鸿蒙复制测试'));
  } finally {
    Object.defineProperty(globalThis, 'navigator', { value: origNav, configurable: true });
  }

  syncHarmonyTheme('dark');
  syncHarmonyTheme('light');
  ck('syncHarmonyTheme pushes dark/light mode to native bridge', themes.join(',') === 'dark,light');

  harmonyRequestNotificationPermission();
  harmonyPostNotification('agent:comm', '通信鸽', '已修复全部 P0');
  harmonyCancelNotification('agent:comm');
  const expectedNid = harmonyNotificationId('agent:comm');
  ck('native notification bridge requests permission, publishes & cancels with stable positive id',
    expectedNid > 0
    && notifications.length === 3
    && notifications[0].kind === 'perm'
    && (notifications[1].value as any).id === expectedNid
    && (notifications[1].value as any).title === '通信鸽'
    && notifications[2].value === expectedNid);

  delete g.__ANET_HARMONY__;
  delete g.__ANET_HARMONY_INSETS__;
  delete g.__ANET_HARMONY_HTTP_RESOLVE__;
  delete g.__ANET_HARMONY_SSE_EVENT__;
  delete g.__ANET_HARMONY_FILE_RESOLVE__;
  console.log(`${p}/${t} passed`);
  process.exit(p === t ? 0 : 1);
}

void run();
