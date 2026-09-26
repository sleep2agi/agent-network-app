// 豆包语音「大模型流式语音识别」WebSocket 二进制帧协议(火山引擎 docs 6561/1354869)。
//
//   wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async   双向流式(优化版,结果有变化才回包)
//   建连请求头:X-Api-App-Key + X-Api-Access-Key(旧版控制台)| X-Api-Key(新版控制台)
//             X-Api-Resource-Id: volc.bigasr.sauc.duration(小时版)/ .concurrent(并发版)
//                                / volc.seedasr.sauc.duration / .concurrent(2.0)
//             X-Api-Request-Id / X-Api-Connect-Id: UUID
//
// 每一帧 = 4 字节 header [+ 4 字节 sequence(flags bit0)] + 4 字节 payload size(大端)+ payload
//   byte0: version(0b0001) << 4 | header size(0b0001 = 4 字节)
//   byte1: message type << 4 | flags
//            type  0b0001 full client request(JSON 参数) · 0b0010 audio only(PCM)
//                  0b1001 full server response            · 0b1111 error(code + size + UTF-8 消息)
//            flags 0b0000 无 sequence · 0b0001 正 sequence · 0b0010 最后一包无 sequence
//                  0b0011 最后一包,sequence 为负
//   byte2: serialization << 4 | compression(0 = 无 / 1 = gzip;服务端沿用客户端的压缩方式)
//   byte3: reserved 0x00
// 整数一律大端(docs 原文「协议中整数类型的字段都使用大端表示」)。
//
// 🔴 我们发 compression=0(不压缩):RN 的 Hermes 没有 CompressionStream,手写 gzip 不值得;
// 文档写明服务端「将使用客户端的压缩方法」。万一服务端仍回 gzip 帧,decode 返回
// `gzip_unsupported`,上层按协议错误回退到极速版 —— 不会卡死。
//
// 纯逻辑:不 import react-native,不碰网络、不打日志。

export const PROTOCOL_VERSION = 0b0001;
export const HEADER_SIZE_WORDS = 0b0001;

export const MSG_FULL_CLIENT_REQUEST = 0b0001;
export const MSG_AUDIO_ONLY_REQUEST = 0b0010;
export const MSG_FULL_SERVER_RESPONSE = 0b1001;
export const MSG_SERVER_ERROR = 0b1111;

export const FLAG_NO_SEQUENCE = 0b0000;
export const FLAG_POS_SEQUENCE = 0b0001;
export const FLAG_LAST_NO_SEQUENCE = 0b0010;
export const FLAG_LAST_WITH_NEG_SEQUENCE = 0b0011;

export const SERIAL_NONE = 0b0000;
export const SERIAL_JSON = 0b0001;
export const COMPRESS_NONE = 0b0000;
export const COMPRESS_GZIP = 0b0001;

export const STREAM_DEFAULT_ENDPOINT = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async';

/** 控制台里能开通的四种流式资源(docs 鉴权表)。默认 1.0 小时版。 */
export const STREAM_RESOURCE_IDS = [
  'volc.bigasr.sauc.duration',
  'volc.bigasr.sauc.concurrent',
  'volc.seedasr.sauc.duration',
  'volc.seedasr.sauc.concurrent',
] as const;
export type StreamResourceId = (typeof STREAM_RESOURCE_IDS)[number];
export const STREAM_DEFAULT_RESOURCE_ID: StreamResourceId = 'volc.bigasr.sauc.duration';

export function isStreamResourceId(v: unknown): v is StreamResourceId {
  return typeof v === 'string' && (STREAM_RESOURCE_IDS as readonly string[]).includes(v);
}

/** 16 kHz 16-bit 单声道:200 ms = 3200 个采样 = 6400 字节(docs:双向流式 200 ms 一包性能最优)。 */
export const STREAM_SAMPLE_RATE = 16000;
export const PACKET_MS = 200;
export const PACKET_SAMPLES = (STREAM_SAMPLE_RATE * PACKET_MS) / 1000;

export function headerBytes(messageType: number, flags: number, serialization: number, compression: number): Uint8Array {
  return new Uint8Array([
    (PROTOCOL_VERSION << 4) | HEADER_SIZE_WORDS,
    ((messageType & 0x0f) << 4) | (flags & 0x0f),
    ((serialization & 0x0f) << 4) | (compression & 0x0f),
    0x00,
  ]);
}

