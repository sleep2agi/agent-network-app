import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateAndroidBuildSource } from './android-build-source.mjs';
import { pinnedBuild } from './android-pinned-build.mjs';

export const GH_MAX_BUFFER = 64 * 1024 * 1024;
// Only the fields the dispatch proof reads; the full run objects are ~15 KB each.
export const RUNS_FIELDS = '{workflow_runs: [.workflow_runs[] | {id, event, head_branch, head_sha, created_at, status, conclusion, html_url}]}';

export function versionChanged(current, parent) {
  if (![current, parent].every(v => /^\d+\.\d+\.\d+$/.test(v || ''))) throw new Error('Cannot establish package version change');
  return current !== parent;
}

export function alreadyPublished(record, source, run) {
  if (!record) return false;
  if (record.commit !== source.commit || record.version !== source.version || record.versionCode !== source.versionCode
      || record.runId !== run.id || record.runAttempt !== run.run_attempt || record.apkSha256 !== source.apkSha256)
    throw new Error('Existing Android publication differs from this source/run; refusing replacement');
  return true;
}

export function validateEarlyTrigger(run, source, repository, commit) {
  if (repository !== 'sleep2agi/agent-network-app' || run.event !== 'push'
      || run.head_repository?.full_name !== repository || run.head_sha !== commit)
    throw new Error('Early publication requires the original version push in the App repository');
  return validateAndroidBuildSource(source, { repository, run, commit });
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY, runId = process.env.BUILD_RUN_ID, commit = process.env.BUILD_COMMIT;
  if (!/^\d+$/.test(runId || '') || !/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('Invalid run/commit');
  // GitHub list/compare responses run to megabytes; Node's default 1 MB output cap aborts with ENOBUFS.
  const gh = args => execFileSync('gh', args, { encoding: 'utf8', timeout: 60000, maxBuffer: GH_MAX_BUFFER }).trim();
  const run = JSON.parse(gh(['api', `repos/${repo}/actions/runs/${runId}`]));
  const parents = JSON.parse(gh(['api', `repos/${repo}/commits/${commit}`])).parents;
  const parent = parents?.[0]?.sha;
  if (!/^[a-f0-9]{40}$/.test(parent || '')) throw new Error('Cannot determine first parent of version commit');
  const versionAt = sha => {
    const file = JSON.parse(gh(['api', `repos/${repo}/contents/package.json?ref=${sha}`]));
    if (file.encoding !== 'base64' || !file.content) throw new Error('Cannot read package.json version');
    return JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')).version;
  };
  const version = versionAt(commit);
  if (!versionChanged(version, versionAt(parent))) {
    console.log('不是版本号提交，跳过'); return;
  }
  const root = mkdtempSync(join(tmpdir(), 'android-early-'));
  try {
    gh(['run', 'download', runId, '--repo', repo, '-n', 'android-build-source', '-D', root]);
    const source = JSON.parse(readFileSync(join(root, 'android-build-source.json'), 'utf8'));
    validateEarlyTrigger(run, source, repo, commit);
    if (source.version !== version) throw new Error('Build metadata version differs from package.json');
    const record = await pinnedBuild(version, commit, url => fetch(url, {
      headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(30000),
    }));
    if (alreadyPublished(record, source, run)) { console.log('已发布，跳过'); return; }
    const comparison = JSON.parse(gh(['api', `repos/${repo}/compare/${commit}...main`, '--jq', '{status}']));
    if (!['ahead', 'identical'].includes(comparison.status)) throw new Error('Build source is no longer on main');
    const workflow = 'modelscope-android-publish.yml';
    const runs = () => JSON.parse(gh(['api', `repos/${repo}/actions/workflows/${workflow}/runs?per_page=30`, '--jq', RUNS_FIELDS])).workflow_runs;
    const baseline = Math.max(0, ...runs().map(r => r.id));
    gh(['workflow', 'run', workflow, '--repo', repo, '--ref', 'main', '-f', `commit=${commit}`, '-f', `run_id=${runId}`, '-f', 'dry_run=false']);
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      const next = runs().filter(r => r.id > baseline && r.event === 'workflow_dispatch' && r.head_branch === 'main').sort((a, b) => a.id - b.id)[0];
      if (next) { console.log(`Android publisher started: ${next.html_url}; source ${commit}, build ${runId}. Channel verification remains required.`); return; }
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
    throw new Error('Android publisher dispatch accepted but no new main run appeared');
  } finally { rmSync(root, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
