// ck-style (self-executing; run by scripts/run-tests.mjs). 流式识别会话的状态机:
// 建连 → 参数帧 → ack → 分包 → 中间结果 → 松手最后一包 → 终稿;以及取消、超时、各种失败的定性。
// WebSocket 与计时器全部是假的(同步驱动),不碰网络。
import { buildStreamConnect, classifyClose, handshakeStatus, StreamingAsrSession, type StreamOutcome, type Timers, type WsLike } from './doubao-stream';
import { decodeClientFrame, encodeServerError, encodeServerResponse, PACKET_SAMPLES } from './doubao-stream-protocol';
import type { VoiceCredentials } from './voice-credentials-model';

let p = 0, t = 0;
const ck = (name: string, cond: boolean) => { t++; if (cond) { p++; console.log(`✅ ${name}`); } else console.log(`❌ ${name}`); };

const KEY = 'api-key-SECRET-778899';
const NEW: VoiceCredentials = { appId: '', accessToken: KEY, endpoint: '' };
const OLD: VoiceCredentials = { appId: '4242', accessToken: 'acc-SECRET-1', endpoint: '' };

class FakeWs implements WsLike {
  binaryType?: string;
  sent: Uint8Array[] = [];
  closed = false;
  onopen: WsLike['onopen'] = null;
  onmessage: WsLike['onmessage'] = null;
  onerror: WsLike['onerror'] = null;
  onclose: WsLike['onclose'] = null;
  constructor(public url: string, public headers: Record<string, string>) {}
  send(d: ArrayBuffer | Uint8Array) { this.sent.push(d instanceof Uint8Array ? d : new Uint8Array(d)); }
  close() { this.closed = true; }
  open() { this.onopen?.({}); }
  recv(b: Uint8Array) { this.onmessage?.({ data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }); }
  fail(reason: string) { this.onerror?.({}); this.onclose?.({ code: 1006, reason }); }
  frames() { return this.sent.map(decodeClientFrame); }
}

class FakeTimers implements Timers {
  private n = 0;
  jobs = new Map<number, { fn: () => void; at: number }>();
  now = 0;
  set(fn: () => void, ms: number) { const id = ++this.n; this.jobs.set(id, { fn, at: this.now + ms }); return id; }
  clear(h: unknown) { this.jobs.delete(h as number); }
  advance(ms: number) {
    this.now += ms;
    for (const [id, j] of [...this.jobs]) if (j.at <= this.now) { this.jobs.delete(id); j.fn(); }
  }
}

const setup = (creds: VoiceCredentials | null = NEW) => {
  let ws: FakeWs | null = null;
  const timers = new FakeTimers();
  const interim: string[] = [];
  const s = new StreamingAsrSession(creds, {
    wsFactory: (url, headers) => (ws = new FakeWs(url, headers)),
    onInterim: x => interim.push(x),
    timers,
    requestId: 'req-uuid-1',
  });
  return { s, ws: () => ws!, timers, interim };
};
const samples = (n: number, v = 7) => new Int16Array(n).fill(v);
const resp = (text: string | null, seq: number, last = false) => encodeServerResponse(text === null ? {} : { result: { text } }, seq, last);
const flush = () => new Promise(r => setTimeout(r, 0));
/** 等一个 promise,但最多等 1 s(真实时间):该结束却没结束的,当成失败而不是把测试挂住。 */
const within = <T,>(pr: Promise<T>, ms = 1000): Promise<T | 'HUNG'> => Promise.race([pr, new Promise<'HUNG'>(r => setTimeout(() => r('HUNG'), ms))]);
const fin = async (pr: Promise<StreamOutcome>): Promise<StreamOutcome> => { const r = await within(pr); return r === 'HUNG' ? { ok: false, failure: 'HUNG' as any } : r; };

