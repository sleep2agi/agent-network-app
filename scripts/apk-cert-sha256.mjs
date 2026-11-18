#!/usr/bin/env node
// 只读解析 APK 的 v2/v3 签名块，输出**签名证书 DER 的 SHA-256**。
//
// 为什么需要：`apksigner verify --print-certs` 要 Java；CI 与运维机上不一定有。
// 这里按 AOSP v2 方案格式直接解析（纯 Node，无依赖）。
//
// 用途（#1446 后续）：
//   node scripts/apk-cert-sha256.mjs <apk>            # 打印 scheme / sha256 / DER 字节数
//   node scripts/apk-cert-sha256.mjs <apk> --expect - # 与 scripts/android-signing-cert.sha256 比对
// 判据：指纹必须等于仓库里的固定值；不等 ⇒ 退出码 1（换 key 会让老用户无法覆盖安装）。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const MAGIC = Buffer.from('APK Sig Block 42');
const V2_ID = 0x7109871a;
const V3_ID = 0xf05368c0;

function u32(buf, off) {
  if (off + 4 > buf.length) throw new Error('长度前缀越界');
  return buf.readUInt32LE(off);
}
function lenPrefixed(buf, off) {
  const n = u32(buf, off);
  const start = off + 4;
  const end = start + n;
  if (end > buf.length) throw new Error('长度前缀声明的长度越界');
  return [buf.subarray(start, end), end];
}
function v2Cert(block) {
  const [signers] = lenPrefixed(block, 0);
  const [signer] = lenPrefixed(signers, 0);
  const [signed] = lenPrefixed(signer, 0);
  const [, off] = lenPrefixed(signed, 0);
  const [certs] = lenPrefixed(signed, off);
  const [cert] = lenPrefixed(certs, 0);
  return cert;
}
function v3Cert(block) {
  const [signers] = lenPrefixed(block, 0);
  const [signer] = lenPrefixed(signers, 0);
  const [signed] = lenPrefixed(signer, 0);
  const [, o2] = lenPrefixed(signed, 0);
  const [certs] = lenPrefixed(signed, o2);
  const [cert] = lenPrefixed(certs, 0);
  return cert;
}

/** 从 APK 字节里找 End of Central Directory，返回 central directory 偏移。 */
function centralDirOffset(blob) {
  // EOCD 固定 22 字节 + 注释；从尾部往前找 PK\x05\x06。
  const sig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  for (let i = blob.length - 22; i >= Math.max(0, blob.length - 65558); i -= 1) {
    if (blob.subarray(i, i + 4).equals(sig)) {
      return blob.readUInt32LE(i + 16);
    }
  }
  throw new Error('找不到 EOCD（不是 zip/apk？）');
}

export function certSha256(blob) {
  const cd = centralDirOffset(blob);
  if (cd < 24) throw new Error('APK 太小');
  const tail = blob.subarray(cd - 24, cd);
  const sizeFooter = Number(tail.readBigUInt64LE(0));
  if (!tail.subarray(8, 24).equals(MAGIC)) throw new Error('找不到 APK Sig Block 42 魔数');
  const start = cd - sizeFooter - 8;
  if (start < 0) throw new Error('签名块起点越界');
  const block = blob.subarray(start, cd);
  if (!block.subarray(block.length - 16).equals(MAGIC)) throw new Error('签名块尾魔数不匹配');
  const body = block.subarray(8, block.length - 24);
  const pairs = new Map();
  let off = 0;
  while (off + 12 <= body.length) {
    const plen = Number(body.readBigUInt64LE(off));
    off += 8;
    const pid = u32(body, off);
    off += 4;
    pairs.set(pid, body.subarray(off, off + plen - 4));
    off += plen - 4;
  }
  for (const [sid, parser, name] of [[V2_ID, v2Cert, 'v2'], [V3_ID, v3Cert, 'v3']]) {
    if (pairs.has(sid)) {
      const cert = parser(pairs.get(sid));
      return { scheme: name, sha256: createHash('sha256').update(cert).digest('hex'), certLen: cert.length };
    }
  }
  throw new Error('没有 v2/v3 签名块');
}

function main() {
  const args = process.argv.slice(2);
  const apk = args.find((a) => !a.startsWith('--'));
  if (!apk) {
    console.error('用法: node scripts/apk-cert-sha256.mjs <apk> [--expect]');
    process.exit(2);
  }
  const wantExpect = args.includes('--expect');
  let res;
  try {
    res = certSha256(readFileSync(apk));
  } catch (e) {
    console.error(`FAIL ${apk}: ${e.message}`);
    process.exit(1);
  }
  console.log(`${res.scheme} cert sha256 = ${res.sha256}`);
  console.log(`cert bytes = ${res.certLen}`);
  if (!wantExpect) return 0;
  const here = dirname(fileURLToPath(import.meta.url));
  const pinPath = join(here, 'android-signing-cert.sha256');
  const pinned = readFileSync(pinPath, 'utf8')
    .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))[0] || '';
  if (!pinned) {
    console.error(`FAIL 固定的证书指纹文件为空: ${pinPath}`);
    return 1;
  }
  if (res.sha256 !== pinned) {
    console.error(`FAIL 证书指纹 ${res.sha256} != 固定值 ${pinned}（换 key 会让老用户无法覆盖安装）`);
    return 1;
  }
  console.log('PASS 证书指纹 == 固定值（升级路径不会被换 key 打断）');
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}
