// ck-style. Ctrl/⌘+C in the 图片预览 window: which clipboard route runs, and that the bytes handed
// over are PNG (what the Tauri side decodes). The real OS clipboard is a device check (PR notes).
import { __setClipboardDeps, copyImageBlob, type ClipboardDeps } from './image-clipboard';

let p = 0, t = 0;
const ck = (name: string, cond: boolean, detail = '') => { t++; if (cond) { p++; console.log(`PASS: ${name}`); } else console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`); };

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0])], { type: 'image/jpeg' });
const origWarn = console.warn; console.warn = () => {};

const deps = (over: Partial<ClipboardDeps>, log: string[]): ClipboardDeps => ({
  tauri: true,
  tauriWriteImage: async bytes => { log.push(`tauri:${bytes[0]}:${bytes.length}`); },
  webWrite: async blob => { log.push(`web:${blob.type}`); },
  toPng: async blob => { log.push(`toPng:${blob.type}`); return new Blob([PNG], { type: 'image/png' }); },
  ...over,
});

{
  const log: string[] = [];
  __setClipboardDeps(deps({}, log));
  const route = await copyImageBlob(jpeg);
  ck('desktop: Tauri clipboard-manager first', route === 'tauri', log.join(' '));
  ck('JPEG is re-encoded to PNG before writing', log[0] === 'toPng:image/jpeg' && log[1] === `tauri:${0x89}:${PNG.length}`, log.join(' '));
  ck('web clipboard not touched when Tauri worked', !log.some(l => l.startsWith('web')));
}
{
  const log: string[] = [];
  __setClipboardDeps(deps({ tauriWriteImage: async () => { throw new Error('not allowed by ACL'); } }, log));
  ck('Tauri write fails → web Clipboard API (image/png)', (await copyImageBlob(jpeg)) === 'web' && log.includes('web:image/png'), log.join(' '));
}
{
  const log: string[] = [];
  __setClipboardDeps(deps({ tauri: false }, log));
  ck('no Tauri → web Clipboard API', (await copyImageBlob(jpeg)) === 'web' && !log.some(l => l.startsWith('tauri')), log.join(' '));
}
{
  __setClipboardDeps(deps({ tauriWriteImage: async () => { throw new Error('denied'); }, webWrite: null }, []));
  let error = '';
  try { await copyImageBlob(jpeg); } catch (e) { error = (e as Error).message; }
  ck('no route works → rejects with the Tauri error (the caller shows 复制失败)', error === 'denied', error);
}
__setClipboardDeps(undefined);
console.warn = origWarn;

console.log(`\nimage-clipboard: ${p}/${t} passed`);
if (p !== t) process.exit(1);
