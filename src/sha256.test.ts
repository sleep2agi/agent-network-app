// 纯 JS SHA-256(安卓更新校验 APK 的兜底路径)对照 node:crypto;base64 分段解码对照 Buffer。
import { createHash } from 'node:crypto';
import { Sha256, base64ToBytes, sha256Chunked } from './sha256';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) { p++; console.log(`PASS: ${name}`); } else console.log(`FAIL: ${name}`); };
const oracle = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const bytes = (n: number, seed = 7) => { const b = new Uint8Array(n); let x = seed; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; b[i] = x >>> 24; } return b; };

ck('empty input = e3b0c442…', new Sha256().hex() === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
ck('"abc" (FIPS 180-2 vector)', new Sha256().update(new TextEncoder().encode('abc')).hex() === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
// 填充边界:55 字节一块放得下长度,56 要多一块;63/64/65 跨块
const edges = [1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 4097];
ck(`padding edges ${edges.join('/')} match node:crypto`, edges.every(n => { const b = bytes(n, n); return new Sha256().update(b).hex() === oracle(b); }));
{
  const b = bytes(300_001);
  const splits = [1, 3, 63, 64, 65, 4096, 99_999];
  ck('same digest however the input is split into update() calls', splits.every(step => {
    const h = new Sha256();
    for (let o = 0; o < b.length; o += step) h.update(b.subarray(o, Math.min(b.length, o + step)));
    return h.hex() === oracle(b);
  }));
}
{
  const h = new Sha256().update(bytes(10));
  const a = h.hex();
  ck('hex() is idempotent', h.hex() === a);
  let threw = false; try { h.update(bytes(1)); } catch { threw = true; }
  ck('update after digest throws (no silently wrong digest)', threw);
}
{
  const b = bytes(5_000_000, 3);
  ck('5 MB matches node:crypto', new Sha256().update(b).hex() === oracle(b));
}

// base64 (legacy readAsStringAsync 分段读的解码)
const b64Cases = [0, 1, 2, 3, 4, 5, 767, 768, 769].map(n => bytes(n, n + 1));
ck('base64ToBytes round-trips every padding shape', b64Cases.every(b => Buffer.from(base64ToBytes(Buffer.from(b).toString('base64'))).equals(Buffer.from(b))));
{ let threw = false; try { base64ToBytes('ab$d'); } catch { threw = true; } ck('base64 rejects bad characters', threw); }
{ let threw = false; try { base64ToBytes('abc'); } catch { threw = true; } ck('base64 rejects bad length', threw); }

// chunked
{
  const file = bytes(1_000_003, 9);
  const reads: number[] = [];
  const hex = await sha256Chunked(file.length, 3 * 1024, async (pos, len) => { reads.push(pos); return file.subarray(pos, pos + len); }, async () => {});
  ck('sha256Chunked matches node:crypto (last chunk short)', hex === oracle(file));
  ck('sha256Chunked reads every chunk once, in order', reads.length === Math.ceil(file.length / 3072) && reads.every((r, i) => r === i * 3072));
  let threw = false;
  try { await sha256Chunked(file.length, 4096, async (pos, len) => file.subarray(pos, pos + Math.max(0, len - 1)), async () => {}); } catch { threw = true; }
  ck('short read throws instead of hashing a truncated file', threw);
  // base64 分段 + 解码 = 原文件
  const hex64 = await sha256Chunked(file.length, 3 * 1024, async (pos, len) => base64ToBytes(Buffer.from(file.subarray(pos, pos + len)).toString('base64')), async () => {});
  ck('base64-per-chunk path hashes the same as the raw bytes', hex64 === oracle(file));
}

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
