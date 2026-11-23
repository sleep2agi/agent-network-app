import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinnedBuild } from './android-pinned-build.mjs';
const record = { schemaVersion: 1, repository: 'sleep2agi/agent-network-app', version: '0.2.614', commit: 'a'.repeat(40),
  runId: 10, runAttempt: 1, artifactId: 20, artifactName: 'agent-network-android-apk', artifactDigest: `sha256:${'b'.repeat(64)}`, apkSha256: 'c'.repeat(64) };
test('select original run and artifact, not a later rebuild', async () => {
  assert.deepEqual(await pinnedBuild(record.version, record.commit, async () => Response.json(record)), record);
  await assert.rejects(pinnedBuild(record.version, 'd'.repeat(40), async () => Response.json(record)), /Invalid immutable/);
});
test('only 404 allows normal build lookup; errors and malformed records stop', async () => {
  assert.equal(await pinnedBuild(record.version, record.commit, async () => new Response('', { status: 404 })), null);
  for (const response of [new Response('', { status: 403 }), Response.json({ ...record, artifactId: null })])
    await assert.rejects(pinnedBuild(record.version, record.commit, async () => response));
});
