import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mirrorFetch } from './android-mirror-fetch.mjs';
import { pinnedBuild } from './android-pinned-build.mjs';
import { verifyEarlyAttachment } from './android-attachment-identity.mjs';
import { createHash } from 'node:crypto';
const apk = Buffer.from('same APK');
const record = { schemaVersion: 1, repository: 'sleep2agi/agent-network-app', version: '0.2.614', versionCode: 2614,
  commit: 'a'.repeat(40), runId: 1, runAttempt: 1, artifactId: 2, artifactName: 'agent-network-android-apk',
  artifactDigest: `sha256:${'b'.repeat(64)}`, apkSha256: createHash('sha256').update(apk).digest('hex') };
for (const mode of ['pinned', 'attachment']) {
  const call = get => mode === 'pinned' ? pinnedBuild(record.version, record.commit, get)
    : verifyEarlyAttachment({ version: record.version, commit: record.commit, apkSha256: record.apkSha256, get });
  test(`${mode}: first two 5xx retry, third response succeeds`, async () => {
    let attempts = 0; const waits = [];
    const get = mirrorFetch({ wait: async ms => waits.push(ms), fetchImpl: async url => {
      if (url.endsWith('.apk')) return new Response(apk);
      return ++attempts < 3 ? new Response('', { status: 502 }) : Response.json(record);
    } });
    await call(get); assert.equal(attempts, 3); assert.deepEqual(waits, [2000, 2000]);
  });
  test(`${mode}: exhausted failures say mirror unavailable, not source conflict`, async () => {
    let attempts = 0;
    const get = mirrorFetch({ wait: async () => {}, fetchImpl: async () => {
      attempts++; if (attempts === 2) throw new Error('timeout');
      return new Response('', { status: 503 });
    } });
    await assert.rejects(call(get), { message: '读不到安卓发布记录（镜像暂时不可用），不是提交冲突，请重跑' });
    assert.equal(attempts, 3);
  });
}
test('404 returns immediately; HEAD method preserved', async () => {
  let attempts = 0;
  const get = mirrorFetch({ wait: async () => assert.fail('404 must not retry'), fetchImpl: async (_, options) => {
    attempts++; assert.equal(options.method, 'HEAD'); return new Response(null, { status: 404 });
  } });
  assert.equal((await get('https://fixture', { method: 'HEAD' })).status, 404);
  assert.equal(attempts, 1);
});
