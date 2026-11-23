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
// 2026-11-23, first real run on 0.2.614: `spawnSync gh ENOBUFS`. The workflow-runs listing is ~1.5 MB
// at per_page=100 and execFileSync caps output at 1 MB by default, so the script died before dispatching.
// The offline tests injected a fake gh and never met a real response size.
import { readFileSync } from 'node:fs';
import { GH_MAX_BUFFER, RUNS_FIELDS } from './android-early-dispatch.mjs';
test('gh calls lift the 1 MB output cap and ask only for the fields they read', () => {
  assert.ok(GH_MAX_BUFFER >= 16 * 1024 * 1024);
  for (const field of ['id', 'event', 'head_branch', 'head_sha', 'created_at', 'status', 'conclusion', 'html_url'])
    assert.ok(RUNS_FIELDS.includes(field), field);
  for (const file of ['android-early-dispatch.mjs', 'post-release-sync.mjs']) {
    const src = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    const ghCalls = src.match(/execFileSync\('gh', args, \{[\s\S]*?\}\)\.trim\(\)/g) ?? [];
    assert.ok(ghCalls.length >= 1, `${file}: no gh call found`);
    for (const call of ghCalls) assert.match(call, /maxBuffer: GH_MAX_BUFFER/, `${file}: gh call without maxBuffer`);
    assert.doesNotMatch(src, /runs\?per_page=100/, `${file}: unbounded runs listing`);
    for (const listing of src.match(/\/runs\?per_page=\d+`[^\n]*/g) ?? []) assert.match(listing, /'--jq', RUNS_FIELDS/, `${file}: runs listing without field projection`);
    for (const compare of src.match(/compare\/[^\n]*/g) ?? []) assert.match(compare, /'--jq', '\{status\}'/, `${file}: compare without projection`);
  }
});
