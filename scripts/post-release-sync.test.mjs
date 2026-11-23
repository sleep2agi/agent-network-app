import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { identity, assertPointers, dispatchAndProve, ensureDesktopMirror, waitingMessage, waitForChannels, main, DigestMismatch } from './post-release-sync.mjs';
const tag = 'desktop-v0.2.613';
const release = () => ({ tag_name: tag, draft: false, prerelease: false, target_commitish: 'a'.repeat(40), assets: [{ name: 'Agent.Network_0.2.613_android-universal.apk', state: 'uploaded', digest: `sha256:${'b'.repeat(64)}` }] });
test('canonical published identity is bound to SHA and APK digest', () => {
  assert.deepEqual(identity(release(), tag), { version: '0.2.613', sha: 'a'.repeat(40), digest: 'b'.repeat(64) });
});
test('reject unpublished, unbound, wrong-version and ambiguous APK sources', () => {
  for (const change of [{ draft: true }, { prerelease: true }, { target_commitish: 'main' }, { tag_name: 'desktop-v0.2.612' }, { assets: [] }, { assets: [...release().assets, ...release().assets] }, { assets: [{ ...release().assets[0], digest: null }] }])
    assert.throws(() => identity({ ...release(), ...change }, tag));
});
test('all four exact pointers required; fallback lag cannot be green', () => {
  assert.doesNotThrow(() => assertPointers('0.2.613', Array(4).fill('0.2.613')));
  for (let i = 0; i < 4; i++) {
    const pointers = Array(4).fill('0.2.613'); pointers[i] = '0.2.612';
    assert.throws(() => assertPointers('0.2.613', pointers));
  }
  assert.throws(() => assertPointers('0.2.613', []));
});

