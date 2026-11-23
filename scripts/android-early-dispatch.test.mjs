import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEarlyTrigger, versionChanged, alreadyPublished } from './android-early-dispatch.mjs';
const repository = 'sleep2agi/agent-network-app', commit = 'a'.repeat(40);
const run = { id: 1, run_attempt: 1, event: 'push', head_branch: 'main', head_sha: commit,
  head_repository: { full_name: repository }, path: '.github/workflows/android-build.yml', status: 'completed', conclusion: 'success' };
const source = { schemaVersion: 1, repository, runId: 1, runAttempt: 1, commit, version: '0.2.614', versionCode: 2614, apkSha256: 'b'.repeat(64) };
test('only successful original main push can trigger early publication', () => {
  assert.equal(validateEarlyTrigger(run, source, repository, commit), source);
  for (const change of [{ event: 'workflow_dispatch' }, { head_branch: 'feature' }, { conclusion: 'failure' }, { head_sha: 'c'.repeat(40) }, { head_repository: { full_name: 'fork/app' } }])
    assert.throws(() => validateEarlyTrigger({ ...run, ...change }, source, repository, commit));
  assert.throws(() => validateEarlyTrigger(run, { ...source, runAttempt: 2 }, repository, commit));
});
test('dependency/script-only package edits skip; actual version bump proceeds', () => {
  assert.equal(versionChanged('0.2.613', '0.2.613'), false);
  assert.equal(versionChanged('0.2.614', '0.2.613'), true);
  assert.throws(() => versionChanged('0.2.614', undefined));
});
test('identical recorded source/run skips; mismatches never silently skip', () => {
  const record = { ...source, runId: run.id, runAttempt: run.run_attempt };
  assert.equal(alreadyPublished(null, source, run), false);
  assert.equal(alreadyPublished(record, source, run), true);
  for (const change of [{ runId: 2 }, { runAttempt: 2 }, { apkSha256: 'c'.repeat(64) }, { versionCode: 2615 }])
    assert.throws(() => alreadyPublished({ ...record, ...change }, source, run));
});
