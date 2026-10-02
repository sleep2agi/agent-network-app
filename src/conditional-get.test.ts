// @ts-nocheck -- repository test scripts run directly under Bun.
// #467 —— 条件 GET(conditional-get.ts):hub 回了 ETag 的读带 If-None-Match,304 用上次的正文。
// 走的是真的 api.ts 轮询读(fetchStatus / fetchNodeStatus)和真的 appFetch:网页(全局 fetch)和桌面
// (pooled_fetch / plugin:http 两条 Tauri 路径,304 都是空体)。旧 hub 不发 ETag ⇒ 请求逐字不变。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchNodeStatus, fetchStatus } from './api';
import { listRequirementsFull } from './requirements-hub';
import { __conditionalReadsSize, clearConditionalReads } from './conditional-get';
import { __resetConnectivityForTest, recentReadSamples } from './connectivity';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };

const cfgA = { serverUrl: 'http://hub.invalid', token: 'utok_a', networkId: 'net-a', profileId: 'p-a' };
const sessions = (status: string) => ({ ok: true, sessions: [{ alias: '示例-A', status }], summary: { total: 1 } });

const seen: { url: string; inm: string | null }[] = [];
let server: (url: string, inm: string | null) => Response;
const orig = globalThis.fetch;
globalThis.fetch = (async (url: string, init: RequestInit) => {
  const inm = new Headers(init?.headers).get('if-none-match');
  seen.push({ url: String(url), inm });
  return server(String(url), inm);
}) as any;
const json = (body: unknown, etag?: string) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json;charset=utf-8', ...(etag ? { etag } : {}) } });
const notModified = (etag: string) => new Response(null, { status: 304, headers: { etag } });

