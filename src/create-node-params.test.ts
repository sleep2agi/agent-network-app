// 看板 #591(父 #583):新建节点向导第 4 步「参数」只显示该 runtime 真会读的设置,
// 没读的不显示、也不发进 create_node 请求。依据见 create-node-request.ts 的 WIZARD_RUNTIME_PARAMS 注释
// (agent-node/src/cli.ts、agent-network/bin/cli.ts、server/src/create-node-validate.ts 逐条 file:line)。
import { readFileSync } from 'node:fs';
import { buildCreateNodeSpec, wizardParamsFor, WIZARD_RUNTIME_PARAMS, NO_PARAMS_LINE } from './create-node-request';

let passed = 0, total = 0;
const check = (name: string, ok: boolean) => { total++; if (ok) { passed++; console.log('✅', name); } else { console.error('❌', name); } };

const ALL = ['claude-agent-sdk', 'codex-sdk', 'grok-build-acp', 'claude-code-cli', 'codex-app-server', 'grok-build-cli', 'opencode-cli'];

// ── 适用矩阵 ──
check('🔴 claude-agent-sdk → permissionMode + maxTurns + budget (in that order)',
  JSON.stringify(wizardParamsFor('claude-agent-sdk')) === '["permissionMode","maxTurns","budget"]');
for (const rt of ALL.filter(r => r !== 'claude-agent-sdk')) {
  check(`🔴 ${rt} → no wizard params (agent-node / anet launcher never reads them for this runtime)`, wizardParamsFor(rt).length === 0);
}
check('unknown runtime → no params (fail closed: never show a knob we cannot vouch for)', wizardParamsFor('made-up-runtime').length === 0);
check('🔴 timeout is offered for NO runtime (hub caps it at 86400 but agent-node reads it as ms)',
  ALL.every(rt => !(wizardParamsFor(rt) as readonly string[]).includes('timeout')));
check('matrix only names known runtimes', Object.keys(WIZARD_RUNTIME_PARAMS).every(k => ALL.includes(k)));
check('plain no-params line', NO_PARAMS_LINE === '这个 runtime 没有额外参数，直接下一步');

// ── 请求体:隐藏的设置不发 ──
const typed = { name: 'demo', model: '', permissionMode: 'plan', maxTurns: '7', budget: '2.5', workdirField: {} };
const claude = buildCreateNodeSpec({ ...typed, runtimeId: 'claude-agent-sdk', runtimeModels: ['deepseek-v4-pro'] });
check('🔴 claude-agent-sdk sends permissionMode / maxTurns / budget it shows',
  JSON.stringify(claude.flags) === '{"permissionMode":"plan","maxTurns":7,"budget":2.5}');
check('claude-agent-sdk blank limits are omitted, permissionMode kept',
  JSON.stringify(buildCreateNodeSpec({ ...typed, maxTurns: ' ', budget: '', runtimeId: 'claude-agent-sdk', runtimeModels: ['m'] }).flags) === '{"permissionMode":"plan"}');
const codexCo = buildCreateNodeSpec({ ...typed, runtimeId: 'codex-app-server', runtimeModels: [] });
check('🔴 Codex（TUI 共存）: flags is exactly {copresence:true} even if stale values were typed under Claude',
  JSON.stringify(codexCo.flags) === '{"copresence":true}' && !('model' in codexCo));
for (const rt of ['codex-sdk', 'grok-build-acp', 'claude-code-cli', 'grok-build-cli', 'opencode-cli']) {
  const s = buildCreateNodeSpec({ ...typed, runtimeId: rt, runtimeModels: ['m1'] });
  check(`🔴 ${rt}: no flags key at all (nothing applicable, hub flags are optional)`, !('flags' in s) && s.runtime === rt);
}

// ── 接线契约(向导 import react-native,只能读源码) ──
const wiz = readFileSync(new URL('./CreateNodeWizardScreen.tsx', import.meta.url), 'utf8');
const step3 = wiz.slice(wiz.indexOf('{step === 3 && ('), wiz.indexOf('{step === 4 && ('));
check('🔴 step 4 renders from wizardParamsFor(runtimeId)', /wizardParamsFor\(runtimeId\)/.test(wiz) && step3.includes('params.includes('));
check('🔴 step 4 shows NO_PARAMS_LINE when the runtime has none', step3.includes('NO_PARAMS_LINE'));
check('🔴 the timeout input is gone from the wizard', !/setTimeoutMs|>timeout</.test(wiz));
const step4 = wiz.slice(wiz.indexOf('{step === 4 && ('));
check('confirm page summarises only applicable params', step4.includes("params.includes('permissionMode')") && !step4.includes('maxTurns / budget / timeout'));

console.log(`create node params: ${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);
