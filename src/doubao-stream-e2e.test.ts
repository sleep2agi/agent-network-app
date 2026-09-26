// ck-style (self-executing; run by scripts/run-tests.mjs). 端到端:真 WebSocket + 真 HTTP,对一个**本地假服务**跑完整一句话。
//
// 假服务按文档协议实现(docs 6561/1354869):握手按请求头鉴权(新版 X-Api-Key / 旧版 X-Api-App-Key+Access-Key,
// 资源没开通回 403「requested resource not granted」)、解客户端二进制帧、每包音频回一次中间结果、
// 收到负 seq 的最后一包回终稿;另起一个极速版 HTTP 接口(docs 6561/1631584)验证回退链路。
// 只监听 127.0.0.1 的随机端口,不碰任何真实服务、不碰 hub。
//
// 客户端 = 应用里同一份 StreamingAsrSession / Utterance / finishUtterance / transcribeWav,
// 只把 WebSocket 工厂换成 bun 的 `new WebSocket(url, { headers })`(RN 是第三个参数,形状见 useVoiceInput.ts)。
// 🔴 bun 的握手失败不带 HTTP 状态码(只有「Expected 101 status code」),所以 403→not_enabled 的**定性**
// 由 doubao-stream.test.ts 用 OkHttp / SocketRocket 的原文覆盖;这里验的是「失败 → 整段走极速版」这条链路真的通。
import { StreamingAsrSession, type WsLike } from './doubao-stream';
import { decodeClientFrame, encodeServerError, encodeServerResponse, PACKET_SAMPLES } from './doubao-stream-protocol';
import { Utterance } from './voice-utterance';
import { transcribeWav, type FetchLike } from './doubao-asr';
import { pcmChunksToWav } from './voice-wav';
import type { VoiceCredentials } from './voice-credentials-model';

let p = 0, t = 0;
const ck = (name: string, cond: boolean) => { t++; if (cond) { p++; console.log(`✅ ${name}`); } else console.log(`❌ ${name}`); };

declare const Bun: any;
if (typeof Bun === 'undefined') { console.log('❌ 需要 bun(Bun.serve + 带 headers 的 WebSocket 客户端)'); process.exit(1); }

const API_KEY = 'e2e-api-key-0001';
const APP_ID = '7788';
const ACCESS = 'e2e-access-token-0002';
const GRANTED = new Set(['volc.bigasr.sauc.duration']);
const WORDS = ['今天', '天气', '不错', '，', '我们', '出去', '走走', '。'];

type Conn = { full: any; seqs: number[]; sizes: number[]; samples: number; lastSeen: boolean; closed: boolean; headers: Record<string, string>; mode: string };
const conns: Conn[] = [];

const srv = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(req: Request, server: any) {
    const url = new URL(req.url);
    const h = (n: string) => req.headers.get(n) ?? '';
    const newOk = h('x-api-key') === API_KEY;
    const oldOk = h('x-api-app-key') === APP_ID && h('x-api-access-key') === ACCESS;
    if (url.pathname === '/flash') {
      if (!newOk && !oldOk) return new Response('{"error":"invalid key"}', { status: 401 });
      if (h('x-api-resource-id') !== 'volc.bigasr.auc_turbo') return new Response('{"error":"requested resource not granted"}', { status: 403 });
      const body = await req.json() as any;
      const bytes = Buffer.from(body.audio.data, 'base64');
      const seconds = (bytes.length - 44) / 32000;
      return new Response(JSON.stringify({ result: { text: `极速版识别了${seconds.toFixed(1)}秒` } }), { status: 200, headers: { 'X-Api-Status-Code': '20000000' } });
    }
    if (!newOk && !oldOk) return new Response('{"error":"invalid key"}', { status: 401 });
    const rid = h('x-api-resource-id');
    if (!GRANTED.has(rid)) return new Response(`{"error":"[resource_id=${rid}] requested resource not granted"}`, { status: 403 });
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => { headers[k] = v; });
    const conn: Conn = { full: null, seqs: [], sizes: [], samples: 0, lastSeen: false, closed: false, headers, mode: url.searchParams.get('mode') ?? 'ok' };
    conns.push(conn);
    if (server.upgrade(req, { data: conn })) return;
    return new Response('upgrade failed', { status: 500 });
  },
  websocket: {
    message(ws: any, msg: any) {
      const conn: Conn = ws.data;
      const f = decodeClientFrame(new Uint8Array(msg));
      if (f.kind === 'full') { conn.full = f.json; ws.send(encodeServerResponse({ audio_info: { duration: 0 } }, 1, false)); return; }
      if (f.kind !== 'audio') { ws.send(encodeServerError(45000001, 'bad frame')); return; }
      conn.seqs.push(f.sequence!);
      conn.sizes.push(f.pcm.length);
      conn.samples += f.pcm.length;
      if (conn.mode === 'error_mid' && conn.seqs.length === 3) { ws.send(encodeServerError(55000031, 'server busy')); ws.close(); return; }
      const n = Math.min(WORDS.length, Math.ceil(conn.samples / PACKET_SAMPLES));
      const text = WORDS.slice(0, n).join('');
      if (f.last) {
        conn.lastSeen = true;
        if (conn.mode === 'no_final') return; // 永远不回终稿
        ws.send(encodeServerResponse({ result: { text: WORDS.join('') } }, Math.abs(f.sequence!), true));
        return;
      }
      ws.send(encodeServerResponse({ result: { text } }, f.sequence!, false));
    },
    close(ws: any) { (ws.data as Conn).closed = true; },
  },
});
const base = `127.0.0.1:${srv.port}`;

