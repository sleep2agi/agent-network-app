import { canBackgroundSession, errorDetailLabel, readSessionControlState, runSessionControl, sessionControlTarget } from './node-session-control';
import { sessionControlTranslations } from './i18n-session-control';
// @ts-expect-error -- bun test runner only
import { readFileSync } from 'node:fs';
let pass = 0, total = 0;
function ck(name: string, condition: boolean) { total++; if (condition) { pass++; console.log('✅', name); } else console.log('❌', name); }
// 失败原因要能落到一句短标签上（HTTP 404 / 超时 / 网络错误 / 响应不是预期格式），
// 但不含 URL、token、响应正文 —— 用户看到「为什么读不出来」，我们也能立刻分辨
// 「Hub 还没上线这个接口」与「网络抖动」。
ck('http status becomes a short label', errorDetailLabel('http', 404) === 'HTTP 404');
ck('missing status still labelled', errorDetailLabel('http', undefined) === 'HTTP ?');
ck('timeout labelled', errorDetailLabel('timeout') === '超时');
ck('network labelled', errorDetailLabel('network') === '网络错误');
ck('non-json body labelled', errorDetailLabel('body') === '响应不是预期格式');


const cfg = { serverUrl: 'https://fixture.invalid/', token: 'fixture-user-token', networkId: 'net_fixture' };
const target = { node_id: 'n_target', network_id: 'net_fixture', session_id: 'ses_Target2014' };
const state = { session_id: target.session_id, binding_id: 'generation-2014', supported: true, active: true, can_request_background: true, observed_at: Date.now() };
const session = { alias: 'target', status: 'working', agent: 'agent-node:opencode', ...target };
ck('exact network/node OpenCode target', sessionControlTarget(cfg, session, 'target')?.node_id === 'n_target');
ck('foreign network refused', sessionControlTarget(cfg, { ...session, network_id: 'net_peer' }, 'target') === null);
ck('same alias is not node identity', sessionControlTarget(cfg, { ...session, node_id: undefined }, 'target') === null);
ck('other alias refused on navigation', sessionControlTarget(cfg, session, 'peer') === null);
ck('non OpenCode has no entry', sessionControlTarget(cfg, { ...session, agent: 'codex' }, 'target') === null);
ck('busy alone not a background capability', !canBackgroundSession(null, 1, 2));
ck('fresh positive capability allows request', canBackgroundSession(state, 1000, 2000));
ck('stale state refuses', !canBackgroundSession(state, 1000, 31000));
ck('clock reversal refuses', !canBackgroundSession(state, 1000, 999));
ck('malformed state refuses', readSessionControlState({ ...state, supported: false }) === null);
ck('unknown binding shape refuses', readSessionControlState({ ...state, binding_id: 'x/y' }) === null);

const original = globalThis.fetch;
const id = `bg_${Date.now()}_request2014`;
type Call = { url: string; method: string; body: any; authorization: string | null };
const calls: Call[] = [];
let mode = 'state';
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input), method = init?.method || 'GET';
  calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null, authorization: new Headers(init?.headers).get('authorization') });
  if (mode === 'http404') return new Response(null, { status: 404 });
  if (mode === 'denied') return new Response(null, { status: 403 });
  if (mode === 'lost') throw Error('private token/endpoint detail');
  if (mode === 'binding409') return Response.json({ ok: false, error: 'session_control_changed' }, { status: 409 });
  if (method === 'POST') return Response.json({ ok: true, request_id: id, status: 'pending', expires_at: Date.now() + 15_000 });
  if (mode === 'receipt-gone') return new Response(null, { status: 404 });
  if (mode === 'unknown') return Response.json({ ok: true, request_id: id, status: 'unknown' });
  if (mode === 'foreign-receipt') return Response.json({ ok: true, request_id: `bg_${Date.now()}_peer2014`, status: 'done', result: state });
  const s = mode === 'changed' ? { ...state, session_id: 'ses_Peer2014' } : state;
  return Response.json({ ok: true, request_id: id, status: 'done', result: mode === 'state' || mode === 'changed' || mode === 'foreign-receipt' ? s : { outcome: mode === 'bad-outcome' ? 'background_succeeded' : mode === 'idle' ? 'already_idle' : 'request_processed', state: s } });
}) as typeof fetch;
try {
  let result = await runSessionControl(cfg, target);
  ck('read goes to fixed Hub endpoint', result.ok && calls[0].url === 'https://fixture.invalid/api/node-session-control');
  ck('request carries original immutable target', calls[0].body.node_id === target.node_id && calls[0].body.network_id === target.network_id && calls[0].body.operation === 'state');
  ck('transport uses configured Hub auth', calls.every(c => c.authorization === 'Bearer fixture-user-token'));
  calls.length = 0; mode = 'background'; result = await runSessionControl(cfg, target, state);
  ck('204 semantics rendered only as processed', result.ok && result.outcome === 'request_processed');
  ck('one mutation enqueue and receipt GET', calls.filter(c => c.method === 'POST').length === 1 && calls.filter(c => c.method === 'GET').length === 1);
  ck('mutation carries expected binding, no commands', calls[0].body.expected.binding_id === state.binding_id && !('keys' in calls[0].body) && !('command' in calls[0].body));
  for (const scenario of ['http404', 'denied', 'binding409', 'lost', 'unknown', 'receipt-gone', 'foreign-receipt', 'changed', 'bad-outcome', 'idle']) {
    mode = scenario; calls.length = 0;
    result = await runSessionControl(cfg, target, scenario === 'changed' ? undefined : state);
    const expected = ({ http404: 'unsupported', denied: 'access', binding409: 'changed', lost: 'unknown', unknown: 'unknown', 'receipt-gone': 'unknown', 'foreign-receipt': 'unknown', changed: 'changed', 'bad-outcome': 'unknown' } as Record<string, string>)[scenario];
    ck(`${scenario} truthful outcome`, scenario === 'idle' ? result.ok && result.outcome === 'already_idle' : !result.ok && result.error === expected);
    ck(`${scenario} never re-enqueues`, calls.filter(c => c.method === 'POST').length === 1);
  }
  calls.length = 0; result = await runSessionControl({ ...cfg, networkId: 'net_peer' }, target, state);
  ck('network switch rejected before send', !result.ok && calls.length === 0);
  result = await runSessionControl(cfg, target, { ...state, session_id: 'ses_Peer2014' });
  ck('foreign expected session rejected before mutation', !result.ok && calls.length === 0);
  ck('bilingual UI covers every key', Object.values(sessionControlTranslations).every(pair => pair[0].length > 0 && pair[1].length > 0));
  ck('unknown explicitly says not retried', /not retried/.test(sessionControlTranslations['sessionControl.error.unknown'][1]));
  const component = readFileSync(new URL('./NodeSessionControl.tsx', import.meta.url), 'utf8');
  ck('unknown disables further background writes', component.includes('!unknown && canBackgroundSession') && component.includes('setUnknown(true)'));
  ck('no eager status traffic blocks chat first paint', !component.includes('useEffect(() => { void run('));
  for (const file of ['ChatScreen.tsx', 'NodeDetailScreen.tsx']) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    ck(`${file} scopes and keys the component`, source.includes('sessionControlTarget(cfg,') && source.includes('key={JSON.stringify([cfg.serverUrl, cfg.token, backgroundTarget])}'));
  }
} finally { globalThis.fetch = original; }
console.log(`${pass}/${total} passed`);
if (pass !== total) throw new Error(`${total - pass} session-control checks failed`);
