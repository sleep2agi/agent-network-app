import { readFileSync } from 'node:fs';
import { afterPollAutoExecute, currentCodexAutoExecute, patchFlagsForAutoExecute } from './node-codex-execution';

let passed = 0, total = 0;
const check = (name: string, ok: boolean) => { total++; if (ok) { passed++; console.log('✅', name); } else { console.error('❌', name); } };

check('current reads yolo triple', currentCodexAutoExecute({ config_revision: 1, model: null, flags: { approvalPolicy: 'never', sandboxMode: 'danger-full-access', skipGitRepoCheck: true }, config_update_capable: true }));
check('patch on enables yolo', patchFlagsForAutoExecute(true).approvalPolicy === 'never');
check('patch off uses on-request read-only', patchFlagsForAutoExecute(false).approvalPolicy === 'on-request' && patchFlagsForAutoExecute(false).sandboxMode === 'read-only');
const restarting = { kind: 'restarting' as const, requested: 'on', baseRevision: 1, polls: 0 };
check('poll applied when flags match', afterPollAutoExecute(restarting, { config_revision: 2, model: null, flags: { approvalPolicy: 'never', sandboxMode: 'danger-full-access', skipGitRepoCheck: true }, config_update_capable: true }).kind === 'applied');

const detail = readFileSync(new URL('./NodeDetailScreen.tsx', import.meta.url), 'utf8');
check('detail mounts execution section for codex runtimes', detail.includes('<NodeCodexExecutionSection') && detail.includes('codex-app-server'));

const wiz = readFileSync(new URL('./CreateNodeWizardScreen.tsx', import.meta.url), 'utf8');
check('wizard has codex auto-execute toggle default path', wiz.includes('codexAutoExecute') && wiz.includes('codex-auto-execute-consent'));

console.log(`node codex execution: ${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);
