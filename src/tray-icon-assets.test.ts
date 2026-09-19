// 0.2.76 shipped a menu-bar icon cut from the full product icon, plate and all.
// A macOS template image is painted from its ALPHA alone, so the plate became a
// solid white slab: Vincent's menu bar showed a grey block where every other app
// showed a glyph, and he reported the icon as missing (task b6f15da2). Nothing
// failed at build time, because nothing tied the tray assets to the brand mark
// or said what a template image may contain.
//
// So this does two things a digest alone cannot. It re-runs the generator
// against the current source and compares pixels, which catches a brand change
// that skips regeneration. And it asserts the shape a template image must have —
// pure black, partly transparent, coverage in the range a glyph occupies — which
// is what actually shipped wrong: the old file passed every digest it had.
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

/** Digest of a text file with newlines normalised, so a Windows checkout agrees. */
const sha256Text = (rel: string): string =>
  sha256(Buffer.from(read(rel).toString('utf8').replace(/\r\n?/g, '\n'), 'utf8'));

const manifest = JSON.parse(read('src-tauri/tray/tray-derivation.json').toString('utf8')) as {
  generator: string;
  generator_sha256: string;
  params: { height: number; height2x: number; glyphFraction: number; trimAlphaFloor: number };
  source: string;
  source_sha256: string;
  geometry_rule: string;
  platform_note: string;
  derived: Record<string, string>;
};

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anet-tray-'));
execFileSync('node', [path.join(REPO, manifest.generator), '--out', outDir], {
  cwd: REPO,
  stdio: 'pipe',
});

const derivedPaths = Object.keys(manifest.derived);
const regenerated = Object.fromEntries(
  derivedPaths.map((rel) => [rel, fs.readFileSync(path.join(outDir, path.basename(rel)))]),
);

/** Compare decoded pixels, so a different PNG encoding is not read as a different icon. */
const pixelsMatch = (a: Buffer, b: Buffer): boolean => {
  const left = PNG.sync.read(a);
  const right = PNG.sync.read(b);
  if (left.width !== right.width || left.height !== right.height) return false;
  return Buffer.compare(left.data, right.data) === 0;
};

interface Shape {
  width: number;
  height: number;
  /** Fraction of pixels with any alpha at all. */
  coverage: number;
  /** True when every pixel with alpha has RGB 0,0,0. */
  allBlack: boolean;
  /** True when at least one pixel is fully transparent. */
  hasTransparency: boolean;
}

const shapeOf = (buf: Buffer): Shape => {
  const png = PNG.sync.read(buf);
  let opaque = 0;
  let allBlack = true;
  let transparent = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const alpha = png.data[i + 3];
    if (alpha === 0) {
      transparent += 1;
      continue;
    }
    opaque += 1;
    if (png.data[i] !== 0 || png.data[i + 1] !== 0 || png.data[i + 2] !== 0) allBlack = false;
  }
  const total = png.width * png.height;
  return {
    width: png.width,
    height: png.height,
    coverage: opaque / total,
    allBlack,
    hasTransparency: transparent > 0,
  };
};

const shapes = Object.fromEntries(derivedPaths.map((rel) => [rel, shapeOf(read(rel))]));

/**
 * A plate fills its canvas; a glyph does not. The file that shipped in 0.2.76
 * covered 82% of its canvas — that is what a rounded-square plate looks like
 * from the alpha channel's point of view. The mark covers roughly 40%. The
 * ceiling is the load-bearing half of this pair: raise it past ~0.6 and the
 * defect this test exists for walks straight back in.
 */
const GLYPH_COVERAGE_CEILING = 0.6;
const GLYPH_COVERAGE_FLOOR = 0.15;

const trayRs = read('src-tauri/src/tray.rs').toString('utf8').replace(/\r\n?/g, '\n');

const checks: Array<[string, boolean]> = [
  // The load-bearing pair: the generator still produces what is committed, from
  // the source as it stands right now.
  ...derivedPaths.map((rel): [string, boolean] => [
    `${rel} is what the generator produces from the current source`,
    pixelsMatch(read(rel), regenerated[rel]),
  ]),

  ['the recorded generator is the one in the repository',
    sha256Text(manifest.generator) === manifest.generator_sha256],
  ['the recorded source digest matches the source', sha256(read(manifest.source)) === manifest.source_sha256],
  ...derivedPaths.map((rel): [string, boolean] => [
    `${rel} matches its recorded digest`,
    sha256(read(rel)) === manifest.derived[rel],
  ]),

  // The template contract. Each of these was false for the file that shipped,
  // or is what keeps it from coming back.
  ...derivedPaths.map((rel): [string, boolean] => [
    `${rel} carries no colour — a template image is painted from alpha`,
    shapes[rel].allBlack,
  ]),
  ...derivedPaths.map((rel): [string, boolean] => [
    `${rel} is not a solid fill`,
    shapes[rel].hasTransparency,
  ]),
  ...derivedPaths.map((rel): [string, boolean] => [
    `${rel} covers a glyph's worth of canvas, not a plate's (${(shapes[rel].coverage * 100).toFixed(1)}%)`,
    shapes[rel].coverage > GLYPH_COVERAGE_FLOOR && shapes[rel].coverage < GLYPH_COVERAGE_CEILING,
  ]),

  // Geometry: height is the budget, width follows the mark's aspect, and @2x is
  // exactly twice 1x so the pair cannot drift apart.
  ['1x is the recorded height', shapes['src-tauri/tray/trayTemplate.png'].height === manifest.params.height],
  ['2x is the recorded height', shapes['src-tauri/tray/trayTemplate@2x.png'].height === manifest.params.height2x],
  ['2x is twice 1x in height', manifest.params.height2x === manifest.params.height * 2],
  ['both variants share one aspect ratio',
    Math.abs(
      shapes['src-tauri/tray/trayTemplate.png'].width / shapes['src-tauri/tray/trayTemplate.png'].height
      - shapes['src-tauri/tray/trayTemplate@2x.png'].width / shapes['src-tauri/tray/trayTemplate@2x.png'].height,
    ) < 0.02],
  ['the canvas is not forced square — width follows the mark',
    shapes['src-tauri/tray/trayTemplate@2x.png'].width !== shapes['src-tauri/tray/trayTemplate@2x.png'].height],
  ['the geometry rule is recorded, not just its result', /height/i.test(manifest.geometry_rule)],
  ['the glyph fraction is recorded',
    manifest.params.glyphFraction > 0 && manifest.params.glyphFraction <= 1],

  // The Rust side: the flag is what makes macOS treat the alpha as a template,
  // and the @2x file is what keeps it sharp on a Retina bar.
  ['tray.rs marks the macOS icon as a template', /\.icon_as_template\(true\)/.test(trayRs)],
  ['tray.rs embeds the @2x template on macOS',
    /include_image!\("\.\/tray\/trayTemplate@2x\.png"\)/.test(trayRs)],

  // Windows must keep a colour icon: a template there renders as a black smear.
  ['tray.rs keeps a separate non-macOS icon', /include_image!\("\.\/tray\/tray\.png"\)/.test(trayRs)],
  ['the Windows icon is not covered by the template manifest',
    !derivedPaths.includes('src-tauri/tray/tray.png')],
  ['the Windows icon still carries colour', !shapeOf(read('src-tauri/tray/tray.png')).allBlack],
  ['the platform note says why Windows is excluded', /windows/i.test(manifest.platform_note)],
];

fs.rmSync(outDir, { recursive: true, force: true });

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}
console.log(`tray icon assets: ${checks.length} checks passed`);
