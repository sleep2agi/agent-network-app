/**
 * 流式 SHA-256(纯 JS,无依赖)。安卓应用内更新用它校验下载下来的 APK:
 * expo-file-system 只提供 md5,而镜像的 SHA256SUMS 和 GitHub 资产的 digest 都是 sha256。
 * 不引入 expo-crypto:那是一个新的原生模块,而且它的 digest 要求整个 77 MB 文件先进内存。
 * 这里按块喂(每块读一次文件),内存只占一块。
 * 正确性由 sha256.test.ts 对照 node:crypto 覆盖(含 55/56/63/64/65 字节等填充边界、跨块切分)。
 */

const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export class Sha256 {
  private h = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  private w = new Int32Array(64);
  private block = new Uint8Array(64);
  private blockLen = 0;
  private bytes = 0;
  private done = false;

  update(data: Uint8Array): this {
    if (this.done) throw new Error('sha256: update after digest');
    let i = 0;
    const n = data.length;
    this.bytes += n;
    if (this.blockLen > 0) {
      while (i < n && this.blockLen < 64) this.block[this.blockLen++] = data[i++];
      if (this.blockLen < 64) return this;
      this.compress(this.block, 0);
      this.blockLen = 0;
    }
    for (; i + 64 <= n; i += 64) this.compress(data, i);
    while (i < n) this.block[this.blockLen++] = data[i++];
    return this;
  }

  hex(): string {
    if (!this.done) {
      const bitsHi = Math.floor(this.bytes / 0x20000000);
      const bitsLo = (this.bytes * 8) >>> 0;
      this.block[this.blockLen++] = 0x80;
      if (this.blockLen > 56) {
        this.block.fill(0, this.blockLen);
        this.compress(this.block, 0);
        this.blockLen = 0;
      }
      this.block.fill(0, this.blockLen, 56);
      const b = this.block;
      b[56] = bitsHi >>> 24; b[57] = bitsHi >>> 16; b[58] = bitsHi >>> 8; b[59] = bitsHi;
      b[60] = bitsLo >>> 24; b[61] = bitsLo >>> 16; b[62] = bitsLo >>> 8; b[63] = bitsLo;
      this.compress(b, 0);
      this.done = true;
    }
    let out = '';
    for (let i = 0; i < 8; i++) out += (this.h[i] >>> 0).toString(16).padStart(8, '0');
    return out;
  }

  private compress(d: Uint8Array, o: number) {
    const w = this.w;
    for (let t = 0; t < 16; t++, o += 4) w[t] = (d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3];
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15], y = w[t - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    const h = this.h;
    let a = h[0], b = h[1], c = h[2], e = h[4], f = h[5], g = h[6], hh = h[7], dd = h[3];
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[t] + w[t]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (dd + t1) | 0; dd = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + dd) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

/** base64 → 字节(expo-file-system legacy 的 readAsStringAsync 分段读只给 base64)。非法字符直接抛。 */
export function base64ToBytes(b64: string): Uint8Array {
  const s = b64.replace(/[\r\n\s]/g, '');
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  if (s.length % 4 !== 0) throw new Error('base64: bad length');
  const out = new Uint8Array((s.length / 4) * 3 - pad);
  let o = 0;
  const idx = (i: number) => {
    const ch = s.charCodeAt(i);
    if (ch === 61 /* = */ && i >= s.length - pad) return 0;
    const x = ch < 128 ? B64_INDEX[ch] : -1;
    if (x < 0) throw new Error('base64: bad character');
    return x;
  };
  for (let i = 0; i < s.length; i += 4) {
    const n = (idx(i) << 18) | (idx(i + 1) << 12) | (idx(i + 2) << 6) | idx(i + 3);
    if (o < out.length) out[o++] = (n >>> 16) & 255;
    if (o < out.length) out[o++] = (n >>> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/**
 * 分块读 + 流式哈希。read(position, length) 返回那一段字节;每块之间让出一次事件循环,
 * 进度条和按钮在算的时候不会冻住。读到的比约定的少(文件被截断/读失败)→ 抛,不返回一个半截的摘要。
 */
export async function sha256Chunked(
  total: number,
  chunk: number,
  read: (position: number, length: number) => Promise<Uint8Array>,
  yieldFn: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 0)),
): Promise<string> {
  const h = new Sha256();
  for (let pos = 0; pos < total; ) {
    const length = Math.min(chunk, total - pos);
    const bytes = await read(pos, length);
    if (bytes.length !== length) throw new Error(`sha256: short read at ${pos} (${bytes.length}/${length})`);
    h.update(bytes);
    pos += length;
    await yieldFn();
  }
  return h.hex();
}
