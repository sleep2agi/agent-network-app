// app#180 — the iOS icon must be an opaque, full-bleed 1024x1024 derived from the brand mark.
// Same discipline as icon-assets.test.ts for Android: re-run the recorded generator into a scratch
// directory and compare pixels with the committed file, so replacing assets/icon.png without
// regenerating fails here instead of shipping a stale (or framed) iOS icon.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): Buffer => fs.readFileSync(path.join(REPO, rel));
const sha256 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');
const sha256Text = (rel: string): string => sha256(Buffer.from(read(rel).toString('utf8').replace(/\r\n?/g, '\n'), 'utf8'));

const manifest = JSON.parse(read('assets/ios-icon-derivation.json').toString('utf8')) as {
  generator: string; generator_sha256: string; params: { canvas: number; zoom: number; contentAlpha: number; fill: number[] };
  source: string; source_sha256: string; derived: Record<string, string>;
};
const appJson = JSON.parse(read('app.json').toString('utf8')) as { expo: { icon: string; ios: { icon?: string } } };

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anet-ios-icon-'));
execFileSync('node', [path.join(REPO, manifest.generator), '--out', outDir], { cwd: REPO, stdio: 'pipe' });
const regenerated = fs.readFileSync(path.join(outDir, 'icon-ios.png'));
const committed = read('assets/icon-ios.png');
const decoded = PNG.sync.read(committed);
const raw = committed;
// PNG IHDR colour type byte: offset 25 (8 signature + 4 len + 4 'IHDR' + 4 w + 4 h + 1 depth) — 2 = RGB, 6 = RGBA.
const colourType = raw[25];
let opaque = true;
for (let i = 3; i < decoded.data.length; i += 4) if (decoded.data[i] !== 255) { opaque = false; break; }

const checks: Array<[string, boolean]> = [
  ['assets/icon-ios.png is what the generator produces from the current source',
    decoded.width === PNG.sync.read(regenerated).width && Buffer.compare(decoded.data, PNG.sync.read(regenerated).data) === 0],
  ['the recorded generator is the one in the repository', sha256Text(manifest.generator) === manifest.generator_sha256],
  ['the recorded source digest matches the source', sha256(read(manifest.source)) === manifest.source_sha256],
  ['assets/icon-ios.png matches its recorded digest', sha256(committed) === manifest.derived['assets/icon-ios.png']],
  ['1024x1024', decoded.width === 1024 && decoded.height === 1024],
  ['no alpha channel in the file (IHDR colour type 2 = RGB)', colourType === 2],
  ['every pixel opaque', opaque],
  ['zoom pushes the mark corners past Apple mask (zoom ≥ 1.06)', manifest.params.zoom >= 1.06],
  ['app.json ios.icon points at the derived file', appJson.expo.ios.icon === './assets/icon-ios.png'],
  ['app.json top-level icon stays the brand source (Android/desktop keep alpha)', appJson.expo.icon === './assets/icon.png'],
];
let failed = 0;
for (const [name, ok] of checks) { if (ok) console.log('✅', name); else { failed++; console.error('❌', name); } }
console.log(`ios icon assets: ${checks.length - failed}/${checks.length} checks passed`);
if (failed) process.exit(1);