try {
  // ── new hub (ETag) on the web path ──────────────────────────────────────────────────────
  clearConditionalReads(); __resetConnectivityForTest();
  let cur = { etag: '"s-v1"', body: sessions('idle') };
  server = (_u, inm) => inm === cur.etag ? notModified(cur.etag) : json(cur.body, cur.etag);
  const a1 = await fetchStatus(cfgA);
  ck('first read: no If-None-Match, data returned', seen[0].inm === null && a1.sessions[0].status === 'idle');
  const a2 = await fetchStatus(cfgA);
  ck('second read sends the remembered ETag', seen[1].inm === '"s-v1"');
  ck('304 → the remembered data (equal content)', JSON.stringify(a2) === JSON.stringify(a1));
  ck('304 → a fresh object, not the one handed out before (callers may mutate theirs)', a2 !== a1 && a2.sessions !== a1.sessions);
  a2.sessions.push({ alias: 'mutated' });
  const a3 = await fetchStatus(cfgA);
  ck('…a caller mutating its copy does not leak into the next 304', a3.sessions.length === 1);
  cur = { etag: '"s-v2"', body: sessions('working') };
  const a4 = await fetchStatus(cfgA);
  ck('changed body → 200 with the new data', a4.sessions[0].status === 'working');
  await fetchStatus(cfgA);
  ck('…and the new ETag is remembered', seen.at(-1).inm === '"s-v2"');

  // A fast 304 is a normal successful read for the connection indicator (a timing sample like a 200).
  __resetConnectivityForTest();
  await fetchStatus(cfgA); // 304
  const s304 = recentReadSamples();
  ck('a 304 read reports one success sample, like a 200 read', seen.at(-1).inm === '"s-v2"' && s304.length === 1 && s304[0].path.includes('/api/status') && typeof s304[0].ms === 'number');

  // Each URL has its own entry (light list vs one node's full row).
  seen.length = 0;
  server = (u, inm) => u.includes('alias=') ? (inm === '"n-1"' ? notModified('"n-1"') : json(sessions('idle'), '"n-1"')) : (inm === cur.etag ? notModified(cur.etag) : json(cur.body, cur.etag));
  await fetchNodeStatus(cfgA, '示例-A');
  ck('a different URL starts without If-None-Match', seen[0].inm === null);
  await fetchNodeStatus(cfgA, '示例-A');
  ck('…then sends its own ETag', seen[1].inm === '"n-1"');

  // ── per account / hub / token; cleared on logout / switch ──────────────────────────────
  seen.length = 0;
  await fetchStatus({ ...cfgA, profileId: 'p-b', token: 'utok_b' });
  await fetchStatus({ ...cfgA, serverUrl: 'http://other-hub.invalid' });
  await fetchStatus({ ...cfgA, token: 'utok_renewed' });
  ck('another account / hub / token never sends this one\'s ETag', seen.length === 3 && seen.every(s => s.inm === null));
  ck('cache holds entries before logout', __conditionalReadsSize() > 0);
  clearConditionalReads();
  seen.length = 0;
  await fetchStatus(cfgA);
  ck('after clear (logout / switch) the next read sends no If-None-Match', seen[0].inm === null && __conditionalReadsSize() === 1);

  // 304 although nothing is remembered any more (cleared while the request was in flight) → an error, not stale data.
  server = () => notModified('"s-v2"');
  clearConditionalReads();
  let threw = false;
  try { await fetchStatus(cfgA); } catch (e) { threw = /HTTP 304/.test(String(e)); }
  ck('unexpected 304 with nothing remembered → error, never someone else\'s body', threw);

  // ── old hub: no ETag ───────────────────────────────────────────────────────────────────
  clearConditionalReads();
  seen.length = 0;
  server = () => json(sessions('idle'));
  await fetchStatus(cfgA); await fetchStatus(cfgA); await fetchStatus(cfgA);
  ck('old hub: never sends If-None-Match, stores nothing', seen.length === 3 && seen.every(s => s.inm === null) && __conditionalReadsSize() === 0);
  // Downgrade: a hub that stops sending ETag drops the remembered one.
  server = (_u, inm) => inm ? notModified('"x"') : json(sessions('idle'), '"x"');
  await fetchStatus(cfgA);
  server = () => json(sessions('offline'));
  await fetchStatus(cfgA);
  seen.length = 0;
  await fetchStatus(cfgA);
  ck('downgraded hub (ETag gone) → If-None-Match no longer sent', seen[0].inm === null);

  // ── requirements share the same cache (and the same clearing) ───────────────────────────
  clearConditionalReads();
  seen.length = 0;
  server = (_u, inm) => inm === '"r1"' ? notModified('"r1"') : json({ ok: true, requirements: [{ id: 'r1', name: '卡片', column: 'pool', priority: 'normal', createdAt: '2026-10-01T00:00:00Z' }], capabilities: [] }, '"r1"');
  const r1 = await listRequirementsFull(cfgA);
  const r2 = await listRequirementsFull(cfgA);
  ck('task list: 304 reuses the list via the shared cache', seen[1].inm === '"r1"' && r2.rows[0]?.name === '卡片' && r1.rows[0]?.name === '卡片');
  clearConditionalReads();
  seen.length = 0;
  await listRequirementsFull(cfgA);
  ck('task list: cleared together with the status reads', seen[0].inm === null);
} finally {
  globalThis.fetch = orig;
}

