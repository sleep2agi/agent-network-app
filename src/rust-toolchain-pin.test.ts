// 0.2.529（2026-11-13）：Windows runner 的 stable 从 rustc 1.99.1 升到 1.100.0，cargo 新 build-dir 布局
// 把 OUT_DIR 加深一层（target/release/build/<pkg>/<hash>/out），tauri-build 2.6.3 按固定层数回溯，
// 把 externalBin（commhub.exe）拷进 target/release/build/ 而不是 target/release/，packaged smoke 两次红。
// 守护：所有跑 tauri / cargo 的 workflow 都钉同一个 toolchain，不能回到浮动的 stable。
//   run: bun src/rust-toolchain-pin.test.ts
import { readFileSync } from 'node:fs';

const PIN = "'1.99.1'";
const files = ['release-desktop-auto-update', 'release-macos', 'desktop-tauri', 'wix-install-identity', 'rust-check'];
let passed = 0;
let total = 0;
const ck = (name: string, condition: boolean) => { total++; if (condition) passed++; else console.log('❌', name); };
for (const f of files) {
  const src = readFileSync(new URL(`../.github/workflows/${f}.yml`, import.meta.url), 'utf8');
  const uses = src.split('\n').filter(line => line.includes('dtolnay/rust-toolchain@')).length;
  const pins = src.split('\n').filter(line => line.trim() === `toolchain: ${PIN}`).length;
  ck(`${f}: every rust-toolchain step pins ${PIN} (${pins}/${uses})`, uses > 0 && pins === uses);
  ck(`${f}: no floating toolchain: stable`, !/^\s*toolchain:\s*stable\s*$/m.test(src));
}
console.log(`rust-toolchain-pin: ${passed}/${total}`);
process.exit(passed === total ? 0 : 1);
