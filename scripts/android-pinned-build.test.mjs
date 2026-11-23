import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinnedBuild } from './android-pinned-build.mjs';
import { readFileSync } from 'node:fs';
const record = { schemaVersion: 1, repository: 'sleep2agi/agent-network-app', version: '0.2.614', versionCode: 2614, commit: 'a'.repeat(40),
  runId: 10, runAttempt: 1, artifactId: 20, artifactName: 'agent-network-android-apk', artifactDigest: `sha256:${'b'.repeat(64)}`, apkSha256: 'c'.repeat(64) };
test('select original run and artifact, not a later rebuild', async () => {
  assert.deepEqual(await pinnedBuild(record.version, record.commit, async () => Response.json(record)), record);
  await assert.rejects(pinnedBuild(record.version, 'd'.repeat(40), async () => Response.json(record)), /安卓 0.2.614 已从提交 .*先发；桌面请从同一提交发布，或升一个版本号/);
});
test('only 404 allows normal build lookup; errors and malformed records stop', async () => {
  assert.equal(await pinnedBuild(record.version, record.commit, async () => new Response('', { status: 404 })), null);
  for (const response of [new Response('', { status: 403 }), Response.json({ ...record, artifactId: null })])
    await assert.rejects(pinnedBuild(record.version, record.commit, async () => response));
});
test('all native builds depend on source preflight, including publish=false', () => {
  const workflow = readFileSync(new URL('../.github/workflows/release-desktop-auto-update.yml', import.meta.url), 'utf8');
  const preflight = workflow.slice(workflow.indexOf('  android-source-preflight:'), workflow.indexOf('  prepare-release:'));
  assert.match(preflight, /node scripts\/android-pinned-build.mjs "\$version" "\$REQUESTED_COMMIT"/);
  assert.match(preflight, /ref: main/);
  const build = workflow.slice(workflow.indexOf('  build-release:'), workflow.indexOf('    strategy:'));
  assert.match(build, /needs: \[android-source-preflight, prepare-release\]/);
  assert.match(build, /needs.android-source-preflight.result == 'success' &&/);
});
