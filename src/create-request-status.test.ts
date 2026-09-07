import { readFileSync } from 'node:fs';
import { createRequestVerdict, timeoutMessage } from './create-request-status';

let passed = 0, total = 0;
const check = (name: string, ok: boolean) => { total++; if (ok) { passed++; console.log('✅', name); } else { console.error('❌', name); } };

check('null/undefined/missing status → unknown', createRequestVerdict(null).kind === 'unknown' && createRequestVerdict({}).kind === 'unknown');
const failed = createRequestVerdict({ status: 'failed', error: 'opencode-cli package entrypoint verification currently requires Linux', runtime: 'opencode-cli' });
check('failed carries the daemon error verbatim', failed.kind === 'failed' && failed.text === 'daemon 启动子节点失败:opencode-cli package entrypoint verification currently requires Linux');
check('rejected / capability-check-failed are failures with their own heads', createRequestVerdict({ status: 'rejected' }).text === 'daemon 拒绝了这次创建' && createRequestVerdict({ status: 'runtime_capability_check_failed', runtime: 'opencode-cli' }).text === 'daemon 说它不支持 opencode-cli runtime');
check('failed without error text still reads as a sentence', createRequestVerdict({ status: 'failed', error: '  ' }).text === 'daemon 启动子节点失败');
check('pending/delivered/started are waiting, in escalating words', ['pending', 'delivered', 'started'].map(st => createRequestVerdict({ status: st }).kind).join() === 'waiting,waiting,waiting' && createRequestVerdict({ status: 'started' }).text.startsWith('daemon 已启动'));
check('unknown status string is still waiting (never a false failure)', createRequestVerdict({ status: 'weird' }).kind === 'waiting');
check('timeout after started says the child never registered', timeoutMessage(createRequestVerdict({ status: 'started' })).includes('还没向 Hub 注册'));
check('timeout after pending says daemon may be offline', timeoutMessage(createRequestVerdict({ status: 'pending' })).includes('daemon 离线'));
check('timeout with unknown keeps the original honest line', timeoutMessage({ kind: 'unknown' }) === '已下发，但 24s 内未看到子节点注册。可能仍在拉起中——稍后到 Agents 列表查看。');
// 接线契约(向导 import react-native)
const wiz = readFileSync(new URL('./CreateNodeWizardScreen.tsx', import.meta.url), 'utf8');
check('wizard keeps request_id from createNode', wiz.includes('setRequestId(res.request_id ?? null);'));
check('wizard polls the create request and stops on a daemon-declared failure', wiz.includes('fetchCreateRequestStatus(cfg, requestId)') && wiz.includes("lastVerdict.kind === 'failed'") && wiz.includes("setPhase('error');"));
check('timeout message comes from the last verdict', wiz.includes('setMsg(timeoutMessage(lastVerdict));'));
const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
check('api reads /api/node-create-requests and treats 404 as unknown', api.includes('/api/node-create-requests?') && api.includes('if (res.status === 404) return null;'));
console.log(`create request status: ${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);
