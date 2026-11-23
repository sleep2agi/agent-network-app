import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const APP = 'sleep2agi/agent-network-app';
const HUB = 'sleep2agi/agent-network';
const MIRROR = 'https://modelscope.cn/datasets/SmartFlowAI/agent-network-releases/resolve/master';
const SITE = 'https://www.anet.sh/desktop/update';

export function identity(release, tag) {
  if (!/^desktop-v\d+\.\d+\.\d+$/.test(tag) || release.tag_name !== tag || release.draft || release.prerelease)
    throw new Error('Expected an exact published stable desktop release');
  if (!/^[a-f0-9]{40}$/.test(release.target_commitish)) throw new Error('Release must bind a full SHA');
  const version = tag.slice('desktop-v'.length);
  const apks = release.assets.filter(a => a.name.endsWith('.apk'));
  if (apks.length !== 1 || apks[0].name !== `Agent.Network_${version}_android-universal.apk` ||
      apks[0].state !== 'uploaded' || !/^sha256:[a-f0-9]{64}$/.test(apks[0].digest))
    throw new Error('Canonical Android APK identity missing');
  return { version, sha: release.target_commitish, digest: apks[0].digest.slice(7) };
}

export function assertPointers(version, pointers) {
  if (pointers.length !== 4 || pointers.some(v => v !== version)) throw new Error(`Channel pointers not converged: ${pointers.join(', ')}`);
}

function gh(args, token = process.env.GH_TOKEN) {
  return execFileSync('gh', args, { env: { ...process.env, GH_TOKEN: token }, encoding: 'utf8', timeout: 60000 }).trim();
}

async function get(url) {
  const response = await fetch(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
}

export async function main() {
  const tag = process.env.RELEASE_TAG;
  if (!/^desktop-v\d+\.\d+\.\d+$/.test(tag || '')) throw new Error('Invalid RELEASE_TAG');
  if (!process.env.HUB_ACTIONS_TOKEN) throw new Error('HUB_ACTIONS_TOKEN missing: configure scoped Hub Actions credential or use manual dispatch');
  const release = JSON.parse(gh(['api', `repos/${APP}/releases/tags/${tag}`]));
  const id = identity(release, tag);
  const comparison = JSON.parse(gh(['api', `repos/${APP}/compare/${id.sha}...main`]));
  if (!['ahead', 'identical'].includes(comparison.status)) throw new Error('Release SHA is not a main ancestor');
  // The Android lag gate targets latest; do not silently synchronize a different version.
  const latest = JSON.parse(gh(['api', `repos/${APP}/releases/latest`]));
  if (latest.id !== release.id) throw new Error('Release superseded: use version-specific manual recovery, do not move latest backwards');
  const evidence = { tag, ...id, startedAt: new Date().toISOString(), dispatches: [], verified: false };
  const save = () => writeFileSync('post-release-sync-evidence.json', JSON.stringify(evidence, null, 2));
  save();
  try {
    for (const [repo, workflow, fields, token] of [
      [APP, 'modelscope-mirror.yml', { commit: id.sha, tag }, process.env.GH_TOKEN],
      [APP, 'android-mirror-lag.yml', { dry_run: 'false' }, process.env.GH_TOKEN],
      [HUB, 'desktop-fallback-sync.yml', { version: id.version }, process.env.HUB_ACTIONS_TOKEN],
    ]) {
      gh(['workflow', 'run', workflow, '--repo', repo, '--ref', 'main', ...Object.entries(fields).flatMap(([k, v]) => ['-f', `${k}=${v}`])], token);
      evidence.dispatches.push({ repo, workflow, acceptedAt: new Date().toISOString() });
      save();
    }
    // Accepted dispatch is not success. Only independently fetched public bytes/pointers pass.
    // Fallback PR still requires review; timeout explicitly leaves manual recovery available.
    const deadline = Date.now() + 35 * 60 * 1000;
    while (Date.now() < deadline) {
      try {
        const [feed, fallback, desktop, android] = await Promise.all([
          get(`${SITE}/latest.json`).then(r => r.json()), get(`${SITE}/fallback.json`).then(r => r.json()),
          get(`${MIRROR}/desktop/latest/VERSION`).then(r => r.text()), get(`${MIRROR}/android/latest/VERSION`).then(r => r.text()),
        ]);
        assertPointers(id.version, [feed.version, fallback.version, desktop.trim(), android.trim()]);
        const response = await get(`${MIRROR}/android/agent-network-${id.version}.apk`);
        const hash = createHash('sha256');
        for await (const chunk of response.body) hash.update(chunk);
        if (hash.digest('hex') !== id.digest) throw new Error('Mirror APK differs from canonical GitHub asset');
        // Existing full verifier checks updater downloads and release notes too.
        execFileSync('python3', ['scripts/verify-release.py', id.version], { stdio: 'inherit', timeout: 240000 });
        evidence.verified = true;
        evidence.completedAt = new Date().toISOString();
        delete evidence.lastError;
        save();
        return;
      } catch (error) {
        evidence.lastError = error.message;
        save();
        console.log(`Waiting for channels (fallback PR may need review): ${error.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
    throw new Error('Channels did not converge: inspect child workflows and fallback PR; recover with existing manual dispatch entries');
  } catch (error) {
    evidence.error = error.message;
    save();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
