// 豆包「大模型流式语音识别」的一次会话(一句话 = 一条 WebSocket)。
//
//   new StreamingAsrSession(creds, { wsFactory, onInterim })   按下麦克风时就建连(和开麦并行)
//   session.push(pcm16kMono)                                    录音回调每 ~100 ms 一段,攒够 200 ms 发一包
//   await session.finish()                                      松手:发最后一包(负 sequence),最多等 3 s 终稿
//   session.cancel()                                            上滑取消 / 手势被夺走
//
// 状态:connecting ──(open → 发参数帧 → 服务端回第一包 = ack)──▶ streaming ──finish──▶ finishing ──last──▶ done
//        任一阶段出错 → failed(带失败原因,上层据此决定回退极速版、是否记住「流式不可用」)
//        cancel → cancelled(不再回调、不再发包)
//
// 在 ack 之前录到的音频先排队,ack 后一次性补发:建连要 200–500 ms,不排队的话开头一个字就丢了。
// 永远留一小段尾巴不发(pending > 一包才发),保证「最后一包」里有真实音频,不发空的负包。
//
// 🔴 不打日志;失败只带失败类别 + 数字码(HTTP 状态或服务端错误码),不带响应正文或请求头。

import type { VoiceCredentials } from './voice-credentials-model';
import { authMode, checkStreamEndpoint } from './voice-credentials-model';
import {
  buildStreamParams,
  decodeServerFrame,
  encodeAudioRequest,
  encodeFullClientRequest,
  isStreamResourceId,
  PACKET_SAMPLES,
  STREAM_DEFAULT_RESOURCE_ID,
} from './doubao-stream-protocol';

export const STREAM_CONNECT_TIMEOUT_MS = 5000;
/** 松手后等终稿的上限;超过就回退极速版(拿全部录音重识别一次)。 */
export const STREAM_FINAL_TIMEOUT_MS = 3000;

