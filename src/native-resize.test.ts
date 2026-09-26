// ck-style (self-executing; run by scripts/run-tests.mjs — NOT bun:test).
// 原生端「原图关闭 → 最长边 2048、JPEG 0.8」的流程,用假的 manipulator 驱动。
import { strict as assert } from 'node:assert';

const { resizeForUpload } = await import('./native-resize');

let ck = 0;
const check = (cond: boolean, msg: string) => { assert.ok(cond, msg); ck++; };

type Dec = { width: number; height: number; id: string };
const make = (opts: { w: number; h: number; outSize?: number; failDecode?: boolean; failSave?: boolean }) => {
  const log: string[] = [];
  const deps = {
    decode: async (uri: string): Promise<Dec> => {
      log.push(`decode ${uri}`);
      if (opts.failDecode) throw new Error('decode');
      return { width: opts.w, height: opts.h, id: 'D' };
    },
    resizeAndSave: async (d: Dec, width: number, height: number, quality: number) => {
      log.push(`resize ${d.id} ${width}x${height} q${quality}`);
      if (opts.failSave) throw new Error('save');
      return { uri: 'file:///cache/out.jpg', width, height };
    },
    sizeOf: async (uri: string) => { log.push(`size ${uri}`); return opts.outSize; },
    release: (d: Dec) => { log.push(`release ${d.id}`); },
  };
  return { deps, log };
};
const photo = { uri: 'file:///pick/IMG_1.HEIC', fileName: 'IMG_1.HEIC', mimeType: 'image/heic', fileSize: 5_000_000 };

{
  const { deps, log } = make({ w: 4032, h: 3024, outSize: 400_000 });
  const out = await resizeForUpload(photo, false, deps);
  check(log.includes('resize D 2048x1536 q0.8'), `原图 off: longest edge → 2048 at JPEG 0.8 (${log.join(' | ')})`);
  check(out.uri === 'file:///cache/out.jpg' && out.mimeType === 'image/jpeg' && out.fileName === 'IMG_1.jpg', 'result is the resized JPEG');
  check(out.fileSize === 400_000 && out.width === 2048 && out.height === 1536, 'result carries its real size and pixels');
  check(log[log.length - 1] === 'release D', 'the decoded native image is released');
}
{
  // EXIF-rotated portrait: decoded dims (after orientation) drive the plan, not picker-reported ones
  const { deps, log } = make({ w: 3024, h: 4032, outSize: 300_000 });
  await resizeForUpload({ ...photo, width: 4032, height: 3024 }, false, deps);
  check(log.includes('resize D 1536x2048 q0.8'), 'portrait keeps its orientation (decoded dims win)');
}
{
  const { deps, log } = make({ w: 4032, h: 3024 });
  const out = await resizeForUpload(photo, true, deps);
  check(out === photo && log.length === 0, '原图 on: original bytes, nothing decoded');
}
{
  const { deps, log } = make({ w: 1200, h: 900 });
  const small = { ...photo, fileSize: 300_000 };
  const out = await resizeForUpload(small, false, deps);
  check(out === small && !log.some(l => l.startsWith('resize')), 'already small: kept as is');
  check(log.includes('release D'), 'released even when kept');
}
{
  const { deps } = make({ w: 4032, h: 3024, outSize: 6_000_000 });
  check((await resizeForUpload(photo, false, deps)) === photo, 'a bigger re-encode falls back to the original');
}
{
  const { deps, log } = make({ w: 4032, h: 3024, failDecode: true });
  check((await resizeForUpload(photo, false, deps)) === photo && !log.includes('release D'), 'decode failure → original (12MB check still applies later)');
  const f2 = make({ w: 4032, h: 3024, failSave: true });
  check((await resizeForUpload(photo, false, f2.deps)) === photo && f2.log.includes('release D'), 'save failure → original, decoded image still released');
}
{
  const { deps, log } = make({ w: 4000, h: 4000 });
  check((await resizeForUpload({ ...photo, fileName: 'a.gif', mimeType: 'image/gif' }, false, deps)).fileName === 'a.gif' && log.length === 0, 'GIF untouched');
  check((await resizeForUpload({ uri: 'file:///d.pdf', fileName: 'd.pdf', mimeType: 'application/pdf', fileSize: 1 }, false, deps)).fileName === 'd.pdf' && log.length === 0, 'files untouched');
}
{
  const { deps } = make({ w: 4032, h: 3024, outSize: undefined });
  const out = await resizeForUpload(photo, false, deps);
  check(out.uri === 'file:///cache/out.jpg' && out.fileSize === undefined, 'unknown output size: still use the resized file');
}

console.log(`native-resize: ${ck}/${ck} checks passed`);
