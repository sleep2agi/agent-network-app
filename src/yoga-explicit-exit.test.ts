// 用 yoga-layout 的测试文件必须以显式 process.exit 结尾(2026-09-30)。ck 风格,自执行。
//
// 为什么:windows-latest 上 flex-zero-rule.test.ts 两次(run 36684786226、36686829934)打印完「14/14 passed」后
// bun 进程不退出,job 静默卡到 10 分钟超时。成因没能复现坐实,但两次都是「用了 yoga-layout(wasm)+ 成功时靠事件循环
// 自然退出」的文件;显式退出的 bubble-layout.test.ts 从没卡过。scripts/run-tests.mjs 的单文件超时兜底,这里防新增。
//
// 规则:导入 yoga-layout 的 *.test.ts,最后一行代码必须无条件调用 process.exit(不能是 `if (…) process.exit(1)`)。
// 两层分开自检:判据(给它一段源码,看它报不报)与取集(造一棵目录树,看该收的收进来了没有)。
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

let p = 0, n = 0;
const ck = (name: string, ok: boolean) => { n++; if (ok) { p++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}`); };

const here = import.meta.dir;
const USES_YOGA = /from\s+['"]yoga-layout(?:\/[^'"]*)?['"]|require\(\s*['"]yoga-layout/;
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, '')).replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/** 判据:用了 yoga 却没有以无条件 process.exit 结尾 → true。 */
export function missingExit(src: string): boolean {
  if (!USES_YOGA.test(src)) return false;
  const lines = stripComments(src.replace(/\r\n?/g, '\n')).split('\n').map(l => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1] ?? '';
  return !/process\.exit\(/.test(last) || /^(if|else)\b/.test(last);
}

/** 取集:目录下(递归)所有 *.test.ts / *.test.tsx,跳过 node_modules。 */
export function collect(root: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(root)) {
    const f = join(root, e);
    if (statSync(f).isDirectory()) { if (e !== 'node_modules') out.push(...collect(f)); }
    else if (/\.test\.tsx?$/.test(e)) out.push(f);
  }
  return out;
}

console.log('判据自检');
const Y = "import Yoga from 'yoga-layout';\n";
ck('flex-zero-rule 修前的结尾(成功时自然退出)→ 红', missingExit(Y + 'console.log(`${p}/${n} passed`);\nif (p !== n) process.exit(1);\n'));
ck('没有任何 exit → 红', missingExit(Y + "console.log('done');\n"));
ck('exit 不在最后一行 → 红', missingExit(Y + 'process.exit(0);\nconsole.log(1);\n'));
ck('无条件 process.exit 结尾 → 绿', !missingExit(Y + 'console.log(1);\nprocess.exit(p === n ? 0 : 1);\n'));
ck('同一行 console.log(…); process.exit(…)(bubble-layout 的写法)→ 绿', !missingExit(Y + 'console.log(`${p}/${t} passed`); process.exit(p === t ? 0 : 1);'));
ck('结尾注释 / 空行 / CRLF 不影响', !missingExit(Y + 'process.exit(0);\r\n// trailing\r\n\r\n'));
ck('具名导入与 require 也认', missingExit("import { Align } from 'yoga-layout';\nx();\n") && missingExit("const Y = require('yoga-layout');\nx();\n"));
ck('不用 yoga 的文件不管', !missingExit("console.log(1);\nif (p !== n) process.exit(1);\n"));

console.log('取集自检');
{
  const tmp = mkdtempSync(join(tmpdir(), 'yoga-explicit-exit-'));
  try {
    mkdirSync(join(tmp, 'deep', 'er'), { recursive: true });
    mkdirSync(join(tmp, 'node_modules'));
    for (const f of ['a.test.ts', 'b.test.tsx', 'deep/er/c.test.ts', 'd.ts', 'node_modules/e.test.ts']) writeFileSync(join(tmp, f), '');
    const got = collect(tmp).map(f => relative(tmp, f).replace(/\\/g, '/')).sort();  // Windows: \ → /
    ck(`递归收进子目录的 .test.ts / .test.tsx,跳过非测试与 node_modules(收到 ${got.join(', ')})`, JSON.stringify(got) === JSON.stringify(['a.test.ts', 'b.test.tsx', 'deep/er/c.test.ts']));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

console.log('src/');
const files = collect(here);
const yoga = files.filter(f => USES_YOGA.test(readFileSync(f, 'utf8')));
ck(`取集收到了真实的 yoga 测试(${yoga.length} 个,含 flex-zero-rule 和 bubble-layout)`, yoga.some(f => /[\\/]flex-zero-rule\.test\.ts$/.test(f)) && yoga.some(f => /[\\/]bubble-layout\.test\.ts$/.test(f)));
const bad = yoga.filter(f => missingExit(readFileSync(f, 'utf8'))).map(f => relative(here, f));
ck(`用 yoga-layout 的测试都以无条件 process.exit 结尾${bad.length ? ` —— ${bad.join(', ')}(末行改成 process.exit(p === n ? 0 : 1))` : ''}`, bad.length === 0);

console.log(`\n${p}/${n} passed`);
process.exit(p === n ? 0 : 1);