function harness() {
  let clock = Date.parse('2026-11-23T06:26:31Z');
  const logs = [], calls = [], saved = [];
  const d = { env: { RELEASE_TAG: tag, GH_TOKEN: 'fixture' }, now: () => clock,
    sleep: async ms => { clock += ms; }, log: s => logs.push(s), save: e => saved.push(structuredClone(e)),
    verify: async () => {}, gh: async args => { calls.push(args); throw new Error(`Unexpected gh: ${args}`); },
    fetch: async url => { throw new Error(`Unexpected fetch: ${url}`); } };
  return { d, logs, calls, saved };
}
const bytes = Buffer.from('canonical fixture APK');
const digest = createHash('sha256').update(bytes).digest('hex');
function channels(d, { fallback = '0.2.613', apk = bytes, desktop = '0.2.613' } = {}) {
  d.fetch = async url => {
    if (url.endsWith('fallback.json')) return Response.json({ version: fallback });
    if (url.endsWith('latest.json')) return Response.json({ version: '0.2.613' });
    if (url.endsWith('desktop/latest/VERSION')) return new Response(desktop);
    if (url.endsWith('/VERSION')) return new Response('0.2.613');
    if (url.endsWith('.apk')) return new Response(apk);
    throw new Error(`Unexpected fetch ${url}`);
  };
}
test('204 is not success: old run and unrelated events cannot prove dispatch', async () => {
  const { d } = harness(); const e = { dispatches: [] };
  d.gh = async args => args[0] === 'workflow' ? '' : JSON.stringify({ workflow_runs: [
    { id: 10, event: 'workflow_dispatch', head_branch: 'main' },
    { id: 11, event: 'push', head_branch: 'main' },
  ] });
  await assert.rejects(dispatchAndProve(d, 'r', 'w.yml', {}, '', e), /w.yml dispatch 已接受但没有新 run/);
  assert.equal(e.dispatches[0].runId, undefined);
});
test('new dispatch evidence includes run link and high-water mark', async () => {
  const { d } = harness(); let dispatched = false;
  d.gh = async args => {
    if (args[0] === 'workflow') { dispatched = true; return ''; }
    return JSON.stringify({ workflow_runs: [{ id: dispatched ? 11 : 10, event: 'workflow_dispatch', head_branch: 'main', html_url: 'https://github.com/r/actions/runs/11' }] });
  };
  const e = { dispatches: [] }; await dispatchAndProve(d, 'r', 'w.yml', {}, '', e);
  assert.equal(e.dispatches[0].beforeRunId, 10);
  assert.equal(e.dispatches[0].url, 'https://github.com/r/actions/runs/11');
});
test('release-triggered desktop run suppresses duplicate dispatch', async () => {
  const { d } = harness(); let dispatches = 0;
  d.gh = async args => {
    if (args[0] === 'workflow') dispatches++;
    return JSON.stringify({ workflow_runs: [{ id: 12, event: 'release', head_branch: tag, head_sha: 'a'.repeat(40), created_at: new Date(d.now()).toISOString() }] });
  };
  await ensureDesktopMirror(d, { ...release(), published_at: new Date(d.now()).toISOString() }, { sha: 'a'.repeat(40) }, {});
  assert.equal(dispatches, 0);
});
test('desktop fallback dispatch waits the full 90-second grace period', async () => {
  const { d } = harness(); const start = d.now(); let dispatched = false;
  d.gh = async args => {
    if (args[0] === 'workflow') { assert.ok(d.now() - start >= 90000); dispatched = true; return ''; }
    return JSON.stringify({ workflow_runs: dispatched ? [{ id: 1, event: 'workflow_dispatch', head_branch: 'main' }] : [] });
  };
  await ensureDesktopMirror(d, { ...release(), published_at: new Date(start).toISOString() }, { sha: 'a'.repeat(40) }, { dispatches: [] });
  assert.equal(dispatched, true);
});
test('human-readable mirror lag and fallback-only messages are distinct', () => {
  assert.match(waitingMessage('v', { feed: 'v', desktop: 'old', android: 'v' }), /^镜像还没跟上/);
  assert.match(waitingMessage('v', { feed: 'v', desktop: 'v', android: 'v', fallback: 'old' }, 'https://pr/1'), /只差官网兜底 PR.*https:\/\/pr\/1/);
});
test('fallback-only wait prints actual PR URL and then verifies convergence', async () => {
  const { d, logs } = harness(); channels(d, { fallback: '0.2.612' });
  d.gh = async () => JSON.stringify([{ url: 'https://github.com/h/pull/7', state: 'OPEN' }]);
  const sleep = d.sleep; d.sleep = async ms => { await sleep(ms); channels(d); };
  const e = {}; await waitForChannels(d, { version: '0.2.613', digest }, e, false);
  assert.ok(logs.some(s => s.includes('只差官网兜底 PR') && s.includes('/pull/7')));
  assert.equal(e.verified, true);
});
test('APK digest mismatch immediately fails without waiting or final verifier', async () => {
  const { d } = harness(); channels(d, { apk: Buffer.from('wrong') });
  d.sleep = async () => assert.fail('digest mismatch must not retry');
  d.verify = async () => assert.fail('digest mismatch must not reach verifier');
  await assert.rejects(waitForChannels(d, { version: '0.2.613', digest }, {}, false), e => e instanceof DigestMismatch && e.message.startsWith('APK 摘要不一致'));
});
test('missing Hub token still dispatches and verifies App channels, then gives red recovery command', async () => {
  const { d, saved } = harness(); channels(d); let dispatched = false;
  const rel = { ...release(), id: 1, published_at: new Date(d.now()).toISOString() };
  rel.assets[0].digest = `sha256:${digest}`;
  d.gh = async args => {
    assert.ok(!args.join(' ').includes('repos/sleep2agi/agent-network/'), 'no Hub dispatch without credentials');
    if (args[0] === 'workflow') { assert.equal(args[2], 'android-mirror-lag.yml'); dispatched = true; return ''; }
    if (args[1].includes('/releases/')) return JSON.stringify(rel);
    if (args[1].includes('/compare/')) return JSON.stringify({ status: 'ahead' });
    if (args[1].includes('modelscope-mirror.yml')) return JSON.stringify({ workflow_runs: [{ id: 20, event: 'release', head_branch: tag, head_sha: rel.target_commitish, created_at: rel.published_at }] });
    return JSON.stringify({ workflow_runs: dispatched ? [{ id: 10, event: 'workflow_dispatch', head_branch: 'main' }] : [] });
  };
  await assert.rejects(main(d), /^Error: 安卓\/桌面镜像已同步；官网兜底文件需手动触发：gh workflow run desktop-fallback-sync.yml/);
  assert.equal(dispatched, true);
  assert.ok(saved.at(-1).appChannelsVerifiedAt);
  assert.equal(saved.at(-1).verified, false);
});
