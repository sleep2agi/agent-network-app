#!/usr/bin/env node
// Runs the stub-only browser drives (tests/drives.json, kind "stub") against a web export — one shard of them.
// CI: .github/workflows/drives.yml (8 shards in parallel). Locally:
//
//   npx expo export -p web --output-dir /tmp/web
//   PLAYWRIGHT_MODULE=<…/playwright/index.mjs> node scripts/run-drives.mjs --web /tmp/web --out /tmp/drives [--shard 1/8] [--only test-x]
//
// Why this exists (2026-10-02): ~80 drives lived in tests/ and no workflow ran any of them. A sweep that day found 14
// red on main — 12 stale tests, 1 real UI bug, 1 data gap — some red for days. A drive nobody runs rots.
//
// Shards are balanced by each drive's measured runtime (secs in the registry, greedy longest-first), so adding a
// drive moves at most one shard. Each drive gets its own output dir (log.txt + whatever it screenshots) and a
// timeout; the shard exits 1 if any drive fails, times out or cannot start. 0 drives selected = exit 1 (a shard
// that runs nothing must not read as green).
import { readFileSync, mkdirSync, writeFileSync, createWriteStream, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const web = arg('--web', process.env.WEB_DIR);
const out = resolve(arg('--out', 'drive-out'));
const [shard, shards] = (arg('--shard', '1/1')).split('/').map(Number);
const only = arg('--only', '');
const timeoutSecs = Number(arg('--timeout', '900'));
if (!web || !existsSync(join(web, 'index.html'))) { console.error(`✗ --web <expo web export dir> needed (got ${web ?? 'nothing'})`); process.exit(1); }
if (!(shard >= 1 && shard <= shards)) { console.error(`✗ bad --shard ${shard}/${shards}`); process.exit(1); }

const registry = JSON.parse(readFileSync(join(root, 'tests/drives.json'), 'utf8')).drives;
const stub = Object.entries(registry).filter(([, v]) => v.kind === 'stub').map(([path, v]) => ({ path, secs: v.secs ?? 60 }));

/** Greedy longest-first into the lightest shard: deterministic for a given registry. */
function assignShards(list, n) {
  const bins = Array.from({ length: n }, () => ({ load: 0, items: [] }));
  for (const d of [...list].sort((a, b) => b.secs - a.secs || a.path.localeCompare(b.path))) {
    const bin = bins.reduce((m, b) => (b.load < m.load ? b : m), bins[0]);
    bin.items.push(d); bin.load += d.secs;
  }
  return bins;
}

const picked = only ? stub.filter(d => d.path.startsWith(`${only}/`) || d.path === only) : assignShards(stub, shards)[shard - 1].items;
if (!picked.length) { console.error(`✗ shard ${shard}/${shards}${only ? ` --only ${only}` : ''}: no drives selected — refusing to pass`); process.exit(1); }
mkdirSync(out, { recursive: true });

const run = (d) => new Promise((done) => {
  const name = d.path.replace(/\//g, '__').replace(/\.mjs$/, '');
  const dir = join(out, name);
  mkdirSync(dir, { recursive: true });
  const log = createWriteStream(join(dir, 'log.txt'));
  const started = Date.now();
  const child = spawn(process.execPath, [join(root, 'tests', d.path)], {
    cwd: root,
    env: { ...process.env, WEB_DIR: resolve(web), OUT: dir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(log); child.stderr.pipe(log);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutSecs * 1000);
  child.on('close', (code) => {
    clearTimeout(timer);
    log.end();
    done({ path: d.path, ok: code === 0 && !timedOut, code: timedOut ? 'timeout' : code, secs: Math.round((Date.now() - started) / 1000), dir });
  });
  child.on('error', (e) => { clearTimeout(timer); log.end(String(e)); done({ path: d.path, ok: false, code: 'spawn', secs: 0, dir }); });
});

console.log(`shard ${shard}/${shards}: ${picked.length} drive(s) — ${picked.map(d => d.path).join(', ')}`);
const results = [];
for (const d of picked) {
  const r = await run(d);
  results.push(r);
  console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.path} (${r.code}, ${r.secs}s)`);
  if (!r.ok) {
    // The tail of a red drive's log, so the CI summary says why without downloading the artifact.
    const tail = readFileSync(join(r.dir, 'log.txt'), 'utf8').split('\n').filter(l => /FAIL|Error|"ok":false|✗/.test(l)).slice(0, 8);
    for (const l of tail) console.log(`    ${l.slice(0, 240)}`);
  }
}
const red = results.filter(r => !r.ok);
const md = [`### drives shard ${shard}/${shards}: ${results.length - red.length}/${results.length} green`, '', '| drive | result | secs |', '|---|---|---|',
  ...results.map(r => `| ${r.path} | ${r.ok ? 'pass' : `**FAIL** (${r.code})`} | ${r.secs} |`)].join('\n');
writeFileSync(join(out, `summary-${shard}.md`), `${md}\n`);
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`, { flag: 'a' });
console.log(`\n${results.length - red.length}/${results.length} drives green in shard ${shard}/${shards}`);
process.exit(red.length ? 1 : 0);
