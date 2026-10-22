import { buildCreateNodeSpec } from './create-node-request';
import {
  codexYoloFlagsForCreate,
  CODEX_EXECUTION_TOO_OLD,
  describeCodexExecutionFlagError,
  isCodexAutoExecuteActive,
} from './codex-execution-posture';

let passed = 0, total = 0;
const check = (name: string, ok: boolean) => { total++; if (ok) { passed++; console.log('✅', name); } else { console.error('❌', name); } };

check('yolo flags match backend codexSdkYoloFlags shape',
  JSON.stringify(codexYoloFlagsForCreate('codex-sdk', true)) === '{"approvalPolicy":"never","sandboxMode":"danger-full-access","skipGitRepoCheck":true}');
check('codex-app-server adds copresenceFullAccess for TUI',
  JSON.stringify(codexYoloFlagsForCreate('codex-app-server', true)) === '{"approvalPolicy":"never","sandboxMode":"danger-full-access","skipGitRepoCheck":true,"copresenceFullAccess":true}');
check('autoExecute false → no yolo flags', Object.keys(codexYoloFlagsForCreate('codex-sdk', false)).length === 0);
check('isCodexAutoExecuteActive when all three set', isCodexAutoExecuteActive({ approvalPolicy: 'never', sandboxMode: 'danger-full-access', skipGitRepoCheck: true }));
check('partial flags → inactive', !isCodexAutoExecuteActive({ approvalPolicy: 'never', sandboxMode: 'read-only' }));
const codexCo = buildCreateNodeSpec({
  name: 'demo', runtimeId: 'codex-app-server', runtimeModels: [], model: '', permissionMode: 'plan', maxTurns: '7', budget: '2.5', workdirField: {},
});
check('create spec merges copresence + yolo', JSON.stringify(codexCo.flags) === '{"copresence":true,"approvalPolicy":"never","sandboxMode":"danger-full-access","skipGitRepoCheck":true,"copresenceFullAccess":true}');
check('flag_key_unknown approvalPolicy → upgrade copy', describeCodexExecutionFlagError({ error: 'flag_key_unknown', field: 'approvalPolicy' }) === CODEX_EXECUTION_TOO_OLD);
check('unrelated flag error → null', describeCodexExecutionFlagError({ error: 'flag_key_unknown', field: 'maxTurns' }) === null);

console.log(`codex execution posture: ${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);