const wsFactory = (url: string, headers: Record<string, string>) => new WebSocket(url, { headers } as any) as unknown as WsLike;
const fetchImpl: FetchLike = (url, init) => fetch(url, init as RequestInit) as ReturnType<FetchLike>;
const creds = (over: Partial<VoiceCredentials> = {}, mode = 'ok'): VoiceCredentials => ({ appId: '', accessToken: API_KEY, endpoint: `http://${base}/flash`, streamEndpoint: `ws://${base}/sauc?mode=${mode}`, ...over });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const until = async (cond: () => boolean, ms = 3000) => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await sleep(5); return cond(); };

/** 一句话:每 20 ms 喂 100 ms 的 16 kHz 音频(比实时快 5 倍),共 `chunks` 段,和 useVoiceInput 一样走 Utterance。 */
async function speak(c: VoiceCredentials, chunks: number, opts: { finalTimeoutMs?: number; cancelAfter?: number } = {}) {
  const interim: string[] = [];
  const all: Int16Array[] = [];
  const remembered: string[] = [];
  const u = new Utterance({
    route: 'stream',
    loadCreds: async () => c,
    openSession: (cr, cb) => new StreamingAsrSession(cr, { wsFactory, onInterim: cb, finalTimeoutMs: opts.finalTimeoutMs ?? 3000 }),
    onInterim: x => interim.push(x),
  });
  u.start();
  for (let i = 0; i < chunks; i++) {
    const pcm = new Int16Array(1600).map((_, k) => Math.round(3000 * Math.sin((i * 1600 + k) / 8)));
    all.push(pcm);
    u.onChunk(pcm, 16000, 1);
    // 前 5 段(0.5 s)不等:真网络建连要 200–500 ms,开头的话是在 ack 之前录到的,必须排队补发。
    if (i >= 5) await sleep(20);
    if (opts.cancelAfter === i) { u.cancel(); return { cancelled: true, interim, remembered, all }; }
  }
  const flash = () => transcribeWav(c, pcmChunksToWav(all, 16000, 1).wav, { fetchImpl });
  const res = await u.finish(flash, (f, up) => remembered.push(`${f}:${up ?? ''}`));
  return { cancelled: false, res, interim, remembered, all };
}

