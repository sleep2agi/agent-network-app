// Run every ck-style `*.test.ts` under src/ (each is a self-executing bun/node
// script that exits non-zero on failure) and aggregate. This is the missing
// gate 通信龙 flagged 08-01: the assertions existed but nothing ran them
// (no `test` script, CI had no test step). `npm test` / CI now runs this.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function findTests(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...findTests(p));
    else if (e.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

const runner = process.env.TEST_RUNNER || 'bun';
const root = process.env.TEST_DIR || 'src';

// 🔴 Fail closed on "found nothing to run" — `0/0 passed` and `8/8 passed` read as
// the SAME green (通信龙 08-01). A moved/renamed dir, a wrong suffix, or a file
// lost in a rebase would otherwise make CI report all-green at ZERO coverage —
// the exact failure this runner exists to prevent, one level up.
let files;
try {
  files = findTests(root).sort();
} catch (e) {
  console.error(`✗ cannot scan ${root}/ for tests (${e.code || e.message}) — refusing to pass`);
  process.exit(1);
}
if (files.length === 0) {
  console.error(`✗ no *.test.ts found under ${root}/ — scope regression (moved/renamed/lost in rebase?), refusing to pass`);
  process.exit(1);
}
let failed = 0;
for (const f of files) {
  console.log(`\n# ${f}`);
  const r = spawnSync(runner, [f], { stdio: 'inherit' });
  if (r.error || r.status !== 0) {
    failed++;
    if (r.error) console.error(`✗ could not start ${runner}: ${r.error.message}`);
  }
}
console.log(`\n=== ${files.length - failed}/${files.length} test files passed ===`);
process.exit(failed ? 1 : 0);
