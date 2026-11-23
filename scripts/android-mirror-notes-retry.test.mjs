import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readMirrorNotes, notesDeadlineResult, NOTES_GRACE_MS } from './android-mirror-lag-gate.mjs';
const pending = '安卓版已可下载，桌面版稍后。';
test('retry transient notes failures and return recovered notes', async () => {
  let calls = 0, waits = 0;
  const result = await readMirrorNotes({ mirrorBase: 'https://fixture', version: '0.2.614',
    fetchImpl: async () => ++calls < 3 ? new Response('', { status: 503 }) : new Response('ready'),
    wait: async () => { waits++; } });
  assert.equal(result.text, 'ready'); assert.equal(calls, 3); assert.equal(waits, 2);
});
test('exhausted HTTP/transport retries report uncertainty, not pending desktop', async () => {
  let calls = 0;
  const result = await readMirrorNotes({ mirrorBase: 'https://fixture', version: '0.2.614',
    fetchImpl: async () => { calls++; throw new Error('network unavailable'); }, wait: async () => {} });
  assert.equal(calls, 3); assert.equal(result.text, undefined); assert.match(result.error, /network unavailable/);
});
test('known pending notes turn red only after the 20 minute publication grace', () => {
  const published = '2026-11-23T06:26:31Z';
  assert.equal(notesDeadlineResult(pending, published, Date.parse(published) + NOTES_GRACE_MS).code, 0);
  assert.equal(notesDeadlineResult(pending, published, Date.parse(published) + NOTES_GRACE_MS + 1).code, 1);
  assert.equal(notesDeadlineResult(pending, 'invalid', Date.now()).code, 0);
});
