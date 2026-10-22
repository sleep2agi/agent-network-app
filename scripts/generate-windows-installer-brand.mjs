// NSIS accepts 24-bit BMP, not the application's PNG icon. Derive its page
// artwork from the existing brand mark without fonts, network or new artwork.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const layouts = {
  header: { width: 150, height: 57, size: 50, x: 50, y: 3, background: [255, 255, 255] },
  sidebar: { width: 164, height: 314, size: 132, x: 16, y: 80, background: [4, 17, 45] },
};

export function generate(sourceBytes, layout) {
  const source = PNG.sync.read(sourceBytes);
  const { width, height, size, x, y, background } = layout;
  const rgb = Buffer.alloc(width * height * 3);
  for (let p = 0; p < rgb.length; p += 3) {
    for (let c = 0; c < 3; c++) rgb[p + c] = background[c];
  }
  // Area-average RGBA, compositing each sample onto the page background first.
  // This keeps transparent edges clean and retains the whole mark's aspect.
  const scale = Math.min(size / source.width, size / source.height);
  const dw = Math.round(source.width * scale), dh = Math.round(source.height * scale);
  for (let dy = 0; dy < dh; dy++) {
    const top = dy * source.height / dh, bottom = (dy + 1) * source.height / dh;
    for (let dx = 0; dx < dw; dx++) {
      const left = dx * source.width / dw, right = (dx + 1) * source.width / dw;
      const total = (bottom - top) * (right - left);
      const sum = [0, 0, 0];
      for (let sy = Math.floor(top); sy < Math.ceil(bottom); sy++) {
        for (let sx = Math.floor(left); sx < Math.ceil(right); sx++) {
          const weight = (Math.min(sy + 1, bottom) - Math.max(sy, top)) *
            (Math.min(sx + 1, right) - Math.max(sx, left));
          const p = (sy * source.width + sx) * 4, alpha = source.data[p + 3] / 255;
          for (let c = 0; c < 3; c++) {
            sum[c] += weight * (source.data[p + c] * alpha + background[c] * (1 - alpha));
          }
        }
      }
      const p = ((y + dy) * width + x + dx) * 3;
      for (let c = 0; c < 3; c++) rgb[p + c] = Math.round(sum[c] / total);
    }
  }
  // BITMAPINFOHEADER, bottom-up BGR rows padded to four bytes. No compression.
  const stride = Math.ceil(width * 3 / 4) * 4;
  const bmp = Buffer.alloc(54 + stride * height);
  bmp.write('BM'); bmp.writeUInt32LE(bmp.length, 2); bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(width, 18); bmp.writeInt32LE(height, 22);
  bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28);
  bmp.writeUInt32LE(stride * height, 34);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const src = (row * width + col) * 3, dst = 54 + (height - 1 - row) * stride + col * 3;
      bmp[dst] = rgb[src + 2]; bmp[dst + 1] = rgb[src + 1]; bmp[dst + 2] = rgb[src];
    }
  }
  return bmp;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outIndex = process.argv.indexOf('--out');
  const output = outIndex < 0 ? join(ROOT, 'src-tauri/windows/brand') : resolve(process.argv[outIndex + 1]);
  mkdirSync(output, { recursive: true });
  const source = readFileSync(join(ROOT, 'assets/icon.png'));
  for (const [name, layout] of Object.entries(layouts)) {
    writeFileSync(join(output, `${name}.bmp`), generate(source, layout));
    console.log(`${name}.bmp ${layout.width}x${layout.height} RGB24`);
  }
}