// ── desktop: Tauri pooled_fetch and plugin:http, 304 with an empty body ─────────────────────
const g = globalThis as any;
const hadWindow = 'window' in g; const origWindow = g.window;
g.window = g;
const frame = (meta: object, body: string) => {
  const m = new TextEncoder().encode(JSON.stringify(meta)); const b = new TextEncoder().encode(body);
  const out = new Uint8Array(4 + m.length + b.length);
  new DataView(out.buffer).setUint32(0, m.length, false); out.set(m, 4); out.set(b, 4 + m.length);
  return out.buffer;
};
try {
  const sent: string[] = [];
  let mode: 'pooled' | 'plugin' = 'pooled';
  const bodyText = JSON.stringify(sessions('idle'));
  let pluginRid = 0, readCount = 0, pluginStatus = 200;
  g.__TAURI_INTERNALS__ = {
    transformCallback: () => 1,
    invoke: async (cmd: string, args: any) => {
      if (cmd === 'pooled_fetch') {
        if (mode !== 'pooled') throw 'pooled_fetch/not_sent: off';
        const inm = (args.request.headers as [string, string][]).find(([k]) => k.toLowerCase() === 'if-none-match')?.[1] ?? null;
        sent.push(`pooled:${inm}`);
        return inm === '"d1"' ? frame({ status: 304, statusText: 'Not Modified', url: args.request.url, headers: [['etag', '"d1"']] }, '')
          : frame({ status: 200, statusText: 'OK', url: args.request.url, headers: [['content-type', 'application/json'], ['etag', '"d1"']] }, bodyText);
      }
      if (cmd === 'plugin:http|fetch') {
        const h = args.clientConfig.headers as [string, string][];
        const inm = h.find(([k]) => k.toLowerCase() === 'if-none-match')?.[1] ?? null;
        sent.push(`plugin:${inm}`);
        pluginStatus = inm === '"d1"' ? 304 : 200; readCount = 0;
        return ++pluginRid;
      }
      if (cmd === 'plugin:http|fetch_send') return { status: pluginStatus, statusText: pluginStatus === 304 ? 'Not Modified' : 'OK', url: 'http://hub.invalid/api/status?light=1', headers: [['content-type', 'application/json'], ['etag', '"d1"']], rid: pluginRid };
      if (cmd === 'plugin:http|fetch_read_body') { readCount++; return readCount === 1 && pluginStatus === 200 ? [...new TextEncoder().encode(bodyText), 0] : [1]; }
      return null;
    },
  };
  clearConditionalReads();
  const d1 = await fetchStatus(cfgA);
  const d2 = await fetchStatus(cfgA);
  ck('desktop pooled_fetch: second read sends If-None-Match, 304 (empty body) → remembered data',
    sent.join(',') === 'pooled:null,pooled:"d1"' && d2.sessions[0].status === 'idle' && d1.sessions[0].status === 'idle');
  mode = 'plugin';
  try { globalThis.localStorage?.setItem('anet.pooledHttp.off', '1'); } catch {}
  sent.length = 0;
  clearConditionalReads();
  const e1 = await fetchStatus(cfgA);
  const e2 = await fetchStatus(cfgA);
  ck('desktop plugin:http: 304 (empty body) → remembered data', sent.join(',') === 'plugin:null,plugin:"d1"' && e2.sessions[0].status === 'idle' && e1.sessions[0].status === 'idle');
} finally {
  delete g.__TAURI_INTERNALS__;
  if (hadWindow) g.window = origWindow; else delete g.window;
}

// ── wiring: cleared on logout / switch / re-login / local data deletion ────────────────────
const app = readFileSync(join(import.meta.dir, '..', 'App.tsx'), 'utf8');
const body = (name: string) => { const i = app.indexOf(`const ${name} = `); return i < 0 ? '' : app.slice(i, app.indexOf('\n  };', i)); };
for (const fn of ['removeActiveProfile', 'activateProfile', 'finishLocalDataDeletion']) ck(`App: ${fn} clears the conditional reads`, body(fn).includes('clearConditionalReads();'));
ck('App: requestProfileReauth clears the conditional reads', /const requestProfileReauth = [\s\S]{0,300}clearConditionalReads\(\);/.test(app));
const api = readFileSync(join(import.meta.dir, 'api.ts'), 'utf8');
ck('api.ts: the shared poll read is the conditional one', api.includes('...conditionalHeaders(cfg, path)') && api.includes('await readConditionalText(cfg, path, res)'));

console.log(`\nconditional-get: ${p}/${t}`);
if (p !== t) process.exit(1);
