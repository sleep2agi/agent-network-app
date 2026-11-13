// 0.2.529（2026-11-13）：Windows runner 的 stable 从 rustc 1.99.1 升到 1.100.0，cargo 新 build-dir 布局
// 把 OUT_DIR 加深一层（target/release/build/<pkg>/<hash>/out），tauri-build 2.6.3 按固定层数回溯，
// 把 externalBin（commhub.exe）拷进 target/release/build/ 而不是 target/release/，packaged smoke 两次红。
// 守护：.github/workflows 里**每一个** dtolnay/rust-toolchain 步骤都钉 PIN；例外只能写进 EXCEPTIONS 并给理由。
// 遍历目录而不是写死文件名（通信欧 #1429 审阅：分母写死，新 workflow 不会被检查）。
//   run: bun src/rust-toolchain-pin.test.ts
import { readdirSync, readFileSync } from 'node:fs';

const PIN = '1.99.1';
/** 文件名 → 允许的 toolchain 与理由。 */
const EXCEPTIONS: Record<string, { toolchain: string; why: string }> = {
  'local-daemon-init.yml': { toolchain: '1.90.0', why: '只跑 local daemon 初始化的 Rust 单测，不产包；早于本次固定已钉 1.90.0' },
};

const dir = new URL('../.github/workflows/', import.meta.url);
let passed = 0;
let total = 0;
const ck = (name: string, condition: boolean) => { total++; if (condition) passed++; else console.log('❌', name); };
let filesWithRust = 0;
for (const file of readdirSync(dir).filter(name => /\.ya?ml$/.test(name)).sort()) {
  const lines = readFileSync(new URL(file, dir), 'utf8').split('\n');
  const want = EXCEPTIONS[file]?.toolchain ?? PIN;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes('dtolnay/rust-toolchain@')) continue;
    // 该步骤的 with: 块在下一行起、缩进更深的若干行里。
    const indent = lines[i].search(/\S/);
    const block: string[] = [];
    for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || lines[j].search(/\S/) > indent); j++) block.push(lines[j]);
    const pinned = block.some(line => line.trim().replace(/["']/g, '') === `toolchain: ${want}`);
    ck(`${file}:${i + 1} rust-toolchain step pins ${want}`, pinned);
    filesWithRust += 1;
  }
}
ck('found the rust-toolchain steps (sanity: not an empty scan)', filesWithRust >= 8);
for (const file of Object.keys(EXCEPTIONS)) {
  ck(`exception ${file} still exists and still uses rust-toolchain`, (() => {
    try { return readFileSync(new URL(file, dir), 'utf8').includes('dtolnay/rust-toolchain@'); } catch { return false; }
  })());
}
console.log(`rust-toolchain-pin: ${passed}/${total}`);
process.exit(passed === total ? 0 : 1);
