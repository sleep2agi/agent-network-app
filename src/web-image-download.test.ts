// @ts-nocheck -- repository tests run directly under Bun.
import { strict as assert } from 'node:assert';
import { downloadImageObjectUrl } from './web-image-download';

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

await assert.rejects(
  downloadImageObjectUrl(async () => new Response('', { status: 401 }), 'https://hub.example/file', 'bad', 'image.png', () => 'never'),
  /HTTP 401/,
);
await assert.rejects(
  downloadImageObjectUrl(async () => new Response(new Blob([]), { status: 200 }), 'https://hub.example/file', 'token', 'image.png', () => 'never'),
  /empty image response/,
);

console.log('web authenticated image download: 4 checks passed');
