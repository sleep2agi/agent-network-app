// ck-style (self-executing; run by scripts/run-tests.mjs). 语音输入:PCM → 16 kHz 单声道 WAV → base64。
import { bytesToBase64, concatInt16, downmixInt16, encodeWav, float32ToInt16, levelOf, pcmChunksToWav, resampleInt16, TARGET_SAMPLE_RATE } from './voice-wav';

let p = 0, t = 0;
const ck = (name: string, cond: boolean) => { t++; if (cond) { p++; console.log(`✅ ${name}`); } else console.log(`❌ ${name}`); };

// ── WAV 头 ──
{
  const wav = encodeWav(new Int16Array([0, 1, -1, 32767]), 16000);
  const v = new DataView(wav.buffer);
  const s = (o: number, n: number) => String.fromCharCode(...wav.slice(o, o + n));
  ck('WAV 以 RIFF/WAVE/fmt /data 组织', s(0, 4) === 'RIFF' && s(8, 4) === 'WAVE' && s(12, 4) === 'fmt ' && s(36, 4) === 'data');
  ck('RIFF 大小 = 36 + data', v.getUint32(4, true) === 36 + 8);
  ck('PCM、单声道、16 kHz、16 bit', v.getUint16(20, true) === 1 && v.getUint16(22, true) === 1 && v.getUint32(24, true) === 16000 && v.getUint16(34, true) === 16);
  ck('byte rate / block align', v.getUint32(28, true) === 32000 && v.getUint16(32, true) === 2);
  ck('data 长度与样本小端写入', v.getUint32(40, true) === 8 && v.getInt16(44 + 6, true) === 32767 && v.getInt16(44 + 4, true) === -1);
  ck('总长 44 + 2n', wav.length === 44 + 8);
}

// ── 数值转换 ──
{
  const i = float32ToInt16(new Float32Array([0, 1, -1, 2, -2, 0.5]));
  ck('float32 → int16:±1 映射到端点,越界截断', i[1] === 32767 && i[2] === -32768 && i[3] === 32767 && i[4] === -32768 && i[0] === 0);
  ck('float32 → int16:0.5 ≈ 16384', Math.abs(i[5] - 16384) <= 1);
  ck('concat 保序', concatInt16([new Int16Array([1, 2]), new Int16Array([3])]).join() === '1,2,3');
  ck('stereo downmix 取平均', downmixInt16(new Int16Array([10, 20, -10, 10]), 2).join() === '15,0');
  ck('mono downmix 原样', downmixInt16(new Int16Array([1, 2]), 1).join() === '1,2');
  const r = resampleInt16(new Int16Array(48000), 48000, 16000);
  ck('48 kHz 1 s → 16 kHz 16000 样本', r.length === 16000);
  const same = new Int16Array([1, 2, 3]);
  ck('同采样率不重采样', resampleInt16(same, 16000, 16000) === same);
  const ramp = resampleInt16(new Int16Array([0, 100, 200, 300]), 4, 2);
  ck('线性插值取对点', ramp.join() === '0,200');
}

// ── base64:与 Node Buffer 逐字节一致(含 0/1/2 余数) ──
{
  let all = true;
  for (const n of [0, 1, 2, 3, 4, 5, 100, 9001, 30000]) {
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) bytes[i] = (i * 37 + 11) & 255;
    if (bytesToBase64(bytes) !== Buffer.from(bytes).toString('base64')) all = false;
  }
  ck('bytesToBase64 与 Buffer 一致(各长度)', all);
}

// ── 端到端:48 kHz 双声道分段 → 16 kHz 单声道 WAV ──
{
  const chunk = new Int16Array(48000 * 2 / 4); // 0.25 s 双声道
  const { wav, seconds } = pcmChunksToWav([chunk, chunk, chunk, chunk], 48000, 2);
  const v = new DataView(wav.buffer);
  ck('分段合成 1 s', Math.abs(seconds - 1) < 0.01);
  ck('输出采样率为 16 kHz', v.getUint32(24, true) === TARGET_SAMPLE_RATE);
  ck('输出 data = 16000 × 2 字节', v.getUint32(40, true) === 32000);
}

// ── 电平 ──
{
  ck('静音电平 0', levelOf(new Int16Array(100)) === 0);
  ck('满幅电平封顶 1', levelOf(new Int16Array(100).fill(32767)) === 1);
  const mid = levelOf(new Float32Array(100).fill(0.05));
  ck('小声也有可见电平(0 < l < 1)', mid > 0.1 && mid < 1);
  ck('空分段电平 0', levelOf(new Int16Array(0)) === 0);
}

console.log(`voice wav: ${p}/${t} checks passed`);
process.exit(p === t ? 0 : 1);
