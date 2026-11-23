import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function pinnedBuild(version, commit, get = fetch) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid requested source');
  const response = await get(`https://modelscope.cn/datasets/SmartFlowAI/agent-network-releases/resolve/master/android/${version}/publication.json`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Publication record HTTP ${response.status}`);
  const record = await response.json();
  if (record.schemaVersion !== 1 || record.repository !== 'sleep2agi/agent-network-app'
      || record.version !== version || record.commit !== commit
      || record.artifactName !== 'agent-network-android-apk'
      || !/^sha256:[a-f0-9]{64}$/.test(record.artifactDigest || '')
      || !/^[a-f0-9]{64}$/.test(record.apkSha256 || '')
      || ['runId', 'runAttempt', 'artifactId'].some(k => !Number.isSafeInteger(record[k]) || record[k] <= 0))
    throw new Error('Invalid immutable Android publication record');
  return record;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  pinnedBuild(process.argv[2], process.argv[3], url => fetch(url, {
    headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(30000),
  })).then(record => {
    if (record) appendFileSync(process.env.GITHUB_OUTPUT,
      `run_id=${record.runId}\nrun_attempt=${record.runAttempt}\nartifact_id=${record.artifactId}\nartifact_digest=${record.artifactDigest.slice(7)}\n`);
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
