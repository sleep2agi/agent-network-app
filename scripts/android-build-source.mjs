import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function downloadAndroidBuildSource({ repository, run, token, json }) {
  const response = await json('GET', `/repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`);
  const artifacts = (response.artifacts ?? []).filter(a => a.name === 'android-build-source' && !a.expired);
  if (artifacts.length === 0) return null;
  if (artifacts.length !== 1) throw new Error('ambiguous Android source artifacts');
  const directory = await mkdtemp(join(tmpdir(), 'anet-android-source-'));
  try {
    await execFileAsync('gh', ['run', 'download', String(run.id), '--repo', repository,
      '-n', 'android-build-source', '-D', directory], {
      env: { ...process.env, GH_TOKEN: token }, timeout: 60000, maxBuffer: 1024 * 1024,
    });
    return JSON.parse(await readFile(join(directory, 'android-build-source.json'), 'utf8'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// Validate source metadata downloaded from the selected successful build run.
export function validateAndroidBuildSource(source, { repository, run, commit, apkSha256 }) {
  if (!run || run.head_branch !== 'main' || run.status !== 'completed' || run.conclusion !== 'success'
    || run.path !== '.github/workflows/android-build.yml') {
    throw new Error('source run must be a successful android-build on main');
  }
  if (!source || source.schemaVersion !== 1 || source.repository !== repository
    || String(source.runId) !== String(run.id)
    || String(source.runAttempt) !== String(run.run_attempt)) {
    throw new Error('source metadata does not match the repository/run/attempt');
  }
  if (!/^[0-9a-f]{40}$/.test(commit ?? '') || source.commit !== commit) {
    throw new Error('source metadata commit mismatch');
  }
  const version = /^(\d+)\.(\d+)\.(\d+)$/.exec(source.version ?? '');
  if (!version || !Number.isSafeInteger(source.versionCode)
    || source.versionCode !== Number(version[1]) * 1000000 + Number(version[2]) * 1000 + Number(version[3])) {
    throw new Error('source metadata version mismatch');
  }
  if (!/^[0-9a-f]{64}$/.test(source.apkSha256 ?? '')
    || (apkSha256 !== undefined && source.apkSha256 !== apkSha256)) {
    throw new Error('source metadata APK digest mismatch');
  }
  return source;
}

// Metadata is fetched from each run's own artifact, never from its display title.
export async function selectVerifiedDispatchedBuild(runs, { repository, commit, loadSource }) {
  const candidates = (Array.isArray(runs) ? runs : [])
    .filter(run => run?.event === 'workflow_dispatch' && run.head_branch === 'main'
      && run.status === 'completed' && run.conclusion === 'success'
      && run.path === '.github/workflows/android-build.yml')
    .sort((a, b) => b.id - a.id);
  for (const run of candidates) {
    const source = await loadSource(run);
    if (!source || source.commit !== commit) continue;
    validateAndroidBuildSource(source, { repository, run, commit });
    return run;
  }
  return null;
}

// CLI: source metadata, GitHub run response, expected repository, commit, APK.
// Read-only; consumers must stop on failure before uploading anything.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const [sourcePath, runPath, repository, commit, apkPath] = process.argv.slice(2);
    if (!sourcePath || !runPath || !repository || !commit || !apkPath) {
      throw new Error('usage: android-build-source.mjs source.json run.json repository commit apk');
    }
    const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
    const run = JSON.parse(readFileSync(runPath, 'utf8'));
    const apkSha256 = createHash('sha256').update(readFileSync(apkPath)).digest('hex');
    validateAndroidBuildSource(source, { repository, run, commit, apkSha256 });
    console.log(JSON.stringify({ commit: source.commit, version: source.version, apkSha256 }));
  } catch (error) {
    console.error(`Android source verification failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
