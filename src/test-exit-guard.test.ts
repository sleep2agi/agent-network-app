// 守卫：凡是用 `ck(...)` 计数风格的测试文件，必须能让「失败」变成非零退出。
//
// 背景（2026-11-16）：#4863 的三个新测试文件只 `console.log` 了 `p/t`，**没有 process.exit**，
// 断言失败时进程仍然退 0 ⇒ CI 绿、缺陷放行。ANet负责人 review 时抓到的。
// 靠人记不住，所以这里做静态扫描：任何 `src/**/*.test.ts` 只要出现 `ck(`，
// 就必须至少满足其中一条：
//   1. 直接 `process.exit(...)` 或设置 `process.exitCode`
//   2. `ck` 内部会 `throw`（断言失败即抛）
//   3. `ck` 内部用 `assert`（assert 会抛）
//   4. 用 `makeCk()` 的 `done()`（它内部按 p===t 退出）
// 否则本文件报错。
//
// 说明：这是**文本规则**，允许误报时显式加白名单（见 ALLOW），但白名单必须写原因。
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'src';
const ALLOW: Record<string, string> = {
  // 例：'src/foo.test.ts': '断言全在 ck 里 throw，已在 2026-xx-xx 人工确认',
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile() && e.name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const bad: string[] = [];
for (const f of files) {
  if (ALLOW[f]) continue;
  const src = readFileSync(f, 'utf8');
  if (!/\bck\s*\(/.test(src)) continue;
  const safe =
    /process\.exit\s*\(/.test(src) ||
    /process\.exitCode\s*=/.test(src) ||
    /\bthrow\b/.test(src) ||
    /\bassert\b/.test(src) ||
    /makeCk\s*\(/.test(src);
  if (!safe) bad.push(f);
}

let p = 0;
let t = 0;
const ck = (name: string, ok: boolean) => {
  t += 1;
  if (ok) p += 1;
  console.log(`${ok ? '✓' : '✗'} ${name}`);
};

ck('扫描到 src/**/*.test.ts', files.length > 100);
ck('不存在「ck 风格却没有非零退出」的测试文件', bad.length === 0);
for (const f of bad) console.log(`  ✗ ${f}：有 ck( 但既无 process.exit / exitCode，也无 throw / assert / makeCk`);
ck('白名单每一条都写了原因', Object.values(ALLOW).every(v => v.trim().length > 0));

console.log(`\n${p}/${t} passed`);
if (bad.length) console.log(`修正方式：在该文件末尾加 process.exit(p === t ? 0 : 1);（变量名按文件实际来）`);
process.exit(p === t ? 0 : 1);
