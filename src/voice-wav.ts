// 语音输入:麦克风 PCM → 16 kHz 单声道 16-bit WAV → base64。
//
// 为什么在客户端自己编 WAV:豆包「录音文件识别极速版」只收 WAV / MP3 / OGG OPUS
// (docs 6561/1631584「使用限制」),而 expo-audio 的文件录音在安卓只出 AAC/AMR/WebM,
// 浏览器 MediaRecorder 出 webm/mp4。三端都能拿到原始 PCM(安卓/iOS = expo-audio
// AudioStream,桌面/网页 = Web Audio),自己封 44 字节 WAV 头就三端一致,不需要任何转码依赖。
//
// 纯逻辑:不 import react-native,不碰网络、不打日志(音频内容不能进日志)。

export const TARGET_SAMPLE_RATE = 16000;

/** float32 [-1,1] → int16(越界截断)。 */
export function float32ToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i] || 0));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

/** 多段拼成一段。 */
export function concatInt16(chunks: readonly Int16Array[]): Int16Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Int16Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

/** 交织多声道 → 取平均成单声道。channels<=1 原样返回。 */
export function downmixInt16(input: Int16Array, channels: number): Int16Array {
  if (!(channels > 1)) return input;
  const frames = Math.floor(input.length / channels);
  const out = new Int16Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += input[f * channels + c];
    out[f] = Math.round(sum / channels);
  }
  return out;
}

/**
 * 线性插值重采样到 toRate。语音识别对这点失真不敏感;目的只是把 48 kHz 的
 * 桌面麦克风数据缩到 1/3,让 60 秒一句话的请求体从 5.8 MB 降到 1.9 MB。
 */
export function resampleInt16(input: Int16Array, fromRate: number, toRate: number = TARGET_SAMPLE_RATE): Int16Array {
  if (!(fromRate > 0) || !(toRate > 0) || fromRate === toRate || input.length === 0) return input;
  const outLen = Math.max(1, Math.floor(input.length * toRate / fromRate));
  const out = new Int16Array(outLen);
  const step = fromRate / toRate;
  for (let i = 0; i < outLen; i++) {
    const pos = i * step;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = Math.round(input[i0] * (1 - frac) + input[i1] * frac);
  }
  return out;
}

/** 16-bit PCM 单声道 → 完整 WAV 文件字节(RIFF/WAVE/fmt /data,小端)。 */
export function encodeWav(samples: Int16Array, sampleRate: number = TARGET_SAMPLE_RATE): Uint8Array {
  const dataBytes = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const ascii = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);          // fmt chunk size
  v.setUint16(20, 1, true);           // PCM
  v.setUint16(22, 1, true);           // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true);           // block align
  v.setUint16(34, 16, true);          // bits per sample
  ascii(36, 'data');
  v.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, samples[i], true);
  return new Uint8Array(buf);
}

/** 时长(秒)。 */
export function pcmSeconds(samples: number, sampleRate: number): number {
  return sampleRate > 0 ? samples / sampleRate : 0;
}

/** 一段 PCM 的音量,0..1(RMS 再开方拉开低音量段,画电平条用)。 */
export function levelOf(chunk: Int16Array | Float32Array): number {
  if (!chunk.length) return 0;
  const scale = chunk instanceof Int16Array ? 1 / 0x8000 : 1;
  let sum = 0;
  for (let i = 0; i < chunk.length; i++) { const s = chunk[i] * scale; sum += s * s; }
  const rms = Math.sqrt(sum / chunk.length);
  return Math.max(0, Math.min(1, Math.sqrt(rms) * 1.4));
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** 标准 base64(带 = 填充)。RN 没有 Buffer,btoa 只吃 latin1 字符串且对 MB 级输入很慢,自己编。 */
export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  let chunk = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    chunk += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
    if (chunk.length >= 8192) { parts.push(chunk); chunk = ''; }
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    chunk += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '==';
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    chunk += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
  }
  parts.push(chunk);
  return parts.join('');
}

/** PCM 分段(任意采样率/声道)→ 16 kHz 单声道 WAV。 */
export function pcmChunksToWav(chunks: readonly Int16Array[], sampleRate: number, channels = 1): { wav: Uint8Array; seconds: number } {
  const mono = downmixInt16(concatInt16(chunks), channels);
  const resampled = resampleInt16(mono, sampleRate, TARGET_SAMPLE_RATE);
  return { wav: encodeWav(resampled, TARGET_SAMPLE_RATE), seconds: pcmSeconds(resampled.length, TARGET_SAMPLE_RATE) };
}
