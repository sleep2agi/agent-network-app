// ck-style (self-executing; run by scripts/run-tests.mjs — NOT bun:test).
// 原生端「原图关闭 → 最长边 2048、JPEG 0.8」的流程,用假的 manipulator 驱动。
import { strict as assert } from 'node:assert';

const { createSerialQueue, resizeForUpload } = await import('./native-resize');
const { runUploadQueue } = await import('./upload-queue');

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

{
  // 9 big photos through the real 3-lane upload queue: native decodes never overlap (max in flight = 1),
  // each ImageRef is released before the next decode starts, and uploads after resize still overlap.
  const serial = createSerialQueue();
  let inFlight = 0, maxInFlight = 0, uploading = 0, maxUploading = 0;
  const events: string[] = [];
  const tick = () => new Promise(r => setTimeout(r, 1));
  const deps = {
    decode: async (uri: string): Promise<Dec> => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); events.push(`decode ${uri}`);
      await tick();
      return { width: 8064, height: 6048, id: uri };
    },
    resizeAndSave: async (d: Dec, width: number, height: number) => { await tick(); return { uri: `${d.id}.out.jpg`, width, height }; },
    sizeOf: async () => 300_000,
    release: (d: Dec) => { inFlight--; events.push(`release ${d.id}`); },
  };
  const imgs = Array.from({ length: 9 }, (_, i) => ({ ...photo, uri: `file:///pick/${i}.HEIC`, fileSize: 9_000_000 }));
  const r = await runUploadQueue(imgs, async (img) => {
    const out = await serial(() => resizeForUpload(img, false, deps));
    uploading++; maxUploading = Math.max(maxUploading, uploading);
    await tick(); await tick(); await tick();
    uploading--;
    return out.uri;
  }, { concurrency: 3 });
  check(r.failed.length === 0 && r.results.every((u, i) => u === `file:///pick/${i}.HEIC.out.jpg`), 'serial resize: every image resized, results in input order');
  check(maxInFlight === 1, `serial resize: max decoded images in flight = 1 (got ${maxInFlight})`);
  const alternates = events.every((e, i) => e.startsWith(i % 2 ? 'release ' : 'decode ') && (i % 2 === 0 || e.slice(8) === events[i - 1].slice(7)));
  check(alternates && events.length === 18, `serial resize: decode A, release A, decode B, … (${events.slice(0, 4).join(' | ')})`);
  check(maxUploading > 1, `uploads after resize stay concurrent (max ${maxUploading})`);

  // Control: the same run without the serial queue overlaps decodes — proves the check above can go red.
  inFlight = 0; maxInFlight = 0;
  await runUploadQueue(imgs, async (img) => (await resizeForUpload(img, false, deps)).uri, { concurrency: 3 });
  check(maxInFlight === 3, `control: without the queue 3 decodes overlap (got ${maxInFlight})`);
}
{
  // A failing job does not block the queue, and its error still reaches the caller.
  const serial = createSerialQueue();
  const order: string[] = [];
  const a = serial(async () => { order.push('a'); throw new Error('boom'); });
  const b = serial(async () => { order.push('b'); return 'B'; });
  const ra = await a.then(() => 'ok', (e: Error) => e.message);
  check(ra === 'boom' && (await b) === 'B' && order.join() === 'a,b', 'serial queue: a failure is reported and the next job still runs');
}

console.log(`native-resize: ${ck}/${ck} checks passed`);
