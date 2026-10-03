// #518「发送消息一直是 发送中」+「为什么现在发消息都需要发那么久」。ck style: self-executing, exit 1 on any failure.
//
// A real HTTP fake hub on a random 127.0.0.1 port (never the production hub) answers POST /api/task in one of:
//   ok · drop (socket destroyed mid-request) · hang (accepted, never answers) · 502 (proxy during a restart)
//   · hang-body (headers, then the body stalls)
// Every sendTask must settle (resolve or reject) inside the send bound. One transport ignores AbortSignal and never
// ends the body — what a plugin/WebView fetch can do — and the in-test mutation (bound removed) must leave it pending,
// proving it is the deadline, not luck, that settles it.
//
// Then: identity is looked up once per hub + token (a send after warm-up is exactly 1 request, even with a new cfg
// object), and the echo state machine (send-lifecycle.ts) never leaves an echo 「发送中」 that nobody will finish.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { __setSendBoundsForTest, createDashboardRequestId, forgetSendIdentity, sendTask, type HubConfig } from './api';
import { forgetAuthMe } from './user-admin-api';
import { __resetOutboxForTest, initOutbox, outboxAdd, outboxEntry, outboxForAlias, outboxMarkFailed, outboxRemove, subscribeOutbox, notifyOutboxListeners } from './outbox';
import { __resetSendLifecycleForTest, beginSend, endSend, orphanedPendingIds, settleEchoes } from './send-lifecycle';
import { __resetSendTimingsForTest, clockOffsetFrom, dreqCreatedAt, formatSendTiming, recentSendTimings, recordSendBubble } from './send-timing';
import { shouldExposeSendFailure } from './send-reconciliation';