export type WsLike = {
  binaryType?: string;
  send(data: ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
};

/** RN:`new WebSocket(url, undefined, { headers })`;测试:bun 的 `new WebSocket(url, { headers })`。 */
export type WsFactory = (url: string, headers: Record<string, string>) => WsLike;

export type StreamFailure =
  | 'not_configured'
  | 'bad_endpoint'
  /** 握手 HTTP 401:密钥不对。 */
  | 'auth_rejected'
  /** 握手 HTTP 403:密钥对,流式资源没开通(requested resource not granted)。 */
  | 'not_enabled'
  /** 握手其他 4xx,或服务端在 ack 之前回了错误帧(参数/资源被拒)。 */
  | 'rejected'
  | 'connect_failed'
  | 'connect_timeout'
  /** 已经在流了,服务端回错误帧。 */
  | 'server_error'
  /** 帧解不开(含服务端回了 gzip)。 */
  | 'protocol'
  /** 已经在流了,连接断开。 */
  | 'closed'
  | 'final_timeout'
  | 'cancelled';

export type StreamOutcome = { ok: true; text: string } | { ok: false; failure: StreamFailure; upstream?: string };

export type StreamPhase = 'connecting' | 'streaming' | 'finishing' | 'done' | 'failed' | 'cancelled';

export type Timers = {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: h => clearTimeout(h as ReturnType<typeof setTimeout>) };

export type StreamOptions = {
  wsFactory: WsFactory;
  onInterim?: (text: string) => void;
  connectTimeoutMs?: number;
  finalTimeoutMs?: number;
  timers?: Timers;
  requestId?: string;
};

const newUuid = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const h = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${h()}${h()}-${h()}-4${h().slice(1)}-a${h().slice(1)}-${h()}${h()}${h()}`;
};

export type StreamConnectRequest = { url: string; headers: Record<string, string> };

/** 建连 URL + 请求头(docs「鉴权」表)。 */
export function buildStreamConnect(creds: VoiceCredentials, requestId: string): StreamConnectRequest {
  const ep = checkStreamEndpoint(creds.streamEndpoint || '');
  if (!ep.ok) throw new Error('bad_endpoint');
  const headers: Record<string, string> = {
    'X-Api-Resource-Id': isStreamResourceId(creds.streamResourceId) ? creds.streamResourceId : STREAM_DEFAULT_RESOURCE_ID,
    'X-Api-Request-Id': requestId,
    'X-Api-Connect-Id': requestId,
    'X-Api-Sequence': '-1',
  };
  if (authMode(creds) === 'app-token') {
    headers['X-Api-App-Key'] = creds.appId;
    headers['X-Api-Access-Key'] = creds.accessToken;
  } else {
    headers['X-Api-Key'] = creds.accessToken;
  }
  return { url: ep.url, headers };
}

/**
 * 握手失败时各端给的文字:安卓 OkHttp「Expected HTTP 101 response but was '403 Forbidden'」,
 * iOS SocketRocket「Received bad response code from server: 403.」。只取里面的 HTTP 状态码。
 */
export function handshakeStatus(reason: string | undefined): number | undefined {
  // OkHttp 的句子里先出现「101」(期望值)再出现真实状态:跳过 101 取第一个别的。
  const re = /\b([1-5]\d\d)\b/g;
  const text = reason ?? '';
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const n = Number(m[1]);
    if (n !== 101) return n;
  }
  return undefined;
}

export function classifyClose(opts: { acked: boolean; reason?: string }): { failure: StreamFailure; upstream?: string } {
  const status = handshakeStatus(opts.reason);
  if (!opts.acked && status !== undefined) {
    if (status === 401) return { failure: 'auth_rejected', upstream: '401' };
    if (status === 403) return { failure: 'not_enabled', upstream: '403' };
    if (status >= 400 && status < 500 && status !== 408 && status !== 429) return { failure: 'rejected', upstream: String(status) };
    return { failure: 'connect_failed', upstream: String(status) };
  }
  return { failure: opts.acked ? 'closed' : 'connect_failed' };
}

export class StreamingAsrSession {
  private ws: WsLike | null = null;
  private _phase: StreamPhase = 'connecting';
  private acked = false;
  private seq = 2; // 1 = 参数帧
  private pending: Int16Array = new Int16Array(0);
  private queue: Int16Array[] = [];
  private _interim = '';
  private finalText: string | null = null;
  private failure: { failure: StreamFailure; upstream?: string } | null = null;
  private connectTimer: unknown = null;
  private finalTimer: unknown = null;
  private resolveFinish: ((o: StreamOutcome) => void) | null = null;
  private lastSent = false;
  private readonly timers: Timers;

  constructor(creds: VoiceCredentials | null, private readonly opts: StreamOptions) {
    this.timers = opts.timers ?? realTimers;
    if (!creds || !creds.accessToken) { this.fail('not_configured'); return; }
    let req: StreamConnectRequest;
    try { req = buildStreamConnect(creds, opts.requestId ?? newUuid()); } catch { this.fail('bad_endpoint'); return; }
    this.connectTimer = this.timers.set(() => { this.connectTimer = null; if (!this.acked) this.fail('connect_timeout'); }, opts.connectTimeoutMs ?? STREAM_CONNECT_TIMEOUT_MS);
    let ws: WsLike;
    try { ws = opts.wsFactory(req.url, req.headers); } catch { this.fail('connect_failed'); return; }
    this.ws = ws;
    try { ws.binaryType = 'arraybuffer'; } catch { /* 只读实现 */ }
    ws.onopen = () => {
      if (!this.live()) return;
      this.sendFrame(encodeFullClientRequest(buildStreamParams(), 1));
    };
    ws.onmessage = ev => this.onFrame(ev.data);
    ws.onerror = () => { /* 各端 error 之后都会再发 close(带原因),在 close 里定性 */ };
    ws.onclose = ev => {
      if (!this.live()) return;
      const c = classifyClose({ acked: this.acked, reason: ev?.reason });
      this.fail(c.failure, c.upstream);
    };
  }

  get phase(): StreamPhase { return this._phase; }
  get interim(): string { return this._interim; }

  /** 16 kHz 单声道 int16。 */
  push(pcm: Int16Array): void {
    if (this._phase !== 'connecting' && this._phase !== 'streaming') return;
    if (!pcm.length) return;
    const merged = new Int16Array(this.pending.length + pcm.length);
    merged.set(this.pending, 0);
    merged.set(pcm, this.pending.length);
    let off = 0;
    // 严格大于:永远留一截给最后一包。
    while (merged.length - off > PACKET_SAMPLES) {
      this.emitPacket(merged.slice(off, off + PACKET_SAMPLES));
      off += PACKET_SAMPLES;
    }
    this.pending = merged.slice(off);
  }

  finish(): Promise<StreamOutcome> {
    if (this.failure) return Promise.resolve({ ok: false, ...this.failure });
    if (this._phase === 'cancelled') return Promise.resolve({ ok: false, failure: 'cancelled' });
    if (this._phase === 'done') return Promise.resolve({ ok: true, text: (this.finalText ?? this._interim).trim() });
    if (this._phase === 'finishing') return new Promise(r => { const prev = this.resolveFinish; this.resolveFinish = o => { prev?.(o); r(o); }; });
    this._phase = 'finishing';
    const p = new Promise<StreamOutcome>(r => { this.resolveFinish = r; });
    this.finalTimer = this.timers.set(() => { this.finalTimer = null; this.fail('final_timeout'); }, this.opts.finalTimeoutMs ?? STREAM_FINAL_TIMEOUT_MS);
    if (this.acked) this.sendLast();
    return p;
  }

  cancel(): void {
    if (this._phase === 'done' || this._phase === 'failed' || this._phase === 'cancelled') return;
    this._phase = 'cancelled';
    this.teardown();
    const r = this.resolveFinish; this.resolveFinish = null;
    r?.({ ok: false, failure: 'cancelled' });
  }

  // ── 内部 ──

  private live(): boolean { return this._phase === 'connecting' || this._phase === 'streaming' || this._phase === 'finishing'; }

  private emitPacket(pkt: Int16Array): void {
    if (this.acked) this.sendFrame(encodeAudioRequest(pkt, this.seq++, false));
    else this.queue.push(pkt);
  }

  private sendLast(): void {
    if (this.lastSent) return;
    this.lastSent = true;
    this.sendFrame(encodeAudioRequest(this.pending, this.seq, true));
    this.pending = new Int16Array(0);
  }

  private sendFrame(bytes: Uint8Array): void {
    try { this.ws?.send(bytes); } catch { this.fail(this.acked ? 'closed' : 'connect_failed'); }
  }

  private onFrame(data: unknown): void {
    if (!this.live()) return;
    let bytes: Uint8Array | null = null;
    if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
    else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (!bytes) { this.fail('protocol'); return; }
    const f = decodeServerFrame(bytes);
    if (f.kind === 'bad') { this.fail('protocol', f.reason); return; }
    if (f.kind === 'error') { this.fail(this.acked ? 'server_error' : 'rejected', String(f.code)); return; }
    if (!this.acked) {
      this.acked = true;
      if (this.connectTimer !== null) { this.timers.clear(this.connectTimer); this.connectTimer = null; }
      if (this._phase === 'connecting') this._phase = 'streaming';
      const q = this.queue; this.queue = [];
      for (const pkt of q) this.sendFrame(encodeAudioRequest(pkt, this.seq++, false));
      if (this._phase === 'finishing') this.sendLast();
    }
    if (f.text !== null && f.text !== this._interim) {
      this._interim = f.text;
      this.opts.onInterim?.(f.text);
    }
    if (f.last) {
      this.finalText = f.text ?? this._interim;
      if (this._phase === 'finishing') this.succeed();
      else {
        // 服务端先于松手结束(例如单连接时长上限):后面的录音送不上去了,按断开处理 → 回退极速版。
        this.fail('closed', 'early_last');
      }
    }
  }

  private succeed(): void {
    this._phase = 'done';
    this.teardown();
    const r = this.resolveFinish; this.resolveFinish = null;
    r?.({ ok: true, text: (this.finalText ?? this._interim).trim() });
  }

  private fail(failure: StreamFailure, upstream?: string): void {
    if (this.failure || this._phase === 'done' || this._phase === 'cancelled') return;
    this.failure = upstream ? { failure, upstream } : { failure };
    this._phase = 'failed';
    this.teardown();
    const r = this.resolveFinish; this.resolveFinish = null;
    r?.({ ok: false, ...this.failure });
  }

  private teardown(): void {
    if (this.connectTimer !== null) { this.timers.clear(this.connectTimer); this.connectTimer = null; }
    if (this.finalTimer !== null) { this.timers.clear(this.finalTimer); this.finalTimer = null; }
    const ws = this.ws; this.ws = null;
    if (ws) {
      ws.onopen = null; ws.onmessage = null; ws.onerror = null; ws.onclose = null;
      try { ws.close(1000, ''); } catch { /* 已关 */ }
    }
    this.queue = [];
  }
}
