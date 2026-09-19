// Regenerates the macOS menu-bar template icons from the brand mark.
//
// 0.2.76 shipped the tray with `trayTemplate.png` cut from the full product
// icon — plate included. A macOS template image is rendered by its ALPHA alone
// (the system paints it white on a dark bar, black on a light one), so a plate
// in the alpha becomes a solid white slab: Vincent's menu bar showed a
// washed-out grey block where every neighbouring app showed a crisp glyph, and
// he could not tell which item was ours. The fix is not a new drawing; it is
// cutting the template from the mark-only layer we already ship.
//
// Source is `assets/android-icon-monochrome.png`, the Android themed-icon
// layer: mark silhouette on transparency, no plate, already greyscale. It is
// itself derived from `assets/icon.png` by generate-android-icons.mjs, so a
// brand change propagates: that generator rewrites the monochrome layer, this
// manifest's source digest stops matching, and the tray test fails until the
// templates are regenerated too.
//
// Everything below uses one declared dependency (pngjs) and arithmetic, so CI
// re-runs it in a temporary directory and compares the result pixel for pixel.
// Anything the build cannot re-run is a claim, not a process.
//
// Windows is deliberately NOT generated here: `src-tauri/tray/tray.png` stays a
// colour icon, because a template image on Windows would render as a black
// smear in the notification area.
//
// Usage: node scripts/generate-tray-icons.mjs [--out <dir>] [--manifest <path>]
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

/** Every number the output depends on, recorded in the manifest alongside it. */
export const PARAMS = {
  /**
   * Canvas HEIGHT, not a square. tray-icon 0.24 forces the status image to
   * `NSSize { height: 18.0, width: 18.0 * aspect }` whatever pixel size we hand
   * it (src/platform_impl/macos/mod.rs), so height is the only budget that
   * exists and a square canvas would spend part of it on empty side margins:
   * this mark is 1.15:1, so squaring it costs ~13% of the glyph's height.
   * Width is therefore derived from the mark's own aspect.
   */
  height: 22,
  /**
   * Retina variant. The embedded image is scaled to 18pt regardless, so on a
   * 2x display a 22px source is upscaled and soft; 44px is a slight downscale
   * and stays crisp. tray.rs embeds this one.
   */
  height2x: 44,
  /**
   * How much of the canvas height the mark occupies. The bar's own glyphs are
   * not flush to the edge; 0.92 leaves a comparable hairline and keeps the
   * unread count from touching the mark.
   */
  glyphFraction: 0.92,
  /**
   * Alpha at or below this is background when finding the mark's bounds. The
   * source is a clean cut-out, so this only discards resampling dust.
   */
  trimAlphaFloor: 8,
};

const SOURCE = 'assets/android-icon-monochrome.png';
const OUTPUTS = [
  { name: 'trayTemplate.png', height: PARAMS.height },
  { name: 'trayTemplate@2x.png', height: PARAMS.height2x },
];
/** Where the committed copies live, relative to the repository root. */
const OUT_DIR = 'src-tauri/tray';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Digest of a text file with newlines normalised, so a Windows checkout agrees. */
const sha256Text = (buf) => sha256(Buffer.from(buf.toString('utf8').replace(/\r\n?/g, '\n'), 'utf8'));

/** Alpha plane of a decoded PNG, as one byte per pixel. */
function alphaPlane(png) {
  const out = new Float64Array(png.width * png.height);
  for (let i = 0; i < out.length; i += 1) out[i] = png.data[i * 4 + 3];
  return out;
}

/** Tightest box containing every pixel above the trim floor. */
function markBounds(alpha, width, height, floor) {
  let top = height;
  let left = width;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alpha[y * width + x] <= floor) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) throw new Error(`${SOURCE} has no pixels above alpha ${floor} — the mark layer is empty`);
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * Area-average resample of one plane.
 *
 * Point sampling a 574px mark down to 22px drops whole strokes: the mark is
 * three thin rings, and a nearest-neighbour grid lands between them. Averaging
 * every source pixel that falls in a destination cell keeps the strokes as
 * partial alpha, which is what makes the glyph legible at 22px.
 */
