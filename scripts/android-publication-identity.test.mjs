import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicationIdentity, assertPublicationAdvance } from './android-publication-identity.mjs';

function fixture() {
  const repository = 'sleep2agi/agent-network-app', commit = 'a'.repeat(40), apkSha256 = 'b'.repeat(64);
  const run = { id: 123, run_attempt: 1, head_branch: 'main', status: 'completed', conclusion: 'success', path: '.github/workflows/android-build.yml' };
  const source = { schemaVersion: 1, repository, commit, runId: 123, runAttempt: 1, version: '0.2.614', versionCode: 2614, apkSha256 };
  const artifact = { id: 456, name: 'android-apk', expired: false, workflow_run: { id: 123 }, digest: `sha256:${'c'.repeat(64)}` };
  return { repository, commit, apkSha256, run, source, artifact };
}
test('bind source, main successful run, artifact and APK independently', () => {
  const candidate = publicationIdentity(fixture());
  assert.equal(candidate.artifactId, 456);
  assert.equal(candidate.apkSha256, 'b'.repeat(64));
  for (const mutate of [x => x.run.head_branch = 'feature', x => x.run.conclusion = 'failure',
    x => x.artifact.expired = true, x => x.artifact.workflow_run.id = 999,
    x => x.source.runAttempt = 2, x => x.apkSha256 = 'd'.repeat(64)]) {
    const input = fixture(); mutate(input); assert.throws(() => publicationIdentity(input));
  }
});
test('same version cannot be rebuilt or replaced, even with identical APK bytes', () => {
  const candidate = publicationIdentity(fixture());
  assert.equal(assertPublicationAdvance(candidate, { existingVersion: candidate, latest: candidate }), 'reuse');
  for (const key of ['commit', 'runId', 'runAttempt', 'artifactId', 'artifactDigest', 'apkSha256']) {
    assert.throws(() => assertPublicationAdvance({ ...candidate, [key]: 'changed' }, { existingVersion: candidate }));
  }
});
test('new versions strictly increase versionCode; missing same-version evidence fails', () => {
  const candidate = publicationIdentity(fixture());
  assert.equal(assertPublicationAdvance(candidate, { latest: { version: '0.2.613', versionCode: 2613 } }), 'publish');
  assert.throws(() => assertPublicationAdvance(candidate, { latest: { version: '0.2.615', versionCode: 2615 } }));
  assert.throws(() => assertPublicationAdvance(candidate, { latest: candidate }));
});