// ── 建连参数 ──
{
  const c = buildStreamConnect(NEW, 'rid');
  ck('新版控制台:只发 X-Api-Key(文档「鉴权」新版表)', c.headers['X-Api-Key'] === KEY && !('X-Api-App-Key' in c.headers) && !('X-Api-Access-Key' in c.headers));
  const o = buildStreamConnect(OLD, 'rid');
  ck('旧版控制台:X-Api-App-Key + X-Api-Access-Key', o.headers['X-Api-App-Key'] === '4242' && o.headers['X-Api-Access-Key'] === 'acc-SECRET-1' && !('X-Api-Key' in o.headers));
  ck('资源 ID 默认 volc.bigasr.sauc.duration;Request-Id / Connect-Id 同一个 UUID', c.headers['X-Api-Resource-Id'] === 'volc.bigasr.sauc.duration' && c.headers['X-Api-Request-Id'] === 'rid' && c.headers['X-Api-Connect-Id'] === 'rid');
  ck('存档里选了 2.0 资源 → 用它', buildStreamConnect({ ...NEW, streamResourceId: 'volc.seedasr.sauc.concurrent' }, 'r').headers['X-Api-Resource-Id'] === 'volc.seedasr.sauc.concurrent');
  ck('默认地址 = wss://…/sauc/bigmodel_async', c.url === 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async');
  ck('URL 里不带任何凭据', !c.url.includes(KEY));
}

// ── 正常一句:start → chunk → interim → final ──
{
  const { s, ws, interim } = setup();
  ck('建连即进入 connecting,binaryType=arraybuffer', s.phase === 'connecting' && ws().binaryType === 'arraybuffer');
  s.push(samples(PACKET_SAMPLES * 2 + 100)); // ack 之前录到的音频:排队
  ck('ack 之前一包都不发(连参数帧都要等 open)', ws().sent.length === 0);
  ws().open();
  const f0 = ws().frames();
  ck('open → 先发参数帧(seq 1)', f0.length === 1 && f0[0].kind === 'full' && f0[0].sequence === 1);
  ws().recv(resp(null, 1));
  ck('第一包回应 = ack → streaming,排队的两包按 seq 2、3 补发', s.phase === 'streaming' && ws().frames().slice(1).map(f => f.kind === 'audio' ? f.sequence : 'x').join() === '2,3');
  s.push(samples(PACKET_SAMPLES - 100));
  ck('攒够一包才发(100 + 3100 = 3200,不大于一包 → 留作尾巴)', ws().sent.length === 3);
  s.push(samples(1));
  ck('超过一包 → 发出 seq 4,留 1 个采样当尾巴', ws().sent.length === 4 && (ws().frames()[3] as any).sequence === 4 && (ws().frames()[3] as any).pcm.length === PACKET_SAMPLES);
  ws().recv(resp('今天', 2));
  ws().recv(resp('今天天气', 3));
  ws().recv(resp('今天天气', 4)); // 没变化不重复回调
  ck('中间结果逐次回调(去重)', interim.join('|') === '今天|今天天气' && s.interim === '今天天气');
  const done = s.finish();
  const lastFrame = ws().frames().at(-1) as any;
  ck('松手 → 最后一包:flags 0011 + seq -5,带着那 1 个采样的尾巴', lastFrame.kind === 'audio' && lastFrame.last && lastFrame.sequence === -5 && lastFrame.pcm.length === 1);
  ck('finishing 期间 push 不再发包', (() => { const n = ws().sent.length; s.push(samples(PACKET_SAMPLES * 3)); return ws().sent.length === n; })());
  ws().recv(resp('今天天气不错。', 5, true));
  const out = await fin(done);
  ck('服务端最后一包 → 终稿(ok)', out.ok && out.text === '今天天气不错。' && s.phase === 'done');
  ck('结束后关连接', ws().closed);
  ck('所有音频包的 seq 连续递增(2..4)后以 -5 收尾', ws().frames().filter(f => f.kind === 'audio').map((f: any) => f.sequence).join() === '2,3,4,-5');
}

// ── 松手时还没 ack:ack 到了再补发排队 + 最后一包 ──
{
  const { s, ws } = setup();
  s.push(samples(PACKET_SAMPLES + 10));
  const done = s.finish();
  ck('还没 open 就松手:什么都没发,在等', ws().sent.length === 0 && s.phase === 'finishing');
  ws().open(); ws().recv(resp(null, 1));
  const fr = ws().frames();
  ck('ack 后:参数帧 → 排队的一包(seq 2)→ 最后一包(seq -3)', fr.length === 3 && (fr[1] as any).sequence === 2 && (fr[2] as any).sequence === -3 && (fr[2] as any).last);
  ws().recv(resp('好', 3, true));
  const out = await fin(done);
  ck('终稿照常拿到', out.ok && out.text === '好');
}

// ── 终稿超时(3 s)──
{
  const { s, ws, timers } = setup();
  ws().open(); ws().recv(resp(null, 1));
  s.push(samples(100));
  ws().recv(resp('半句', 2));
  const done = s.finish();
  timers.advance(2999);
  ck('2999 ms 还在等', s.phase === 'finishing');
  timers.advance(1);
  const out = await within(done);
  ck('3000 ms 没等到最后一包 → final_timeout(上层回退极速版)', out !== 'HUNG' && !out.ok && out.failure === 'final_timeout' && ws().closed);
}

// ── 建连超时(5 s,还没 ack)──
{
  const { s, ws, timers } = setup();
  ws().open(); // open 了但服务端一直不回 ack
  timers.advance(5000);
  ck('5 s 没 ack → connect_timeout,连接关掉', s.phase === 'failed' && ws().closed);
  const out = await fin(s.finish());
  ck('之后 finish 立刻返回失败,不再等 3 s', !out.ok && out.failure === 'connect_timeout');
}
{
  const { s, ws, timers } = setup();
  ws().open(); ws().recv(resp(null, 1));
  timers.advance(60_000);
  ck('ack 之后建连计时器已撤掉(录很久也不会被判连接超时)', s.phase === 'streaming');
}

// ── 取消 ──
{
  const { s, ws, interim } = setup();
  ws().open(); ws().recv(resp(null, 1));
  s.push(samples(PACKET_SAMPLES * 2));
  const before = ws().sent.length;
  s.cancel();
  ck('取消 → cancelled + 关连接', s.phase === 'cancelled' && ws().closed);
  s.push(samples(PACKET_SAMPLES * 3));
  ws().recv(resp('不该出现', 3));
  ck('取消后不再发包、不再回调中间结果', ws().sent.length === before && interim.length === 0);
  const out = await fin(s.finish());
  ck('取消后 finish → failure=cancelled(不是识别结果)', !out.ok && out.failure === 'cancelled');
}
{
  const { s, ws } = setup();
  ws().open(); ws().recv(resp(null, 1));
  const done = s.finish();
  s.cancel();
  const out = await fin(done);
  ck('等终稿时取消 → 等待的 finish 立刻以 cancelled 结束', !out.ok && out.failure === 'cancelled');
}

// ── 失败定性 ──
{
  const { s, ws } = setup();
  ws().fail("Expected HTTP 101 response but was '403 Forbidden'");
  const out = await fin(s.finish());
  ck('安卓握手 403 → not_enabled(资源没开通)', !out.ok && out.failure === 'not_enabled' && out.upstream === '403');
}
{
  const { s, ws } = setup();
  ws().fail('Received bad response code from server: 401.');
  const out = await fin(s.finish());
  ck('iOS 握手 401 → auth_rejected', !out.ok && out.failure === 'auth_rejected' && out.upstream === '401');
}
{
  const { s, ws } = setup();
  ws().fail('Unable to resolve host "openspeech.bytedance.com"');
  const out = await fin(s.finish());
  ck('DNS / 断网 → connect_failed(不带码)', !out.ok && out.failure === 'connect_failed' && out.upstream === undefined);
}
{
  const { s, ws } = setup();
  ws().open();
  ws().recv(encodeServerError(45000001, 'bad param'));
  const out = await fin(s.finish());
  ck('ack 之前回错误帧 → rejected + 数字码', !out.ok && out.failure === 'rejected' && out.upstream === '45000001');
}
{
  const { s, ws } = setup();
  ws().open(); ws().recv(resp(null, 1));
  ws().recv(encodeServerError(55000031, 'busy'));
  const out = await fin(s.finish());
  ck('流中回错误帧 → server_error', !out.ok && out.failure === 'server_error' && out.upstream === '55000031');
}
{
  const { s, ws } = setup();
  ws().open(); ws().recv(resp(null, 1));
  ws().fail('Software caused connection abort');
  const out = await fin(s.finish());
  ck('流中断开 → closed', !out.ok && out.failure === 'closed');
}
{
  const { s, ws } = setup();
  ws().open();
  ws().recv(new Uint8Array([0x11, 0x91, 0x11, 0x00, 0, 0, 0, 1, 0, 0, 0, 2, 0x1f, 0x8b]));
  const out = await fin(s.finish());
  ck('服务端回 gzip 帧 → protocol(不卡住)', !out.ok && out.failure === 'protocol' && out.upstream === 'gzip_unsupported');
}
{
  const { s, ws } = setup();
  ws().open(); ws().recv(resp(null, 1));
  ws().recv(resp('提前结束', 2, true));
  const out = await fin(s.finish());
  ck('还没松手服务端就发了最后一包 → closed/early_last(后面的话送不上去,回退)', !out.ok && out.failure === 'closed' && out.upstream === 'early_last');
}
{
  const { s } = setup(null);
  const out = await fin(s.finish());
  ck('没凭据 → not_configured,不建连', !out.ok && out.failure === 'not_configured');
}
{
  let made = 0;
  const s = new StreamingAsrSession({ ...NEW, streamEndpoint: 'ws://evil.example.com/x' }, { wsFactory: (u, h) => { made++; return new FakeWs(u, h); } });
  const out = await fin(s.finish());
  ck('非回环 ws:// 地址 → bad_endpoint,连 WebSocket 都不建(密钥不走明文)', !out.ok && out.failure === 'bad_endpoint' && made === 0);
}
{
  const s = new StreamingAsrSession(NEW, { wsFactory: () => { throw new Error('no WebSocket ' + KEY); } });
  const out = await fin(s.finish());
  ck('WebSocket 构造抛错 → connect_failed,错误里没有密钥', !out.ok && out.failure === 'connect_failed' && !JSON.stringify(out).includes(KEY));
}

// ── 握手文字 → 状态码 ──
ck('handshakeStatus:OkHttp 文案', handshakeStatus("Expected HTTP 101 response but was '403 Forbidden'") === 403);
ck('handshakeStatus:SocketRocket 文案', handshakeStatus('Received bad response code from server: 401.') === 401);
ck('handshakeStatus:没数字 → undefined', handshakeStatus('connection reset') === undefined);
ck('classifyClose:408 / 429 不算「被拒」', classifyClose({ acked: false, reason: '429' }).failure === 'connect_failed' && classifyClose({ acked: false, reason: '408' }).failure === 'connect_failed');
ck('classifyClose:其他 4xx → rejected', classifyClose({ acked: false, reason: "was '400 Bad Request'" }).failure === 'rejected');
ck('classifyClose:ack 之后的关闭一律 closed(不看文字里的数字)', classifyClose({ acked: true, reason: '403' }).failure === 'closed');

await flush();
console.log(`doubao stream session: ${p}/${t} checks passed`);
process.exit(p === t ? 0 : 1);
