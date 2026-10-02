// Every browser drive is registered — CI runs it, or the registry says why not. ck style, self-executing.
//
// 2026-10-02: ~80 tests/*/drive.mjs + run.mjs, and no workflow ran any of them; a sweep found 14 red on main, some for
// days. .github/workflows/drives.yml now runs the "stub" ones (8 shards) and the "docker" ones (nightly), both read
// from tests/drives.json. This test makes adding a drive force the question: which bucket? "not in CI" is allowed —
// with a reason — but a drive that is in no bucket is red here.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

let p = 0, n = 0;
const ck = (name: string, ok: boolean, extra = '') => { n++; if (ok) { p++; console.log(`  ✓ ${name}`); } else console.log(`  ✗ ${name}${extra ? ` (${extra})` : ''}`); };
const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n?/g, '\n');

type Entry = { kind: 'stub' | 'docker' | 'hub' | 'manual'; secs?: number; image?: string; why?: string };
const registry: Record<string, Entry> = JSON.parse(read('tests/drives.json')).drives;

// 取集: every tests/<dir>/drive.mjs and tests/<dir>/run.mjs on disk (one level, the layout the repo uses).
const onDisk: string[] = [];
for (const dir of readdirSync(join(ROOT, 'tests'))) {
  if (!statSync(join(ROOT, 'tests', dir)).isDirectory()) continue;
  for (const f of ['drive.mjs', 'run.mjs']) if (existsSync(join(ROOT, 'tests', dir, f))) onDisk.push(`${dir}/${f}`);
}
ck(`取集: found the drives on disk (${onDisk.length}, incl. test-layout-sweep/run.mjs)`, onDisk.length >= 70 && onDisk.includes('test-layout-sweep/run.mjs'));

const missing = onDisk.filter(d => !registry[d]);
ck('every drive on disk is in tests/drives.json', missing.length === 0, missing.join(', '));
const gone = Object.keys(registry).filter(d => !onDisk.includes(d));
ck('every registry entry still exists', gone.length === 0, gone.join(', '));
const badKind = Object.entries(registry).filter(([, v]) => !['stub', 'docker', 'hub', 'manual'].includes(v.kind)).map(([k]) => k);
ck('kinds are stub / docker / hub / manual', badKind.length === 0, badKind.join(', '));
const noWhy = Object.entries(registry).filter(([, v]) => (v.kind === 'hub' || v.kind === 'manual') && !(v.why && v.why.length >= 20)).map(([k]) => k);
ck('not-in-CI drives (hub / manual) say why', noWhy.length === 0, noWhy.join(', '));
const noSecs = Object.entries(registry).filter(([, v]) => v.kind === 'stub' && !(typeof v.secs === 'number' && v.secs > 0)).map(([k]) => k);
ck('stub drives carry a runtime (secs) for shard balancing', noSecs.length === 0, noSecs.join(', '));

// The registry is what CI reads: the docker matrix must list exactly the docker entries, each with its image dir.
const wf = read('.github/workflows/drives.yml');
const dockerEntries = Object.entries(registry).filter(([, v]) => v.kind === 'docker');
const matrix = [...wf.matchAll(/\{ suite: ([\w-]+), image: ([\w-]+) \}/g)].map(m => `${m[1]}=${m[2]}`).sort();
const expected = dockerEntries.map(([k, v]) => `${k.split('/')[0]}=${v.image}`).sort();
ck('docker matrix in drives.yml == docker entries in the registry', JSON.stringify(matrix) === JSON.stringify(expected), `${matrix.join(',')} vs ${expected.join(',')}`);
ck('docker images exist (tests/<image>/Dockerfile)', dockerEntries.every(([, v]) => !!v.image && existsSync(join(ROOT, 'tests', v.image, 'Dockerfile'))));
ck('stub shards run through scripts/run-drives.mjs, which reads the registry', /node scripts\/run-drives\.mjs --web web-export --out drive-out --shard \$\{\{ matrix\.shard \}\}\/8/.test(wf) && /shard: \[1, 2, 3, 4, 5, 6, 7, 8\]/.test(wf) && read('scripts/run-drives.mjs').includes("v.kind === 'stub'"));
ck('drives.yml: on demand, nightly, and on PRs that touch app code', /workflow_dispatch:/.test(wf) && /schedule:\n\s+- cron:/.test(wf) && /pull_request:\n\s+paths:[\s\S]*?- 'src\/\*\*'/.test(wf));
ck('a shard that selects nothing fails (no green from an empty shard)', /no drives selected — refusing to pass/.test(read('scripts/run-drives.mjs')));

// Stub = only the export + Chromium. A drive that reads a hub address / seed / bundle env var is not a stub.
const notStub = Object.entries(registry).filter(([k, v]) => v.kind === 'stub' && /process\.env\.(HUB_URL|HUB_TOKEN|HUB_JSON|SEED|BUNDLE|LOCAL_HUB_BINARY)\b/.test(read(`tests/${k}`))).map(([k]) => k);
ck('no "stub" drive needs a hub / seed / bundle', notStub.length === 0, notStub.join(', '));

const counts = Object.values(registry).reduce<Record<string, number>>((m, v) => ({ ...m, [v.kind]: (m[v.kind] ?? 0) + 1 }), {});
console.log(`\nregistry: ${JSON.stringify(counts)}`);
console.log(`${p}/${n} passed`);
if (p !== n) process.exit(1);