function frame(header: Uint8Array, sequence: number | null, payload: Uint8Array): Uint8Array {
  const seqLen = sequence === null ? 0 : 4;
  const out = new Uint8Array(4 + seqLen + 4 + payload.length);
  const v = new DataView(out.buffer);
  out.set(header, 0);
  if (sequence !== null) v.setInt32(4, sequence, false);
  v.setUint32(4 + seqLen, payload.length, false);
  out.set(payload, 8 + seqLen);
  return out;
}

// UTF-8 手写:Hermes 的 TextDecoder 支持随版本变化,识别结果是中文,不能赌。
export function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(out);
}

export function utf8Decode(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length;) {
    const c = b[i++];
    let cp: number;
    if (c < 0x80) cp = c;
    else if (c >> 5 === 0b110) cp = ((c & 31) << 6) | (b[i++] & 63);
    else if (c >> 4 === 0b1110) { cp = ((c & 15) << 12) | ((b[i] & 63) << 6) | (b[i + 1] & 63); i += 2; }
    else if (c >> 3 === 0b11110) { cp = ((c & 7) << 18) | ((b[i] & 63) << 12) | ((b[i + 1] & 63) << 6) | (b[i + 2] & 63); i += 3; }
    else cp = 0xfffd;
    s += String.fromCodePoint(cp);
  }
  return s;
}

const utf8 = utf8Encode;

/** 第一帧:JSON 参数,正 sequence(= 1)。 */
export function encodeFullClientRequest(params: unknown, sequence = 1): Uint8Array {
  return frame(headerBytes(MSG_FULL_CLIENT_REQUEST, FLAG_POS_SEQUENCE, SERIAL_JSON, COMPRESS_NONE), sequence, utf8(JSON.stringify(params)));
}

/**
 * 音频帧:PCM s16le 原始字节。中间包正 sequence;最后一包 flags=0b0011、sequence 取负
 * (官方 Python demo 的写法:最后一包 seq = -seq)。
 */
export function encodeAudioRequest(pcm: Int16Array, sequence: number, last: boolean): Uint8Array {
  const bytes = new Uint8Array(pcm.length * 2);
  const v = new DataView(bytes.buffer);
  for (let i = 0; i < pcm.length; i++) v.setInt16(i * 2, pcm[i], true); // pcm_s16le:采样本身小端
  const seq = Math.abs(sequence);
  return frame(
    headerBytes(MSG_AUDIO_ONLY_REQUEST, last ? FLAG_LAST_WITH_NEG_SEQUENCE : FLAG_POS_SEQUENCE, SERIAL_NONE, COMPRESS_NONE),
    last ? -seq : seq,
    bytes,
  );
}

/** full client request 的 JSON 参数。 */
export function buildStreamParams(uid = 'agent-network-app') {
  return {
    user: { uid, platform: 'agent-network-app' },
    audio: { format: 'pcm', codec: 'raw', rate: STREAM_SAMPLE_RATE, bits: 16, channel: 1 },
    request: { model_name: 'bigmodel', enable_itn: true, enable_punc: true, result_type: 'full' },
  };
}

export type ServerFrame =
  /** 识别结果。last = 服务端标了「最后一包」(flags bit1)或 sequence 为负。 */
  | { kind: 'response'; sequence: number | null; last: boolean; text: string | null; json: unknown }
  /** 服务端错误帧:只保留数字错误码,不保留消息正文(可能回显请求内容)。 */
  | { kind: 'error'; code: number }
  | { kind: 'bad'; reason: 'too_short' | 'bad_version' | 'bad_type' | 'bad_size' | 'gzip_unsupported' | 'bad_json' };

/** result 可能是对象 `{text}`(示例)或列表(字段表写的 list):两种都收。 */
export function resultText(json: unknown): string | null {
  const r = (json as { result?: unknown } | null)?.result;
  if (!r) return null;
  if (Array.isArray(r)) {
    const parts = r.map(x => (x as { text?: unknown })?.text).filter((x): x is string => typeof x === 'string');
    return parts.length ? parts.join('') : null;
  }
  const text = (r as { text?: unknown }).text;
  return typeof text === 'string' ? text : null;
}

