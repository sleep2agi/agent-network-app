// Run every ck-style `*.test.ts` under src/ (each is a self-executing bun/node
// script that exits non-zero on failure) and aggregate. This is the missing
// gate 通信龙 flagged 08-01: the assertions existed but nothing ran them
// (no `test` script, CI had no test step). `npm test` / CI now runs this.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

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
// 🔴 Per-file timeout (2026-09-30): on windows-latest a file printed `14/14 passed` and then its
// process never exited — the job sat silent for 9 minutes until the 10-minute job timeout cancelled
// it, with no line saying which file was stuck. A hung file now fails loudly by name after this
// budget. The slowest file on Windows CI takes ~25s (notifier-runtime-status-e2e); override with
// TEST_FILE_TIMEOUT_MS.
const perFileTimeoutMs = Number(process.env.TEST_FILE_TIMEOUT_MS) || 120_000;
// 🔴 Exit grace (2026-09-30, PR #594 run 36693206785): the same file hung again even though it now
// ends with an explicit `process.exit(…)` — bun on Windows can stall *inside* exit after it has
// printed its result. So once a file's last output line is its `N/M passed` summary and it has gone
// quiet for this long, it is killed and the printed result is used (logged as EXIT-HANG). A file
// that never printed a summary still fails as TIMEOUT at perFileTimeoutMs.
const exitGraceMs = Number(process.env.TEST_EXIT_GRACE_MS) || 10_000;
const SUMMARY = /(\d+)\s*\/\s*(\d+)\s+(?:checks?\s+)?passed\b/;

// Evidence for the exit hang, taken just before the kill: two samples 2s apart of the stuck
// process's CPU time and thread count. CPU climbing = spinning in exit; flat = blocked/deadlocked.
function snapshot(pid) {
  if (process.platform !== 'win32' || !pid) return;
  const ps = `1..2 | % { $p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { "  pid=$($p.Id) cpu=$([math]::Round($p.CPU,2))s threads=$($p.Threads.Count) handles=$($p.HandleCount) ws=$([math]::Round($p.WorkingSet64/1MB))MB" } else { '  (process gone)' }; Start-Sleep -Seconds 2 }`;
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', timeout: 15_000 });
  console.error(`  exit-hang snapshot:\n${(r.stdout || r.error?.message || '').trimEnd()}`);
}

function runFile(f) {
  return new Promise(resolve => {
    const child = spawn(runner, [f], { stdio: ['ignore', 'pipe', 'pipe'] });
    let lastLine = '', partial = '', grace = null, outcome = null;
    const finish = result => { if (outcome) return; outcome = result; clearTimeout(hard); clearTimeout(grace); if (result.kill) child.kill('SIGKILL'); };
    const hard = setTimeout(() => finish({ kind: 'timeout', kill: true }), perFileTimeoutMs);
    const onData = (stream, chunk) => {
      stream.write(chunk);
      const lines = (partial + chunk.toString('utf8')).split(/\r?\n/);
      partial = lines.pop();
      const done = lines.map(l => l.trim()).filter(Boolean);
      if (done.length) lastLine = done[done.length - 1];
      if (partial.trim()) lastLine = partial.trim();
      clearTimeout(grace);
      const m = lastLine.match(SUMMARY);
      if (m) grace = setTimeout(() => { snapshot(child.pid); finish({ kind: 'exit-hang', ok: m[1] === m[2], line: lastLine, kill: true }); }, exitGraceMs);
    };
    child.stdout.on('data', c => onData(process.stdout, c));
    child.stderr.on('data', c => onData(process.stderr, c));
    child.on('error', error => finish({ kind: 'error', error }));
    child.on('exit', code => finish({ kind: 'exit', code }));
    // resolve once the process is really gone (or was killed), so files never overlap
    child.on('close', () => resolve(outcome ?? { kind: 'exit', code: child.exitCode }));
    child.on('error', () => resolve(outcome));
  });
}

const failedFiles = [];
const exitHangs = [];
for (const f of files) {
  console.log(`\n# START ${f}`);
  const t0 = Date.now();
  const r = await runFile(f);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (r.kind === 'timeout') {
    failedFiles.push(f);
    console.error(`✗ TIMEOUT ${f}: still running after ${secs}s (limit ${perFileTimeoutMs / 1000}s) and its last output line is not an N/M passed summary — killed.`);
  } else if (r.kind === 'exit-hang') {
    exitHangs.push(f);
    if (!r.ok) failedFiles.push(f);
    console.error(`⚠ EXIT-HANG ${f}: printed "${r.line}" but did not exit within ${exitGraceMs / 1000}s — killed, using the printed result (${r.ok ? 'pass' : 'FAIL'}).`);
  } else if (r.kind === 'error') {
    failedFiles.push(f);
    console.error(`✗ could not start ${runner}: ${r.error.message}`);
  } else if (r.code !== 0) {
    failedFiles.push(f);
  }
}
console.log(`\n=== ${files.length - failedFiles.length}/${files.length} test files passed ===`);
for (const f of failedFiles) console.log(`  ✗ ${f}`);
if (exitHangs.length) console.log(`  ⚠ ${exitHangs.length} file(s) printed a result but hung on exit and were killed: ${exitHangs.join(', ')}`);
process.exit(failedFiles.length ? 1 : 0);
