// #4827 接线：hub list 响应里的 pending → 节点密钥页的 SecretRequestCard。
import { readFileSync } from 'node:fs';
import { mergeNodeSecretKeys, normalizePendingSecretRequests } from './scoped-secrets';

let p = 0, t = 0;
const ck = (n: string, ok: boolean, extra?: unknown) => { t++; if (ok) { p++; console.log('✅', n); } else console.log('❌', n, extra === undefined ? '' : JSON.stringify(extra)); };

ck('合法行全保留（key/label/requested_at/by_node_id）', JSON.stringify(normalizePendingSecretRequests([
  { key: 'GITHUB_TOKEN', label: 'GitHub 密钥', requested_at: '2026-11-20T19:00:00Z', by_node_id: 'n1' },
])) === JSON.stringify([{ key: 'GITHUB_TOKEN', label: 'GitHub 密钥', requested_at: '2026-11-20T19:00:00Z', by_node_id: 'n1' }]));
ck('非法 key 被丢弃，不整份拒绝', JSON.stringify(normalizePendingSecretRequests([
  { key: 'lower-case' }, { key: 'OK_KEY' },
])) === JSON.stringify([{ key: 'OK_KEY' }]));
ck('非数组/空数组 → undefined（hub 的字段缺省语义）', normalizePendingSecretRequests(undefined) === undefined && normalizePendingSecretRequests([]) === undefined);
ck('最多 8 条', (normalizePendingSecretRequests(Array.from({ length: 20 }, (_, i) => ({ key: `K_${i}` }))) ?? []).length === 8);

const section = readFileSync(new URL('./ScopedSecretsSection.tsx', import.meta.url), 'utf8');
ck('密钥页渲染举手卡片（REST pending + snapshot.pending 去重），已配置的不出现', /pendingRest/.test(section) && /<SecretRequestCard/.test(section) && /!(displayedKeys|snapshot\?\.keys)\.some/.test(section));
ck('保存走既有的 put 流程并带 revision（无 snapshot 时即时拉取）', /action:\s*'put',\s*key:\s*p\.key,\s*value:\s*v/.test(section) && /resolveRevisionForWrite/.test(section));
ck('Daemon 托管节点合并展示独立 node-secrets.json 键名且独立键覆盖 Daemon 默认 (#5505)', JSON.stringify(mergeNodeSecretKeys(
  [{ key: 'A_KEY', source: 'daemon' }, { key: 'B_KEY', source: 'node' }],
  [{ key: 'A_KEY', source: 'node' }, { key: 'GITHUB_TOKEN', source: 'node' }],
)) === JSON.stringify([
  { key: 'A_KEY', source: 'node', independentOnly: true },
  { key: 'B_KEY', source: 'node' },
  { key: 'GITHUB_TOKEN', source: 'node', independentOnly: true },
]));
const chatCard = readFileSync(new URL('./ChatSecretCard.tsx', import.meta.url), 'utf8');
ck('聊天密钥卡保存后提供立即重启按钮 (#5505)', chatCard.includes('runNodeLifecycleAction') && chatCard.includes('立即重启使其生效'));
const api = readFileSync(new URL('./scoped-secrets.ts', import.meta.url), 'utf8');
ck('pending 从 list 响应透传进 snapshot', /normalizePendingSecretRequests\(\(request as any\)\?\.pending\)/.test(api));
ck('REST GET /secrets 读 pending（轮询端点不带）', /fetchNodeSecretRequests/.test(readFileSync(new URL('./api.ts', import.meta.url), 'utf8')));

console.log(`secret-request-wiring: ${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