function resampleArea(plane, srcW, srcH, box, dstW, dstH) {
  const out = new Float64Array(dstW * dstH);
  for (let dy = 0; dy < dstH; dy += 1) {
    const y0 = box.top + (dy * box.height) / dstH;
    const y1 = box.top + ((dy + 1) * box.height) / dstH;
    for (let dx = 0; dx < dstW; dx += 1) {
      const x0 = box.left + (dx * box.width) / dstW;
      const x1 = box.left + ((dx + 1) * box.width) / dstW;
      let sum = 0;
      let weight = 0;
      for (let sy = Math.floor(y0); sy < Math.min(Math.ceil(y1), srcH); sy += 1) {
        const covY = Math.min(sy + 1, y1) - Math.max(sy, y0);
        if (covY <= 0) continue;
        for (let sx = Math.floor(x0); sx < Math.min(Math.ceil(x1), srcW); sx += 1) {
          const covX = Math.min(sx + 1, x1) - Math.max(sx, x0);
          if (covX <= 0) continue;
          const w = covX * covY;
          sum += plane[sy * srcW + sx] * w;
          weight += w;
        }
      }
      out[dy * dstW + dx] = weight > 0 ? sum / weight : 0;
    }
  }
  return out;
}

/**
 * One template image: the mark's alpha, centred on a canvas that hugs its own
 * aspect, over pure black RGB. The colour channels carry no information in a
 * template image —
 * AppKit reads alpha and paints its own colour — so they are zeroed rather than
 * left as whatever the source happened to hold.
 */
function renderTemplate(sourcePng, height) {
  const alpha = alphaPlane(sourcePng);
  const box = markBounds(alpha, sourcePng.width, sourcePng.height, PARAMS.trimAlphaFloor);
  const dstH = Math.max(1, Math.round(height * PARAMS.glyphFraction));
  const dstW = Math.max(1, Math.round((dstH * box.width) / box.height));
  const glyph = resampleArea(alpha, sourcePng.width, sourcePng.height, box, dstW, dstH);
  // Same hairline on every side: the canvas hugs the mark's own aspect.
  const width = dstW + (height - dstH);

  const png = new PNG({ width, height });
  png.data.fill(0);
  const offX = Math.round((width - dstW) / 2);
  const offY = Math.round((height - dstH) / 2);
  for (let y = 0; y < dstH; y += 1) {
    for (let x = 0; x < dstW; x += 1) {
      const cx = offX + x;
      const cy = offY + y;
      if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
      const i = (cy * width + cx) * 4;
      png.data[i] = 0;
      png.data[i + 1] = 0;
      png.data[i + 2] = 0;
      png.data[i + 3] = Math.max(0, Math.min(255, Math.round(glyph[y * dstW + x])));
    }
  }
  return PNG.sync.write(png);
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const at = argv.indexOf(name);
    return at >= 0 ? argv[at + 1] : null;
  };
  const outDir = resolve(REPO, flag('--out') ?? join(REPO, OUT_DIR));
  const manifestPath = resolve(REPO, flag('--manifest') ?? join(REPO, OUT_DIR, 'tray-derivation.json'));
  const writeManifest = flag('--out') === null || flag('--manifest') !== null;

  const sourceBuf = readFileSync(join(REPO, SOURCE));
  const sourcePng = PNG.sync.read(sourceBuf);

  mkdirSync(outDir, { recursive: true });
  const derived = {};
  for (const { name, height } of OUTPUTS) {
    const buf = renderTemplate(sourcePng, height);
    writeFileSync(join(outDir, name), buf);
    derived[`${OUT_DIR}/${name}`] = sha256(buf);
  }

  if (writeManifest) {
    const manifest = {
      _why:
        'Ties the macOS menu-bar template icons to the mark they are cut from. 0.2.76 cut them from the full product icon, plate included, and a template image is rendered by its alpha alone — so the menu bar showed a grey slab instead of a glyph. src/tray-icon-assets.test.ts re-runs the generator recorded here and compares pixels, so a brand change that skips regeneration fails at commit time instead of shipping.',
      generator: 'scripts/generate-tray-icons.mjs',
      generator_sha256: sha256Text(readFileSync(join(REPO, 'scripts/generate-tray-icons.mjs'))),
      params: PARAMS,
      source: SOURCE,
      source_sha256: sha256(sourceBuf),
      geometry_rule:
        'height is the budget (tray-icon scales the status image to 18pt tall); width follows the trimmed mark aspect so no height is spent on side margins',
      platform_note:
        'macOS only. src-tauri/tray/tray.png stays a colour icon: a template image on Windows renders as a black smear in the notification area.',
      derived,
    };
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  for (const rel of Object.keys(derived)) process.stdout.write(`${rel} ${derived[rel]}\n`);
}

main();
