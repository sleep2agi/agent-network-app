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
const files = findTests('src').sort();
let failed = 0;
for (const f of files) {
  console.log(`\n# ${f}`);
  const r = spawnSync(runner, [f], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(`\n=== ${files.length - failed}/${files.length} test files passed ===`);
process.exit(failed ? 1 : 0);
