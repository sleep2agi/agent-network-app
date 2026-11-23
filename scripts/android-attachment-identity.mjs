import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { mirrorFetch } from './android-mirror-fetch.mjs';

const BASE = 'https://modelscope.cn/datasets/SmartFlowAI/agent-network-releases/resolve/master/android';
export async function verifyEarlyAttachment({ version, commit, apkSha256, get = fetch }) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid attachment identity');
  const response = await get(`${BASE}/${version}/publication.json`);
  if (response.status === 404) {
    // An APK without the expected provenance is not proof of a safe first upload.
    const apk = await get(`${BASE}/agent-network-${version}.apk`, { method: 'HEAD' });
    if (apk.status !== 404) throw new Error('Mirror APK exists or cannot be checked without publication identity');
    return 'not-published';
  }
  if (!response.ok) throw new Error(`Publication identity HTTP ${response.status}`);
  const identity = await response.json();
  if (identity.schemaVersion !== 1 || identity.repository !== 'sleep2agi/agent-network-app'
    || identity.version !== version || identity.commit !== commit || identity.apkSha256 !== apkSha256)
    throw new Error('Desktop attachment differs from immutable early Android publication');
  const apk = await get(`${BASE}/agent-network-${version}.apk`);
  if (!apk.ok) throw new Error(`Early Android APK HTTP ${apk.status}`);
  const hash = createHash('sha256');
  for await (const chunk of apk.body) hash.update(chunk);
  if (hash.digest('hex') !== apkSha256) throw new Error('Early Android mirror bytes differ from attachment');
  return 'same-bytes';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [version, commit, path] = process.argv.slice(2);
  verifyEarlyAttachment({ version, commit, apkSha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    get: mirrorFetch(),
  }).then(result => console.log(result)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
