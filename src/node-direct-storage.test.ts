// Unit tests for node external-storage direct transfer status in NodeDetailScreen.
// Run: bun src/node-direct-storage.test.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nodeDirectStorageStatus, parseNodeVersion } from './node-direct-storage';
import { nodeInfoFacts } from './node-info';
import { PRIMARY_FACT_LABELS, splitOverviewFacts } from './node-page-model';

let pass = 0;
let total = 0;
const ck = (name: string, ok: boolean, extra = '') => {
  total++;
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name}${extra ? ` (${extra})` : ''}`);
  }
};

const hubS3 = { supported: true, configured: true, enabled: true, provider: 's3' as const };
const hubOss = { supported: true, configured: true, enabled: true, provider: 'oss' as const };
const hubOff = { supported: true, configured: false, enabled: false, provider: 's3' as const };

console.log('# 1 parseNodeVersion');
{
  const p = parseNodeVersion('2.5.0-preview.238');
  ck('parses agent-node preview version', p?.major === 2 && p.minor === 5 && p.patch === 0 && p.preview === 238);
  const stable = parseNodeVersion('v2.5.0');
  ck('parses stable version with leading v', stable?.major === 2 && stable.minor === 5 && stable.preview === null);
  ck('rejects empty / invalid versions', parseNodeVersion('') === null && parseNodeVersion(null) === null && parseNodeVersion('not-a-ver') === null);
}

console.log('# 2 agent-node version thresholds');
{
  const v238 = nodeDirectStorageStatus({ session: { agent: 'agent-node:opencode', version: '2.5.0-preview.238' }, hubStorage: hubS3 });
  ck('agent-node .238 with Hub S3 → ok + 已支持 · 直传 AWS S3', v238.kind === 'supported' && v238.tone === 'ok' && v238.label === '已支持 · 直传 AWS S3');

  const v238Oss = nodeDirectStorageStatus({ session: { agent: 'agent-node:antigravity', version: '2.5.0-preview.238' }, hubStorage: hubOss });
  ck('agent-node .238 with Hub OSS → 已支持 · 直传 阿里云 OSS', v238Oss.kind === 'supported' && v238Oss.label === '已支持 · 直传 阿里云 OSS');

  const v238Off = nodeDirectStorageStatus({ session: { agent: 'agent-node:opencode', version: '2.5.0-preview.238' }, hubStorage: hubOff });
  ck('agent-node .238 when Hub external storage off → muted node-ready copy', v238Off.kind === 'supported' && v238Off.tone === 'muted' && v238Off.label.includes('节点已支持'));

  const v237 = nodeDirectStorageStatus({ session: { agent: 'agent-node:antigravity', version: '2.5.0-preview.237' }, hubStorage: hubS3 });
  ck('agent-node .237 → supported_basic + ok', v237.kind === 'supported_basic' && v237.tone === 'ok' && v237.label === '已支持 · 直传 AWS S3（基础版）');

  const v236 = nodeDirectStorageStatus({ session: { agent: 'agent-node:opencode', version: '2.5.0-preview.236' }, hubStorage: hubS3 });
  ck('agent-node .236 → supported_basic', v236.kind === 'supported_basic' && v236.tone === 'ok');

  const v235 = nodeDirectStorageStatus({ session: { agent: 'agent-node:opencode', version: '2.5.0-preview.235' }, hubStorage: hubS3 });
  ck('agent-node .235 → unsupported + warn', v235.kind === 'unsupported' && v235.tone === 'warn' && v235.label.includes('未支持'));

  const v207 = nodeDirectStorageStatus({ session: { agent: 'agent-node:opencode', version: '2.5.0-preview.207' }, hubStorage: hubS3 });
  ck('agent-node .207 → unsupported + warn', v207.kind === 'unsupported' && v207.tone === 'warn');
}

console.log('# 3 claude-code (@sleep2agi/agent-network) version thresholds');
{
  const cc274 = nodeDirectStorageStatus({ session: { agent: 'claude-code', version: '2.3.0-preview.274' }, hubStorage: hubS3 });
  ck('claude-code .274 with Hub S3 → supported + ok', cc274.kind === 'supported' && cc274.tone === 'ok' && cc274.label === '已支持 · 直传 AWS S3');

  const cc273 = nodeDirectStorageStatus({ session: { agent: 'claude-code', version: '2.3.0-preview.273' }, hubStorage: hubS3 });
  ck('claude-code .273 → unsupported + warn', cc273.kind === 'unsupported' && cc273.tone === 'warn');

  const cc243 = nodeDirectStorageStatus({ session: { agent: 'claude-code', version: '2.3.0-preview.243' }, hubStorage: hubS3 });
  ck('claude-code .243 → unsupported + warn', cc243.kind === 'unsupported' && cc243.tone === 'warn');

  const ccNull = nodeDirectStorageStatus({ session: { agent: 'claude-code', version: null }, hubStorage: hubS3 });
  ck('claude-code with unreported version → unknown + muted (honest)', ccNull.kind === 'unknown' && ccNull.tone === 'muted' && ccNull.label.includes('未确认'));
}

console.log('# 4 explicit direct_storage_capable & third-party runtime');
{
  const explicit = nodeDirectStorageStatus({ session: { agent: 'custom', version: null, direct_storage_capable: true }, hubStorage: hubS3 });
  ck('explicit direct_storage_capable=true overrides missing version', explicit.kind === 'supported' && explicit.tone === 'ok');

  const tmwork = nodeDirectStorageStatus({ session: { agent: 'tmwork-opencode-plugin', version: '1.20.14-alpha.803' }, hubStorage: hubS3 });
  ck('tmwork plugin 1.20.x → unsupported', tmwork.kind === 'unsupported' && tmwork.tone === 'warn');
}

console.log('# 5 NodeDetailScreen & nodeInfoFacts wiring');
{
  const facts = nodeInfoFacts(
    { alias: '通信鸽2号', status: 'idle', agent: 'agent-node:antigravity', version: '2.5.0-preview.238' },
    { node_id: 'n_p2', alias: '通信鸽2号' },
    'https://hub.example',
    hubS3,
  );
  const f = facts.find(x => x.label === '文件直传');
  ck('nodeInfoFacts emits 文件直传 with testID node-direct-storage', f?.value === '已支持 · 直传 AWS S3' && f.tone === 'ok' && f.testID === 'node-direct-storage');
  ck('PRIMARY_FACT_LABELS includes 文件直传 so it shows in Overview without expanding', PRIMARY_FACT_LABELS.includes('文件直传') && splitOverviewFacts(facts).primary.some(x => x.label === '文件直传'));

  const root = join(import.meta.dir, '..');
  const detail = readFileSync(join(root, 'src/NodeDetailScreen.tsx'), 'utf8');
  ck('NodeDetailScreen subscribes to hubStorage and passes it to nodeInfoFacts',
    detail.includes('useSyncExternalStore(subscribeHubStorage, getHubStorageSnapshot, getHubStorageSnapshot)')
    && detail.includes('nodeInfoFacts(s, node, cfg.serverUrl, hubStorage)'));
  const mod = readFileSync(join(root, 'src/node-direct-storage.ts'), 'utf8');
  ck('Zero forbidden npm install command strings in UI source', !/npm\s+(i|install|add)\b/.test(mod));
}

console.log(`\nnode-direct-storage: ${pass}/${total} passed`);
if (pass !== total) process.exit(1);
