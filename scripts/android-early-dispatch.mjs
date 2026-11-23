import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateAndroidBuildSource } from './android-build-source.mjs';

export function validateEarlyTrigger(run, source, repository, commit) {
  if (repository !== 'sleep2agi/agent-network-app' || run.event !== 'push'
      || run.head_repository?.full_name !== repository || run.head_sha !== commit)
    throw new Error('Early publication requires the original version push in the App repository');
  return validateAndroidBuildSource(source, { repository, run, commit });
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY, runId = process.env.BUILD_RUN_ID, commit = process.env.BUILD_COMMIT;
  if (!/^\d+$/.test(runId || '') || !/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('Invalid run/commit');
  const gh = args => execFileSync('gh', args, { encoding: 'utf8', timeout: 60000 }).trim();
  const run = JSON.parse(gh(['api', `repos/${repo}/actions/runs/${runId}`]));
  const root = mkdtempSync(join(tmpdir(), 'android-early-'));
  try {
    gh(['run', 'download', runId, '--repo', repo, '-n', 'android-build-source', '-D', root]);
    const source = JSON.parse(readFileSync(join(root, 'android-build-source.json'), 'utf8'));
    validateEarlyTrigger(run, source, repo, commit);
    const comparison = JSON.parse(gh(['api', `repos/${repo}/compare/${commit}...main`]));
    if (!['ahead', 'identical'].includes(comparison.status)) throw new Error('Build source is no longer on main');
    const workflow = 'modelscope-android-publish.yml';
    const runs = () => JSON.parse(gh(['api', `repos/${repo}/actions/workflows/${workflow}/runs?per_page=100`])).workflow_runs;
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
