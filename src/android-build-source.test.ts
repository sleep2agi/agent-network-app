import { strict as assert } from 'node:assert';
import { validateAndroidBuildSource, selectVerifiedDispatchedBuild } from '../scripts/android-build-source.mjs';

const run = { id: 123, run_attempt: 2, head_branch: 'main', head_sha: 'b'.repeat(40), status: 'completed', conclusion: 'success', path: '.github/workflows/android-build.yml' };
const source = { schemaVersion: 1, repository: 'owner/app', runId: '123', runAttempt: '2', commit: 'a'.repeat(40), version: '0.2.606', versionCode: 2606, apkSha256: 'c'.repeat(64) };
const context = { repository: 'owner/app', run, commit: source.commit, apkSha256: source.apkSha256 };
assert.equal(validateAndroidBuildSource(source, context), source);
for (const patch of [{ repository: 'fork/app' }, { runId: '124' }, { runAttempt: '1' }, { commit: run.head_sha }, { versionCode: 2605 }, { apkSha256: 'd'.repeat(64) }]) {
  assert.throws(() => validateAndroidBuildSource({ ...source, ...patch }, context));
}
for (const patch of [{ conclusion: 'failure' }, { head_branch: 'feature' }, { path: '.github/workflows/other.yml' }]) {
  assert.throws(() => validateAndroidBuildSource(source, { ...context, run: { ...run, ...patch } }));
}
const dispatched = { ...run, event: 'workflow_dispatch' };
assert.equal(await selectVerifiedDispatchedBuild([dispatched], {
  repository: source.repository, commit: source.commit, loadSource: async () => source,
}), dispatched);
assert.equal(await selectVerifiedDispatchedBuild([dispatched], {
  repository: source.repository, commit: source.commit, loadSource: async () => null,
}), null);
await assert.rejects(() => selectVerifiedDispatchedBuild([dispatched], {
  repository: source.repository, commit: source.commit, loadSource: async () => ({ ...source, runAttempt: '1' }),
}));
console.log('android build source: 13 checks passed');
