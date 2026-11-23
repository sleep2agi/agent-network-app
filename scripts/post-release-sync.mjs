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

export class DigestMismatch extends Error {}

export function waitingMessage(version, { feed, fallback, desktop, android }, prUrl) {
  if ([feed, desktop, android].some(v => v !== version)) return '镜像还没跟上：等待桌面/安卓镜像及更新源同步';
  if (fallback !== version) return `只差官网兜底 PR 没合或部署未生效：${prUrl || '尚未找到 PR，请检查 Hub fallback 生成任务'}`;
  return null;
}

export function defaults() {
  return {
    env: process.env,
    gh: (args, token = process.env.GH_TOKEN) => execFileSync('gh', args, {
      env: { ...process.env, GH_TOKEN: token }, encoding: 'utf8', timeout: 60000,
    }).trim(),
    fetch: (url) => fetch(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(120000) }),
    now: () => Date.now(),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    log: text => console.log(text),
    save: evidence => writeFileSync('post-release-sync-evidence.json', JSON.stringify(evidence, null, 2)),
    verify: version => execFileSync('python3', ['scripts/verify-release.py', version], { stdio: 'inherit', timeout: 240000 }),
  };
}

async function get(d, url) {
  const response = await d.fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
}

async function runs(d, repo, workflow, token) {
  return JSON.parse(await d.gh(['api', `repos/${repo}/actions/workflows/${workflow}/runs?per_page=100`], token)).workflow_runs;
}

// Match only dispatch runs newer than the pre-dispatch high-water mark on main.
// Run inputs are not exposed here: public version+digest verification remains mandatory.
export async function dispatchAndProve(d, repo, workflow, fields, token, evidence) {
  const before = Math.max(0, ...(await runs(d, repo, workflow, token)).map(r => r.id));
  await d.gh(['workflow', 'run', workflow, '--repo', repo, '--ref', 'main', ...Object.entries(fields).flatMap(([k, v]) => ['-f', `${k}=${v}`])], token);
  const record = { repo, workflow, beforeRunId: before, acceptedAt: new Date(d.now()).toISOString() };
  evidence.dispatches.push(record); d.save(evidence);
  const deadline = d.now() + 180000;
  while (d.now() < deadline) {
    const found = (await runs(d, repo, workflow, token))
      .filter(r => r.id > before && r.event === 'workflow_dispatch' && r.head_branch === 'main')
      .sort((a, b) => a.id - b.id)[0];
    if (found) {
      record.runId = found.id;
      record.url = found.html_url || `https://github.com/${repo}/actions/runs/${found.id}`;
      d.save(evidence); d.log(`${workflow} 已启动：${record.url}`);
      return record;
    }
    await d.sleep(10000);
  }
  throw new Error(`${repo}/${workflow} dispatch 已接受但没有新 run 出现（旧 run ≤${before} 不算）`);
}

export async function ensureDesktopMirror(d, release, id, evidence) {
  // GitHub release runs report the release tag as head_branch. Exact tag + SHA
  // and event avoid accepting a mirror from an unrelated publication.
  const published = Date.parse(release.published_at);
  if (!Number.isFinite(published)) throw new Error('Missing publication timestamp');
  const deadline = published + 90000;
  do {
    const found = (await runs(d, APP, 'modelscope-mirror.yml', d.env.GH_TOKEN)).find(r =>
      r.event === 'release' && r.head_branch === release.tag_name && r.head_sha === id.sha && Date.parse(r.created_at) >= published);
    if (found) {
      evidence.desktopReleaseRun = { runId: found.id, url: found.html_url || `https://github.com/${APP}/actions/runs/${found.id}` };
      d.save(evidence); d.log(`桌面镜像已由 release 事件启动：${evidence.desktopReleaseRun.url}`);
      if (found.status === 'completed' && found.conclusion !== 'success') throw new Error(`桌面镜像失败，请手动恢复：${evidence.desktopReleaseRun.url}`);
      return;
    }
    if (d.now() >= deadline) break;
    await d.sleep(Math.min(10000, deadline - d.now()));
  } while (true);
  await dispatchAndProve(d, APP, 'modelscope-mirror.yml', { commit: id.sha, tag: release.tag_name }, d.env.GH_TOKEN, evidence);
}

