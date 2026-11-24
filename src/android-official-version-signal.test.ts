import assert from 'node:assert/strict';
import { __resetAndroidUpdaterForTest, checkAndroidUpdate } from './android-updater';
import { ANDROID_LATEST_RELEASE_API, MIRROR_VERSION_URL, ANDROID_CHANNEL_VERSION_URL } from './android-update-core';

async function scenario(source: string | null, official: string, githubStatus = 200, githubVersion = '0.2.616') {
  __resetAndroidUpdaterForTest();
  let githubCalls = 0;
  const fetchImpl = (async (url: string) => {
    if (url === MIRROR_VERSION_URL || url === ANDROID_CHANNEL_VERSION_URL) return new Response('0.2.614\n');
    if (url === 'https://anet.sh/desktop/update/latest.json') {
      if (official === 'throw') throw new Error('offline');
      return new Response(JSON.stringify({ version: official }), { headers: source ? { 'X-Anet-Update-Source': source } : {} });
    }
    if (url === ANDROID_LATEST_RELEASE_API) {
      githubCalls++;
      return new Response(JSON.stringify({ tag_name: `desktop-v${githubVersion}`, assets: [{
        name: `Agent.Network_${githubVersion}_android-universal.apk`,
        browser_download_url: `https://github.com/sleep2agi/agent-network-app/releases/download/desktop-v${githubVersion}/Agent.Network_${githubVersion}_android-universal.apk`,
        digest: `sha256:${'a'.repeat(64)}`, size: 90,
      }] }), { status: githubStatus });
    }
    return new Response('', { status: 404 });
  }) as typeof fetch;
  const state = await checkAndroidUpdate('0.2.614', { fetchImpl, minVisibleMs: 0 });
  return { state, githubCalls };
}
let r = await scenario('desktop-v0.2.616', '0.2.616');
assert.equal(r.state.kind, 'available');
assert.equal('version' in r.state && r.state.version, '0.2.616');
assert.equal(r.githubCalls, 1);
for (const status of [403, 500]) {
  r = await scenario('desktop-v0.2.616', '0.2.616', status);
  assert.equal(r.state.kind, 'error');
  assert.match(r.state.kind === 'error' ? r.state.message : '', /0\.2\.616.*同步/);
  assert.equal(r.githubCalls, 1);
}
for (const [source, version] of [['fallback', '0.2.616'], [null, '0.2.616'], ['desktop-v0.2.616', 'throw'], ['desktop-v0.2.614', '0.2.614'], ['desktop-v0.2.613', '0.2.613']] as const) {
  r = await scenario(source, version);
  assert.equal(r.state.kind, 'up-to-date');
  assert.equal(r.githubCalls, 0);
}
r = await scenario('desktop-v0.2.616', '0.2.616', 200, '0.2.615');
assert.equal(r.state.kind, 'error');
console.log('PASS: 9 official-version signal scenarios');
