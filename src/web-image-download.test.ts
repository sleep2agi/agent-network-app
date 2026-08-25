// @ts-nocheck -- repository tests run directly under Bun.
import { strict as assert } from 'node:assert';
import { downloadImageObjectUrl, saveImageObjectUrl } from './web-image-download';

let authorization = '';
const ok = await downloadImageObjectUrl(
  async (_url, init) => {
    authorization = String((init?.headers as Record<string, string>)?.Authorization ?? '');
    return new Response(new Blob(['image-bytes'], { type: 'image/png' }), { status: 200 });
  },
  'https://hub.example/api/files/file-1',
  'secret-token',
  'image.png',
  blob => `blob:test-${blob.size}`,
);
assert.equal(authorization, 'Bearer secret-token');
assert.equal(ok, 'blob:test-11');

let normalizedType = '';
await downloadImageObjectUrl(
  async () => new Response(new Blob(['jpeg'], { type: 'application/octet-stream' }), { status: 200 }),
  'https://hub.example/api/files/file-2',
  'secret-token',
  'photo.jpg',
  blob => { normalizedType = blob.type; return 'blob:jpeg'; },
);
assert.equal(normalizedType, 'image/jpeg');

let sniffedType = '';
await downloadImageObjectUrl(
  async () => new Response(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'application/octet-stream' }), { status: 200 }),
  'https://hub.example/api/files/file-legacy',
  'secret-token',
  '图片 file-lega…',
  blob => { sniffedType = blob.type; return 'blob:png'; },
  'image/*',
);
assert.equal(sniffedType, 'image/png');

await assert.rejects(
  downloadImageObjectUrl(async () => new Response('', { status: 401 }), 'https://hub.example/file', 'bad', 'image.png', () => 'never'),
  /HTTP 401/,
);
await assert.rejects(
  downloadImageObjectUrl(async () => new Response(new Blob([]), { status: 200 }), 'https://hub.example/file', 'token', 'image.png', () => 'never'),
  /empty image response/,
);

let clicked = false;
let downloadName = '';
let href = '';
saveImageObjectUrl('blob:authenticated-image', 'node-report.png', {
  createElement() {
    return {
      href: '', download: '', rel: '',
      click() { clicked = true; href = this.href; downloadName = this.download; },
    } as HTMLAnchorElement;
  },
} as Pick<Document, 'createElement'>);
assert.equal(clicked, true);
assert.equal(href, 'blob:authenticated-image');
assert.equal(downloadName, 'node-report.png');
assert.equal(href.includes('secret-token'), false);

console.log('web authenticated image download: 9 checks passed');
