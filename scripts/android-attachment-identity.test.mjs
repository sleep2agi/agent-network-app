import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyEarlyAttachment } from './android-attachment-identity.mjs';
const bytes = Buffer.from('early APK');
const apkSha256 = createHash('sha256').update(bytes).digest('hex');
const args = { version: '0.2.614', commit: 'a'.repeat(40), apkSha256 };
const record = { ...args, schemaVersion: 1, repository: 'sleep2agi/agent-network-app' };
test('attachment must match source, immutable record and actual mirror bytes', async () => {
  const get = async url => url.endsWith('.json') ? Response.json(record) : new Response(bytes);
  assert.equal(await verifyEarlyAttachment({ ...args, get }), 'same-bytes');
  await assert.rejects(verifyEarlyAttachment({ ...args, commit: 'b'.repeat(40), get }), /differs/);
  await assert.rejects(verifyEarlyAttachment({ ...args, get: async url => url.endsWith('.json') ? Response.json(record) : new Response('rebuilt') }), /bytes differ/);
});
test('only double 404 allows first publication; auth and transport errors do not', async () => {
  assert.equal(await verifyEarlyAttachment({ ...args, get: async () => new Response('', { status: 404 }) }), 'not-published');
  for (const status of [200, 403, 500]) {
    await assert.rejects(verifyEarlyAttachment({ ...args, get: async url => new Response('', { status: url.endsWith('.json') ? 404 : status }) }));
  }
});
