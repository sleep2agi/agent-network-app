// mobile-v0.2.32 shipped the previous cyan hub on Android while the desktop app
// and the website already carried the new mark. #50 replaced assets/icon.png,
// the favicon and the splash, and left the three Android adaptive layers alone —
// and nothing failed, because nothing tied the derived icons to their source.
//
// Recording digests would only catch a file being edited. It would not catch the
// actual mistake: replacing the brand mark and leaving the derived layers as
// they were, since those files are then untouched and their digests still match.
//
// So this re-runs the generator against the current source in a temporary
// directory and compares pixels with what is committed. Change the mark without
// regenerating and the regenerated layers no longer match the committed ones,
// which is precisely the failure that shipped.
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

const manifest = JSON.parse(read('assets/icon-derivation.json').toString('utf8')) as {
  generator: string;
  generator_sha256: string;
  params: Record<string, number>;
  background_color_rule: string;
  source: string;
  source_sha256: string;
  background_color: string;
  derived: Record<string, string>;
};

const appJson = JSON.parse(read('app.json').toString('utf8')) as {
  expo: {
    icon: string;
    android: {
      adaptiveIcon: {
        backgroundColor: string;
        foregroundImage: string;
        backgroundImage: string;
        monochromeImage: string;
      };
    };
  };
};

// Re-run the recorded generator into a scratch directory.
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anet-icons-'));
execFileSync('node', [path.join(REPO, manifest.generator), '--out', outDir], {
  cwd: REPO,
  stdio: 'pipe',
});

const derivedPaths = Object.keys(manifest.derived);

/** Compare decoded pixels, so a different PNG encoding is not read as a different icon. */
const pixelsMatch = (a: Buffer, b: Buffer): boolean => {
  const left = PNG.sync.read(a);
  const right = PNG.sync.read(b);
  if (left.width !== right.width || left.height !== right.height) return false;
  return Buffer.compare(left.data, right.data) === 0;
};

const regenerated = Object.fromEntries(
  derivedPaths.map((rel) => [rel, fs.readFileSync(path.join(outDir, path.basename(rel)))]),
);

const adaptive = appJson.expo.android.adaptiveIcon;
const covered = (p: string): boolean => derivedPaths.includes(p.replace(/^\.\//, ''));
const dimensionsOf = (buf: Buffer) => {
  const png = PNG.sync.read(buf);
  return { width: png.width, height: png.height };
};

const checks: Array<[string, boolean]> = [
  // The load-bearing pair: the generator still produces what is committed, from
  // the source as it stands right now.
  ...derivedPaths.map((rel): [string, boolean] => [
    `${rel} is what the generator produces from the current source`,
    pixelsMatch(read(rel), regenerated[rel]),
  ]),

  // The generator itself is pinned, so a silent change to the process is as
  // visible as a change to its output.
  ['the recorded generator is the one in the repository',
    sha256(read(manifest.generator)) === manifest.generator_sha256],
  ['the recorded source digest matches the source', sha256(read(manifest.source)) === manifest.source_sha256],
  ...derivedPaths.map((rel): [string, boolean] => [
    `${rel} matches its recorded digest`,
    sha256(read(rel)) === manifest.derived[rel],
  ]),

  // Parameters and the colour rule are recorded, not folded into prose.
  ['the canvas size is recorded', manifest.params.canvas === 1024],
  ['the safe-zone fraction is recorded',
    manifest.params.safeZoneFraction > 0 && manifest.params.safeZoneFraction <= 1],
  ['the luminance ramp is recorded', manifest.params.lumaLow < manifest.params.lumaHigh],
  ['the background colour rule is recorded, not just its result',
    /median/i.test(manifest.background_color_rule)],

  // app.json must point at the covered files, and agree on the colour.
  ['app.json icon is the brand source', appJson.expo.icon === `./${manifest.source}`],
  ['adaptive foreground is a covered asset', covered(adaptive.foregroundImage)],
  ['adaptive background is a covered asset', covered(adaptive.backgroundImage)],
  ['adaptive monochrome is a covered asset', covered(adaptive.monochromeImage)],
  ['adaptive backgroundColor matches the generated background',
    adaptive.backgroundColor.toLowerCase() === manifest.background_color.toLowerCase()],
  ['the background colour is a hex triplet', /^#[0-9a-f]{6}$/i.test(manifest.background_color)],

  // Geometry Android requires.
  ...derivedPaths.map((rel): [string, boolean] => {
    const { width, height } = dimensionsOf(read(rel));
    return [`${rel} is ${manifest.params.canvas}²`,
      width === manifest.params.canvas && height === manifest.params.canvas];
  }),

  // The foreground must stay a mark on transparency: Android composites it over
  // the background layer and animates them apart. The old file was 8 KB of flat
  // cyan, so a placeholder is separable by weight alone.
  ['the foreground is not a flat placeholder', read('assets/android-icon-foreground.png').length > 50_000],
];

fs.rmSync(outDir, { recursive: true, force: true });

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}
console.log(`icon assets: ${checks.length} checks passed`);
