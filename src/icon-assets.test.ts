// mobile-v0.2.32 shipped the previous cyan hub mark on Android while the
// desktop app and the website already carried the new one. PR #50 updated
// assets/icon.png, the favicon and the splash, and left the three Android
// adaptive assets untouched — and nothing failed, because nothing tied the
// derived icons to the brand source.
//
// This file is that tie. It recomputes the digests recorded in
// assets/icon-derivation.json: change the brand icon without regenerating the
// Android set and the mismatch is named here, at commit time, instead of being
// noticed in a screenshot after release.
import { createHash } from 'node:crypto';
import fs from 'node:fs';

const read = (path: string): Buffer =>
  fs.readFileSync(new URL(`../${path}`, import.meta.url));

const sha256 = (path: string): string =>
  createHash('sha256').update(read(path)).digest('hex');

/** PNG IHDR: width, height and colour type, without decoding pixels. */
const pngHeader = (path: string): { width: number; height: number; colorType: number } => {
  const buf = read(path);
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error(`FAIL: ${path} is not a PNG`);
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    colorType: buf.readUInt8(25),
  };
};

const manifest = JSON.parse(read('assets/icon-derivation.json').toString('utf8')) as {
  source: string;
  source_sha256: string;
  canvas: number;
  safe_zone_fraction: number;
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

const adaptive = appJson.expo.android.adaptiveIcon;
const derivedPaths = Object.keys(manifest.derived);
const PNG_RGBA = 6;

const checks: Array<[string, boolean]> = [
  // The tie itself: brand source and its derivatives move together or fail.
  ['the brand source matches the digest the icons were derived from',
    sha256(manifest.source) === manifest.source_sha256],
  ...derivedPaths.map(
    (path): [string, boolean] => [
      `${path} matches its recorded digest`,
      sha256(path) === manifest.derived[path],
    ],
  ),

  // app.json must point at exactly the files the manifest covers, or the tie
  // guards assets the build never reads.
  ['app.json icon is the brand source', appJson.expo.icon === `./${manifest.source}`],
  ['adaptive foreground is a covered asset',
    derivedPaths.includes(adaptive.foregroundImage.replace(/^\.\//, ''))],
  ['adaptive background is a covered asset',
    derivedPaths.includes(adaptive.backgroundImage.replace(/^\.\//, ''))],
  ['adaptive monochrome is a covered asset',
    derivedPaths.includes(adaptive.monochromeImage.replace(/^\.\//, ''))],

  // The flat colour behind the mark and the colour Android fills around it are
  // the same value; a mismatch shows as a ring on masks larger than the image.
  ['adaptive backgroundColor matches the generated background',
    adaptive.backgroundColor.toLowerCase() === manifest.background_color.toLowerCase()],
  ['the background colour is a hex triplet', /^#[0-9a-f]{6}$/i.test(manifest.background_color)],

  // Geometry Android requires of an adaptive icon.
  ...derivedPaths.map((path): [string, boolean] => {
    const { width, height } = pngHeader(path);
    return [`${path} is ${manifest.canvas}²`, width === manifest.canvas && height === manifest.canvas];
  }),
  ['the foreground carries an alpha channel',
    pngHeader('assets/android-icon-foreground.png').colorType === PNG_RGBA],
  ['the monochrome carries an alpha channel',
    pngHeader('assets/android-icon-monochrome.png').colorType === PNG_RGBA],

  // A transparent foreground is the whole point: Android composites it over the
  // background layer and animates them apart. An opaque one would paint over
  // that background and kill the effect — and the old file was 8 KB of flat
  // cyan, so size alone separates a real mark from a placeholder.
  ['the foreground is not a flat placeholder', read('assets/android-icon-foreground.png').length > 50_000],
  ['the safe zone fraction is recorded', manifest.safe_zone_fraction > 0 && manifest.safe_zone_fraction <= 1],
];

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}
console.log(`icon assets: ${checks.length} checks passed`);
