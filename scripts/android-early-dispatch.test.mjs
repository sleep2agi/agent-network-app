import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEarlyTrigger } from './android-early-dispatch.mjs';
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