export function decodeServerFrame(input: ArrayBuffer | Uint8Array): ServerFrame {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (b.length < 4) return { kind: 'bad', reason: 'too_short' };
  if (b[0] >> 4 !== PROTOCOL_VERSION) return { kind: 'bad', reason: 'bad_version' };
  const headerLen = (b[0] & 0x0f) * 4;
  if (headerLen < 4 || b.length < headerLen) return { kind: 'bad', reason: 'too_short' };
  const type = b[1] >> 4;
  const flags = b[1] & 0x0f;
  const serialization = b[2] >> 4;
  const compression = b[2] & 0x0f;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let off = headerLen;
  const need = (n: number) => b.length >= off + n;

  if (type === MSG_SERVER_ERROR) {
    if (!need(4)) return { kind: 'bad', reason: 'too_short' };
    const code = v.getUint32(off, false);
    return { kind: 'error', code };
  }
  if (type !== MSG_FULL_SERVER_RESPONSE) return { kind: 'bad', reason: 'bad_type' };

  let sequence: number | null = null;
  if (flags & 0b0001) {
    if (!need(4)) return { kind: 'bad', reason: 'too_short' };
    sequence = v.getInt32(off, false);
    off += 4;
  }
  if (flags & 0b0100) { // event 号(官方 demo 解析了这一位;识别接口不用,跳过)
    if (!need(4)) return { kind: 'bad', reason: 'too_short' };
    off += 4;
  }
  const last = (flags & 0b0010) !== 0 || (sequence !== null && sequence < 0);
  if (!need(4)) return { kind: 'bad', reason: 'too_short' };
  const size = v.getUint32(off, false);
  off += 4;
  if (b.length < off + size) return { kind: 'bad', reason: 'bad_size' };
  const payload = b.subarray(off, off + size);
  if (size === 0) return { kind: 'response', sequence, last, text: null, json: null };
  if (compression === COMPRESS_GZIP) return { kind: 'bad', reason: 'gzip_unsupported' };
  if (serialization !== SERIAL_JSON) return { kind: 'response', sequence, last, text: null, json: null };
  let json: unknown;
  try { json = JSON.parse(utf8Decode(payload)); } catch { return { kind: 'bad', reason: 'bad_json' }; }
  return { kind: 'response', sequence, last, text: resultText(json), json };
}

// ── 服务端侧编码:给本地假服务 / 测试用(协议对称,放在一起防止两边各写一份走样) ──

export function encodeServerResponse(json: unknown, sequence: number, last: boolean): Uint8Array {
  return frame(
    headerBytes(MSG_FULL_SERVER_RESPONSE, last ? FLAG_LAST_WITH_NEG_SEQUENCE : FLAG_POS_SEQUENCE, SERIAL_JSON, COMPRESS_NONE),
    last ? -Math.abs(sequence) : sequence,
    utf8(JSON.stringify(json)),
  );
}

export function encodeServerError(code: number, message: string): Uint8Array {
  const msg = utf8(message);
  const out = new Uint8Array(12 + msg.length);
  const v = new DataView(out.buffer);
  out.set(headerBytes(MSG_SERVER_ERROR, FLAG_NO_SEQUENCE, SERIAL_JSON, COMPRESS_NONE), 0);
  v.setUint32(4, code >>> 0, false);
  v.setUint32(8, msg.length, false);
  out.set(msg, 12);
  return out;
}

export type ClientFrame =
  | { kind: 'full'; sequence: number | null; json: unknown }
  | { kind: 'audio'; sequence: number | null; last: boolean; pcm: Int16Array }
  | { kind: 'bad'; reason: string };

/** 解客户端帧(假服务用;也让测试能对「发出去的字节」做往返断言)。 */
export function decodeClientFrame(input: ArrayBuffer | Uint8Array): ClientFrame {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (b.length < 8 || b[0] !== ((PROTOCOL_VERSION << 4) | HEADER_SIZE_WORDS)) return { kind: 'bad', reason: 'header' };
  const type = b[1] >> 4;
  const flags = b[1] & 0x0f;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let off = 4;
  let sequence: number | null = null;
  if (flags & 0b0001) { sequence = v.getInt32(off, false); off += 4; }
  if (b.length < off + 4) return { kind: 'bad', reason: 'size' };
  const size = v.getUint32(off, false);
  off += 4;
  if (b.length !== off + size) return { kind: 'bad', reason: 'size' };
  if ((b[2] & 0x0f) !== COMPRESS_NONE) return { kind: 'bad', reason: 'compression' };
  const payload = b.subarray(off);
  if (type === MSG_FULL_CLIENT_REQUEST) {
    try { return { kind: 'full', sequence, json: JSON.parse(utf8Decode(payload)) }; } catch { return { kind: 'bad', reason: 'json' }; }
  }
  if (type === MSG_AUDIO_ONLY_REQUEST) {
    if (size % 2) return { kind: 'bad', reason: 'odd_pcm' };
    const pcm = new Int16Array(size / 2);
    const pv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    for (let i = 0; i < pcm.length; i++) pcm[i] = pv.getInt16(i * 2, true);
    return { kind: 'audio', sequence, last: (flags & 0b0010) !== 0, pcm };
  }
  return { kind: 'bad', reason: 'type' };
}
