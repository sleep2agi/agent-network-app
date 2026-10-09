import { readFileSync } from 'node:fs';
import { creationConfirmed, createRequestVerdict, timeoutMessage } from './create-request-status';

let passed = 0, total = 0;
const check = (name: string, ok: boolean) => { total++; if (ok) { passed++; console.log('✅', name); } else { console.error('❌', name); } };

check('null/undefined/missing status → unknown', createRequestVerdict(null).kind === 'unknown' && createRequestVerdict({}).kind === 'unknown');
const failed = createRequestVerdict({ status: 'failed', error: 'opencode-cli package entrypoint verification currently requires Linux', runtime: 'opencode-cli' });
check('failed carries the daemon error verbatim', failed.kind === 'failed' && failed.text === 'daemon 启动子节点失败:opencode-cli package entrypoint verification currently requires Linux');
check('rejected / capability-check-failed are failures with their own heads', createRequestVerdict({ status: 'rejected' }).text === 'daemon 拒绝了这次创建' && createRequestVerdict({ status: 'runtime_capability_check_failed', runtime: 'opencode-cli' }).text === 'daemon 说它不支持 opencode-cli runtime');
check('failed without error text still reads as a sentence', createRequestVerdict({ status: 'failed', error: '  ' }).text === 'daemon 启动子节点失败');
check('pending/delivered/started are waiting, in escalating words', ['pending', 'delivered', 'started'].map(st => createRequestVerdict({ status: st }).kind).join() === 'waiting,waiting,waiting' && createRequestVerdict({ status: 'started' }).text.startsWith('daemon 已启动'));
check('unknown status string is still waiting (never a false failure)', createRequestVerdict({ status: 'weird' }).kind === 'waiting');
check('timeout after started says registration is unconfirmed', timeoutMessage(createRequestVerdict({ status: 'started' })).includes('还没确认向 Hub 注册'));
check('timeout after pending says daemon may be offline', timeoutMessage(createRequestVerdict({ status: 'pending' })).includes('daemon 离线'));
check('timeout with unknown never claims success', timeoutMessage({ kind: 'unknown' }).includes('未确认本次创建'));
check('registration without launch proof has an honest timeout', timeoutMessage(createRequestVerdict({ status: 'succeeded' })).includes('未确认本次启动检查'));
const expected = { requestId: 'cr_test', name: '测试牛', runtime: 'opencode-cli', requireLaunchVerification: true };
const row = { request_id: 'cr_test', child_name: '测试牛', child_node_id: 'node_test', runtime: 'opencode-cli', status: 'succeeded', launch_verified_at: 1234 };
const sessions = [{ node_id: 'node_test', alias: '测试牛', status: 'idle' }];
check('exact registered and verified live child confirms', creationConfirmed(row, expected, sessions));
check('busy child also confirms', creationConfirmed(row, expected, [{ ...sessions[0], status: 'busy' }]));
for (const status of ['failed', 'rejected', 'runtime_capability_check_failed', 'pending', 'delivered', 'started', 'unknown']) {
  check(`${status} never confirms despite a visible alias`, !creationConfirmed({ ...row, status }, expected, sessions));
}
for (const launch_verified_at of [undefined, null, 0, -1, NaN, Infinity]) {
  check(`absent/invalid launch proof ${launch_verified_at} stays unconfirmed`, !creationConfirmed({ ...row, launch_verified_at }, expected, sessions));
}
for (const patch of [{ request_id: 'cr_other' }, { child_name: 'other' }, { runtime: 'codex-sdk' }, { child_node_id: 'node_old' }, { child_node_id: undefined }]) {
  check(`identity mismatch ${JSON.stringify(patch)} never confirms`, !creationConfirmed({ ...row, ...patch }, expected, sessions));
}
check('old Hub/null response stays unconfirmed', !creationConfirmed(null, expected, sessions));
for (const status of ['offline', 'unknown', 'stopped', 'starting']) {
  check(`roster ${status} is not live proof`, !creationConfirmed(row, expected, [{ ...sessions[0], status }]));
}
check('other runtime does not require OpenCode proof', creationConfirmed({ ...row, runtime: 'codex-sdk', launch_verified_at: undefined }, { ...expected, runtime: 'codex-sdk', requireLaunchVerification: false }, sessions));
check('legacy V1 keeps registered-node success without V2-only proof', creationConfirmed({ ...row, launch_verified_at: undefined }, { ...expected, requireLaunchVerification: false }, sessions));
// 接线契约(向导 import react-native)
const wiz = readFileSync(new URL('./CreateNodeWizardScreen.tsx', import.meta.url), 'utf8');
check('wizard keeps request_id from createNode', wiz.includes('setRequestId(res.request_id ?? null);'));
check('wizard polls the create request and stops on a daemon-declared failure', wiz.includes('fetchCreateRequestStatus(cfg, requestId)') && wiz.includes("lastVerdict.kind === 'failed'") && wiz.includes("setPhase('error');"));
check('timeout message comes from the last verdict', wiz.includes('setMsg(timeoutMessage(lastVerdict));'));
check('no alias-only success shortcut remains', !wiz.includes('list.some(s => s?.alias === want)') && wiz.includes('creationConfirmed(latest,'));
check('request checked before roster and rechecked after', wiz.indexOf('const row = await fetchCreateRequestStatus') < wiz.indexOf('const data = await fetchStatus') && wiz.indexOf('const latest = await fetchCreateRequestStatus') > wiz.indexOf('const data = await fetchStatus'));
check('cleanup invalidates inflight requests and recursive timers', wiz.includes('active = false; clearTimeout(timer);') && wiz.includes('if (!alive()) return;'));
check('V2 proof requirement comes from the submitted flags', wiz.includes("requireLaunchVerification: submittedSpec.current?.flags?.opencodeGeneration === 'v2'") && wiz.includes('submittedSpec.current = node_spec;'));
const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
check('api reads /api/node-create-requests and treats 404 as unknown', api.includes('/api/node-create-requests?') && api.includes('if (res.status === 404) return null;'));
console.log(`create request status: ${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);
