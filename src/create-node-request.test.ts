// 看板 #595(agent-network #2410):「Codex（TUI 共存）」建节点必须带 node_spec.flags.copresence=true,
// 老 Hub/daemon 的 flag_key_unknown 与目标机缺依赖的 runtime_capability_check_failed 要说人话。
import { readFileSync } from 'node:fs';
import { buildCreateNodeSpec, copresenceFlags, describeCopresenceError, COPRESENCE_TOO_OLD, COPRESENCE_MISSING_DEPS } from './create-node-request';
import { createRequestVerdict } from './create-request-status';

let passed = 0, total = 0;
const check = (name: string, ok: boolean) => { total++; if (ok) { passed++; console.log('✅', name); } else { console.error('❌', name); } };

const base = { name: ' demo ', model: '', permissionMode: 'default', maxTurns: '', budget: '', workdirField: {} };

// ── 请求体 ──
const codex = buildCreateNodeSpec({ ...base, runtimeId: 'codex-app-server', runtimeModels: [] });
check('🔴 codex-app-server → flags.copresence === true', codex.flags?.copresence === true);
// #591:codex-app-server 不读 permissionMode,不再发(见 create-node-params.test.ts)。
check('codex-app-server sends no permissionMode and omits model (co-presence follows the TUI login)', !('permissionMode' in (codex.flags ?? {})) && !('model' in codex) && codex.runtime === 'codex-app-server' && codex.name === 'demo');
for (const rt of ['claude-agent-sdk', 'codex-sdk', 'grok-build-acp', 'claude-code-cli', 'grok-build-cli', 'opencode-cli']) {
  const s = buildCreateNodeSpec({ ...base, runtimeId: rt, runtimeModels: ['m1'] });
  check(`${rt} → no copresence key at all (hub rejects it for other runtimes)`, !('copresence' in (s.flags ?? {})));
}
check('copresenceFlags is the single switch', JSON.stringify(copresenceFlags('codex-app-server')) === '{"copresence":true}' && JSON.stringify(copresenceFlags('codex-sdk')) === '{}');
const full = buildCreateNodeSpec({ ...base, runtimeId: 'claude-agent-sdk', runtimeModels: ['deepseek-v4-pro'], maxTurns: '5', budget: ' ', workdirField: { workdir: '/home/alice/demo' } });
check('other fields: first suggested model, numeric flags, blank omitted, no timeout (#591), workdir passed through',
  full.model === 'deepseek-v4-pro' && full.flags?.maxTurns === 5 && !('budget' in (full.flags ?? {})) && !('timeout' in (full.flags ?? {})) && full.workdir === '/home/alice/demo');
check('explicit model wins over suggestion', buildCreateNodeSpec({ ...base, model: 'x', runtimeId: 'claude-agent-sdk', runtimeModels: ['y'] }).model === 'x');

// ── 报错 ──
check('hub flag_key_unknown with field=copresence → upgrade copy', describeCopresenceError({ error: 'flag_key_unknown', field: 'copresence' }) === COPRESENCE_TOO_OLD);
check('daemon "validate: flag_key_unknown:copresence" → upgrade copy', describeCopresenceError({ error: 'validate: flag_key_unknown:copresence' }) === COPRESENCE_TOO_OLD);
check('upgrade copy names no invented version, says 最新预览版', !/\d+\.\d+/.test(COPRESENCE_TOO_OLD) && COPRESENCE_TOO_OLD.includes('最新预览版'));
check('flag_key_unknown for another field is NOT the copresence copy', describeCopresenceError({ error: 'flag_key_unknown', field: 'maxTurns' }) === null && describeCopresenceError({ error: 'validate: flag_key_unknown:budget' }) === null);
const cap = describeCopresenceError({ status: 'runtime_capability_check_failed', runtime: 'codex-app-server', error: 'child died within 5000ms post-spawn' });
check('runtime_capability_check_failed for codex → tmux/codex/login copy + server detail', !!cap && cap.startsWith(COPRESENCE_MISSING_DEPS) && cap.includes('tmux') && cap.includes('codex login') && cap.includes('child died within 5000ms post-spawn'));
check('capability failure without detail → copy alone', describeCopresenceError({ status: 'runtime_capability_check_failed', runtime: 'codex-app-server' }) === COPRESENCE_MISSING_DEPS);
check('capability failure as an error string (hub ok:false) also maps, prefix stripped', describeCopresenceError({ error: 'runtime_capability_check_failed: no tmux', runtime: 'codex-app-server' }) === `${COPRESENCE_MISSING_DEPS}\n服务器原话：no tmux`);
check('capability failure for another runtime / unknown runtime keeps the old wording', describeCopresenceError({ status: 'runtime_capability_check_failed', runtime: 'opencode-cli', error: 'x' }) === null && describeCopresenceError({ status: 'runtime_capability_check_failed', error: 'x' }) === null);
check('unrelated error → null', describeCopresenceError({ error: 'workdir_is_home' }) === null && describeCopresenceError({}) === null);

// ── 创建请求轮询(daemon 侧的同两种失败) ──
const v1 = createRequestVerdict({ status: 'rejected', error: 'validate: flag_key_unknown:copresence', runtime: 'codex-app-server' });
check('🔴 poll: daemon rejected copresence → failed with upgrade copy', v1.kind === 'failed' && v1.text === COPRESENCE_TOO_OLD);
const v2 = createRequestVerdict({ status: 'runtime_capability_check_failed', error: 'child died', runtime: 'codex-app-server' });
check('🔴 poll: codex capability failure → failed with tmux/codex/login copy + detail', v2.kind === 'failed' && v2.text.startsWith(COPRESENCE_MISSING_DEPS) && v2.text.includes('child died'));
check('poll: opencode capability failure unchanged', createRequestVerdict({ status: 'runtime_capability_check_failed', runtime: 'opencode-cli' }).text === 'daemon 说它不支持 opencode-cli runtime');

// ── 接线契约(向导 import react-native,只能读源码) ──
const wiz = readFileSync(new URL('./CreateNodeWizardScreen.tsx', import.meta.url), 'utf8');
const submit = wiz.slice(wiz.indexOf('const handleSubmit'), wiz.indexOf('// ── render'));
check('🔴 handleSubmit builds node_spec with buildCreateNodeSpec (the only place flags.copresence is set)', /node_spec[^=]*=\s*buildCreateNodeSpec\(/.test(submit) && !/flags:\s*\{/.test(submit));
check('🔴 handleSubmit maps the create error through describeCopresenceError with field + runtime', submit.includes('describeCopresenceError({ error: res.error, field: res.field, runtime: runtimeId })'));
check('「Codex（TUI 共存）」 row is runtime codex-app-server', /id: 'codex-app-server', label: 'Codex（TUI 共存）'/.test(wiz));
const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
check('🔴 createNode keeps the hub validation field (flag_key_unknown → field)', api.includes("typeof payload.field === 'string' ? { field: payload.field } : {}") && api.includes('field?: string };'));

console.log(`create node request: ${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);