let pass = 0;
const failures: string[] = [];
const ck = (name: string, ok: boolean, extra = '') => {
  if (ok) pass++; else failures.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`);
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const quiet = console.info;
console.info = () => {}; // send_timing lines; asserted through recentSendTimings()

// ── fake hub ──
type Mode = 'ok' | 'drop' | 'hang' | '502' | 'hang-body';
let mode: Mode = 'ok';
let latencyMs = 0;
const log: { path: string; method: string; at: number; rid?: string }[] = [];
const hung: ServerResponse[] = [];
const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    let rid: string | undefined;
    try { rid = JSON.parse(raw)?.meta?.client_request_id; } catch { /* GET */ }
    log.push({ path, method: req.method ?? 'GET', at: Date.now(), rid });
    if (path === '/api/task' && mode !== 'ok') {
      if (mode === 'drop') { req.socket.destroy(); return; }
      if (mode === 'hang') { hung.push(res); return; }
      if (mode === '502') { res.writeHead(502, { 'content-type': 'text/html' }); res.end('<html>502 Bad Gateway</html>'); return; }
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': '64' }); res.write('{"ok":'); hung.push(res); return;
    }
    setTimeout(() => {
      const json = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json', date: new Date().toUTCString() }); res.end(JSON.stringify(body)); };
      if (path === '/api/auth/me') return json(200, { user: { username: 'tester' }, current_network: { network_id: 'net-demo' } });
      if (path === '/api/task') return json(200, { ok: true, task_id: `t_${log.length}` });
      return json(404, { ok: false });
    }, latencyMs);
  });
});
await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
const HUB = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const release = () => { for (const r of hung.splice(0)) { try { r.destroy(); } catch { /* gone */ } } };

const HEADER_MS = 300, TOTAL_MS = 600;
__setSendBoundsForTest({ headerMs: HEADER_MS, totalMs: TOTAL_MS });
const cfgFor = (over: Partial<HubConfig> = {}): HubConfig => ({ serverUrl: HUB, token: 'utok_placeholder', networkId: 'net-demo', username: 'tester', ...over });

const settle = async (p: Promise<unknown>, waitMs: number) => {
  const t0 = Date.now();
  const r = await Promise.race([
    p.then(() => 'resolved' as const, (e: unknown) => `rejected: ${e instanceof Error ? e.message : String(e)}` as const),
    sleep(waitMs).then(() => 'pending' as const),
  ]);
  return { r, ms: Date.now() - t0 };
};

// ── 1. every failure mode settles, as a rejection (→ 未送达 · 重试), inside the bound ──
for (const m of ['drop', 'hang', '502', 'hang-body'] as Mode[]) {
  mode = m;
  const { r, ms } = await settle(sendTask(cfgFor(), '示例-A', `mode ${m}`), TOTAL_MS + 1500);
  ck(`(${m}) sendTask settles as a failure within the bound`, r.startsWith('rejected'), `${r} after ${ms} ms`);
  release();
}
mode = 'ok';
{
  const { r } = await settle(sendTask(cfgFor(), '示例-A', 'ok'), 3000);
  ck('(ok) the same hub accepts the next send', r === 'resolved', r);
}

// ── 2. a transport that ignores AbortSignal and never ends the body (plugin / WebView fetch) ──
const realFetch = globalThis.fetch;
const stallingFetch = (async (input: any) => {
  const url = String(input);
  if (!url.endsWith('/api/task')) return realFetch(input);
  // headers arrive, the body never ends, abort is ignored
  return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"ok":')); } }), { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;
globalThis.fetch = stallingFetch;
{
  const { r, ms } = await settle(sendTask(cfgFor(), '示例-A', 'stall'), TOTAL_MS + 1500);
  ck('abort-ignoring stalled body: sendTask still settles (hard deadline)', r.startsWith('rejected') && ms < TOTAL_MS + 1000, `${r} after ${ms} ms`);
  const t = recentSendTimings()[0];
  ck('…and records it as a timeout in send_timing', t?.outcome === 'timeout' && t.headersMs !== null && t.bodyMs === null, JSON.stringify(t && { outcome: t.outcome, headersMs: t.headersMs, bodyMs: t.bodyMs }));
  // mutation: no total deadline (the pre-#518 shape: timer cleared at headers) ⇒ the same send never settles.
  __setSendBoundsForTest({ headerMs: HEADER_MS, totalMs: 1e9 });
  const mutated = await settle(sendTask(cfgFor(), '示例-A', 'stall mutated'), 1500);
  ck('mutation: without the deadline the same send is still pending after 1.5 s (the test can go red)', mutated.r === 'pending', mutated.r);
  __setSendBoundsForTest({ headerMs: HEADER_MS, totalMs: TOTAL_MS });
}
globalThis.fetch = realFetch;

// ── 3. requests per send: identity once per hub + token, never in front of the POST when network_id is known ──
latencyMs = 300;
__setSendBoundsForTest({ headerMs: 5000, totalMs: 8000 });
forgetSendIdentity(); forgetAuthMe();
{
  log.length = 0;
  const legacy = cfgFor({ username: undefined, networkId: undefined, token: 'utok_legacy' });
  await sendTask(legacy, '示例-A', 'first');
  ck('cold: no network_id ⇒ auth/me, then POST', log.map(l => l.path).join(',') === '/api/auth/me,/api/task', log.map(l => l.path).join(','));
  log.length = 0;
  // a NEW cfg object for the same hub + token (profile reload, account switch back) — previously a lookup again
  const t0 = Date.now();
  const res = await sendTask(cfgFor({ username: undefined, networkId: undefined, token: 'utok_legacy' }), '示例-A', 'warm');
  ck('warm, new cfg object: exactly 1 request per send', log.length === 1 && log[0].path === '/api/task', log.map(l => l.path).join(','));
  ck('warm: one round trip (POST ok in < 2×latency)', res.ok === true && Date.now() - t0 < 2 * latencyMs, `${Date.now() - t0} ms`);
  const sentWith = recentSendTimings()[0];
  ck('warm: send_timing says identity came from the cache with 0 wait', sentWith?.identity === 'cache' && sentWith.identityMs < 50, JSON.stringify({ identity: sentWith?.identity, identityMs: sentWith?.identityMs }));

  log.length = 0;
  const known = cfgFor({ username: undefined, token: 'utok_known_net' });
  const t1 = Date.now();
  await sendTask(known, '示例-A', 'net known, no username');
  const postAt = log.find(l => l.path === '/api/task')?.at ?? Infinity;
  const meAt = log.find(l => l.path === '/api/auth/me')?.at ?? Infinity;
  ck('network_id known, username missing: POST is not queued behind auth/me', postAt - t1 < latencyMs, `post after ${postAt - t1} ms, auth/me ${meAt === Infinity ? 'none' : `after ${meAt - t1} ms`}`);
  await sleep(latencyMs + 200);
  log.length = 0;
  await sendTask(cfgFor({ username: undefined, token: 'utok_known_net' }), '示例-A', 'second');
  ck('…the background lookup filled the cache: next send is 1 request and carries from', log.length === 1 && recentSendTimings()[0]?.identity === 'cache', log.map(l => l.path).join(','));
}
latencyMs = 0;

// ── 4. timing line: since_dreq, clock offset (skew-free check of hub-side "latency") ──
{
  const id = createDashboardRequestId();
  const created = dreqCreatedAt(id);
  ck('dreq id carries its creation time', created !== null && Math.abs(created - Date.now()) < 1000, String(created));
  ck('clock offset from Date header: server 10 s ahead ⇒ +10000 ± 1000', Math.abs((clockOffsetFrom(new Date(Date.now() + 10_000).toUTCString(), Date.now(), Date.now()) ?? 0) - 10_000) < 1000);
  const line = formatSendTiming(recentSendTimings()[0]);
  ck('send_timing line carries every stage', ['[anet-chat] send_timing', 'since_dreq_ms=', 'identity_ms=', 'headers_ms=', 'body_ms=', 'total_ms=', 'clock_offset_ms=', 'inflight=', 'req_60s='].every(k => line.includes(k)), line);
  recordSendBubble(recentSendTimings()[0].requestId, 'sent');
  ck('bubble flip is recorded on the same entry', recentSendTimings()[0].bubble?.state === 'sent');
}

// ── 5. echo state machine: nothing stays 「发送中」 without a live send behind it ──
__resetOutboxForTest(); __resetSendLifecycleForTest();
initOutbox(null, () => {});
const ALIAS = '示例-A';
const entry = (id: string, state: 'pending' | 'failed' = 'pending') => ({ id, alias: ALIAS, content: id, createdAt: Date.now(), state });
{
  // (i) app killed mid-send: pending on disk, nobody sending ⇒ orphan ⇒ failed
  __resetOutboxForTest(); __resetSendLifecycleForTest();
  const killed = createDashboardRequestId();
  initOutbox([entry(killed)], () => {});
  ck('restart: a pending entry with no live send is an orphan', orphanedPendingIds(outboxForAlias(ALIAS)).join() === killed);
  orphanedPendingIds(outboxForAlias(ALIAS)).forEach(outboxMarkFailed);
  const echoes = settleEchoes([{ _localId: killed, _pending: true }], outboxEntry);
  ck('restart: the restored echo is 未送达 (retryable), not 发送中', echoes[0]._failed === true && !echoes[0]._pending);

  // (ii) remount: instance 1 sends, instance 2 shows the echo; the send fails while 1 is not visible
  const a = createDashboardRequestId();
  outboxAdd(entry(a));
  beginSend(a);
  let shown = settleEchoes([{ _localId: a, _pending: true }], outboxEntry);
  ck('remount: while the send is live the echo stays 发送中', shown[0]._pending === true);
  let notified = 0;
  const unsub = subscribeOutbox(() => { notified++; shown = settleEchoes(shown, outboxEntry); });
  // instance 1's failure branch (not visible): reconcile could not confirm ⇒ mark failed (the #518 fix)
  outboxMarkFailed(a);
  endSend(a);
  await sleep(0);
  ck('remount: the visible instance is told and paints 未送达', notified > 0 && shown[0]._failed === true && !shown[0]._pending, JSON.stringify(shown[0]));

  // (iii) remount, success: instance 1 removed the entry; instance 2's echo becomes 已送达
  const b = createDashboardRequestId();
  outboxAdd(entry(b));
  beginSend(b);
  shown = settleEchoes([{ _localId: b, _pending: true }], outboxEntry);
  outboxRemove(b);
  endSend(b);
  notifyOutboxListeners();
  await sleep(0);
  ck('remount success: the echo leaves 发送中 as 已送达', !shown[0]._pending && !shown[0]._failed, JSON.stringify(shown[0]));
  unsub();

  // (iv) the pre-#518 shape — failure branch returns without marking — leaves a live-less pending forever.
  //      The orphan rule is what still rescues it on the next open.
  const c = createDashboardRequestId();
  outboxAdd(entry(c));
  beginSend(c); endSend(c); // the old branch: `return` with the entry still pending
  ck('old shape: entry left pending with no send behind it is caught by the orphan rule', orphanedPendingIds(outboxForAlias(ALIAS)).includes(c));
}

// ── 6. the reconcile step cannot hold the bubble either ──
{
  const t0 = Date.now();
  const exposed = await shouldExposeSendFailure(() => new Promise<void>(() => {}), () => true, 200);
  ck('a reconcile that never returns still lets the failure show (bounded)', exposed === true && Date.now() - t0 < 1000, `${Date.now() - t0} ms`);
  const exposed2 = await shouldExposeSendFailure(() => Promise.reject(new Error('hub down')), () => true, 200);
  ck('a reconcile that throws still lets the failure show', exposed2 === true);
}

// ── 7. wiring (ChatScreen is React Native; the anchors below are the paths the drive exercises end to end) ──
{
  const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
  const failBranch = chat.slice(chat.indexOf('if (!mayTouchVisibleState()) {\n        // A late A failure'), chat.indexOf('const exposeFailure = await shouldExposeSendFailure('));
  ck('ChatScreen: a send that fails while its conversation is not visible marks the outbox failed', /outboxMarkFailed\(localId\)/.test(failBranch), failBranch.length ? '' : 'branch not found');
  ck('ChatScreen: opening a conversation turns orphaned pending entries into failed', chat.includes('orphanedPendingIds(outboxForAlias(alias)).forEach(outboxMarkFailed);'));
  ck('ChatScreen: echoes re-derive from the outbox when another instance settles a send', chat.includes('subscribeOutbox(') && chat.includes('settleEchoes(prev, outboxEntry)'));
  ck('ChatScreen: every send is registered live for its whole attempt', /beginSend\(localId\);[\s\S]{0,200}finally \{\s*endSend\(localId\);/.test(chat));
  const attach = readFileSync(new URL('./attach.ts', import.meta.url), 'utf8');
  ck('attach: uploads are bounded on both web and native paths', (attach.match(/uploadDeadlineMs/g) ?? []).length >= 3);
}

console.info = quiet;
release();
server.close();
__setSendBoundsForTest();
__resetSendTimingsForTest();
console.log(`\n${pass}/${pass + failures.length} passed`);
if (failures.length) console.log(`failed:\n  ${failures.join('\n  ')}`);
process.exit(failures.length ? 1 : 0);