// ── 1. 新版 API Key,正常一句:边说边出字 + 终稿 ──
{
  const before = conns.length;
  const t0 = Date.now();
  const out = await speak(creds(), 20); // 2 s 音频
  const conn = conns[before];
  ck('握手带 X-Api-Key / 资源 ID / Request-Id,没有旧版头', !!conn && conn.headers['x-api-key'] === API_KEY && conn.headers['x-api-resource-id'] === 'volc.bigasr.sauc.duration' && /^[0-9a-f-]{36}$/.test(conn.headers['x-api-request-id'] ?? '') && !('x-api-app-key' in conn.headers));
  ck('服务端收到的参数帧:pcm / 16000 / bigmodel', conn?.full?.audio?.format === 'pcm' && conn.full.audio.rate === 16000 && conn.full.request.model_name === 'bigmodel');
  ck('中间结果边说边到(≥ 5 次,逐次变长)', out.interim.length >= 5 && out.interim.every((x, i) => i === 0 || x.length >= out.interim[i - 1].length));
  ck('终稿 = 服务端最后一包的全文,走的是流式', !out.cancelled && out.res!.via === 'stream' && out.res!.text === WORDS.join(''));
  const seqs = conn.seqs;
  ck('音频 seq 从 2 连续递增,最后一包是负的', seqs.slice(0, -1).every((s, i) => s === i + 2) && seqs.at(-1) === -(seqs.length + 1) && conn.lastSeen);
  ck('ack 之前就录到了 ≥ 1 整包(开头 0.5 s 没等建连)', conn.sizes.length > 0);
  ck('服务端收到的采样数 = 录到的采样数(一个都没丢,包括 ack 前排队的)', conn.samples === 20 * 1600);
  ck('除最后一包外每包正好 200 ms(3200 采样),最后一包非空', conn.sizes.slice(0, -1).every(n => n === PACKET_SAMPLES) && conn.sizes.at(-1)! > 0);
  ck('不走极速版,不记任何失败', out.remembered.length === 0);
  console.log(`   (一句 2 s 音频,端到端 ${Date.now() - t0} ms)`);
}

// ── 2. 旧版控制台头 ──
{
  const before = conns.length;
  const out = await speak(creds({ appId: APP_ID, accessToken: ACCESS }), 8);
  const conn = conns[before];
  ck('旧版:握手带 X-Api-App-Key + X-Api-Access-Key,服务端放行,终稿走流式', conn?.headers['x-api-app-key'] === APP_ID && conn.headers['x-api-access-key'] === ACCESS && !('x-api-key' in conn.headers) && out.res!.via === 'stream');
}

// ── 3. 资源没开通(403)→ 整段走极速版,并记住 ──
{
  const before = conns.length;
  const out = await speak(creds({ streamResourceId: 'volc.seedasr.sauc.duration' }), 10);
  ck('403 资源没开通:WebSocket 没建成', conns.length === before);
  ck('→ 这一句自动改走极速版(本地 HTTP 假服务),拿到整段 1.0 秒的结果', out.res!.via === 'flash' && out.res!.text === '极速版识别了1.0秒');
  ck('没有中间结果(流式根本没通)', out.interim.length === 0);
  // bun 握手失败只给「Expected 101」→ connect_failed;RN 上是 not_enabled(被记住)—— 见文件头。
  ck('失败原因被带出(bun 上是 connect_failed)', out.res!.failure === 'connect_failed');
}

// ── 4. 服务端收了最后一包却不回终稿 → 超时 → 极速版 ──
{
  const t0 = Date.now();
  const out = await speak(creds({}, 'no_final'), 10, { finalTimeoutMs: 300 });
  const took = Date.now() - t0;
  ck('等终稿超时(300 ms)→ 极速版兜底,中间结果已经出过', out.res!.via === 'flash' && out.res!.failure === 'final_timeout' && out.interim.length > 0 && out.res!.text === '极速版识别了1.0秒');
  ck('超时不记住(偶发)', out.remembered.length === 0);
  ck('没有卡住(< 2 s)', took < 2000);
}

// ── 5. 流中服务端报错 → 极速版 ──
{
  const out = await speak(creds({}, 'error_mid'), 12);
  ck('流中 55000031 → server_error → 极速版兜底,不记住', out.res!.via === 'flash' && out.res!.failure === 'server_error' && out.res!.upstream === '55000031' && out.remembered.length === 0);
}

// ── 6. 取消:连接被关掉,服务端没收到最后一包 ──
{
  const before = conns.length;
  await speak(creds(), 10, { cancelAfter: 5 });
  const conn = conns[before];
  ck('上滑取消 → 服务端看到连接关闭,且从没收到最后一包', await until(() => !!conn?.closed) && !conn.lastSeen);
}

// ── 7. 密钥不对:流式失败 + 极速版 401 → 抛 auth_failed(真失败,不吞)──
{
  let code = '';
  try { await speak(creds({ accessToken: 'wrong-key-000000' }), 6); } catch (e) { code = (e as { code?: string }).code ?? ''; }
  ck('错误 API Key:两边都 401 → AsrError auth_failed', code === 'auth_failed');
}

srv.stop(true);
console.log(`doubao stream e2e: ${p}/${t} checks passed`);
process.exit(p === t ? 0 : 1);