export async function waitForChannels(d, id, evidence, missingHub) {
  const recovery = `gh workflow run desktop-fallback-sync.yml --repo ${HUB} --ref main -f version=${id.version}`;
  const deadline = d.now() + 35 * 60 * 1000;
  while (d.now() < deadline) {
    try {
      const [feed, desktop, android] = await Promise.all([
        get(d, `${SITE}/latest.json`).then(r => r.json()),
        get(d, `${MIRROR}/desktop/latest/VERSION`).then(r => r.text()),
        get(d, `${MIRROR}/android/latest/VERSION`).then(r => r.text()),
      ]);
      const pointers = { feed: feed.version, desktop: desktop.trim(), android: android.trim(), fallback: null };
      // Verify App channels independently of unavailable Hub credentials/fallback.
      if ([pointers.feed, pointers.desktop, pointers.android].every(v => v === id.version)) {
        const response = await get(d, `${MIRROR}/android/agent-network-${id.version}.apk`);
        const hash = createHash('sha256');
        for await (const chunk of response.body) hash.update(chunk);
        if (hash.digest('hex') !== id.digest) throw new DigestMismatch('APK 摘要不一致：镜像与 GitHub canonical APK 不同，立即停止');
        evidence.appChannelsVerifiedAt = new Date(d.now()).toISOString(); d.save(evidence);
        if (missingHub) {
          const error = new Error(`安卓/桌面镜像已同步；官网兜底文件需手动触发：${recovery}（缺少 HUB_ACTIONS_TOKEN）`);
          error.manualRecovery = true; throw error;
        }
      }
      let prUrl;
      if ([pointers.feed, pointers.desktop, pointers.android].every(v => v === id.version)) {
        pointers.fallback = (await (await get(d, `${SITE}/fallback.json`)).json()).version;
        if (pointers.fallback !== id.version) {
          const prs = JSON.parse(await d.gh(['pr', 'list', '--repo', HUB, '--head', `ci/desktop-fallback-${id.version.replaceAll('.', '-')}`, '--state', 'all', '--json', 'url,state'], d.env.HUB_ACTIONS_TOKEN));
          prUrl = prs[0]?.url;
          evidence.fallbackPr = prs[0];
        }
      }
      const message = waitingMessage(id.version, pointers, prUrl);
      if (message) { evidence.lastError = message; d.log(message); d.save(evidence); }
      else {
        await d.verify(id.version);
        evidence.verified = true; evidence.completedAt = new Date(d.now()).toISOString();
        delete evidence.lastError; d.save(evidence); return;
      }
    } catch (error) {
      if (error instanceof DigestMismatch || error.manualRecovery) throw error;
      evidence.lastError = error.message; d.save(evidence);
      d.log(`渠道读取/复验暂未完成：${error.message}`);
    }
    await d.sleep(30000);
  }
  throw new Error(`渠道未收敛：${evidence.lastError || '请检查子任务'}；失败时可使用原手动恢复入口`);
}

export async function main(d = defaults()) {
  const tag = d.env.RELEASE_TAG;
  if (!/^desktop-v\d+\.\d+\.\d+$/.test(tag || '')) throw new Error('Invalid RELEASE_TAG');
  const release = JSON.parse(await d.gh(['api', `repos/${APP}/releases/tags/${tag}`]));
  const id = identity(release, tag);
  const comparison = JSON.parse(await d.gh(['api', `repos/${APP}/compare/${id.sha}...main`]));
  if (!['ahead', 'identical'].includes(comparison.status)) throw new Error('Release SHA is not a main ancestor');
  const latest = JSON.parse(await d.gh(['api', `repos/${APP}/releases/latest`]));
  if (latest.id !== release.id) throw new Error('Release superseded: use version-specific manual recovery');
  const evidence = { tag, ...id, startedAt: new Date(d.now()).toISOString(), dispatches: [], verified: false };
  const missingHub = !d.env.HUB_ACTIONS_TOKEN;
  evidence.hubDispatchSkipped = missingHub;
  d.save(evidence);
  try {
    // Launch App work first even without the cross-repository credential.
    await dispatchAndProve(d, APP, 'android-mirror-lag.yml', { dry_run: 'false' }, d.env.GH_TOKEN, evidence);
    await ensureDesktopMirror(d, release, id, evidence);
    if (!missingHub) await dispatchAndProve(d, HUB, 'desktop-fallback-sync.yml', { version: id.version }, d.env.HUB_ACTIONS_TOKEN, evidence);
    else d.log('缺少 HUB_ACTIONS_TOKEN：安卓/桌面镜像照常同步核验，官网兜底需手动恢复，最终将标红');
    await waitForChannels(d, id, evidence, missingHub);
  } catch (error) {
    evidence.error = error.message; d.save(evidence); throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
