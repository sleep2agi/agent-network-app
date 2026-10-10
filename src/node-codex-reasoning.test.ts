import { readFileSync } from 'node:fs';
import { afterPollReasoning, currentReasoningEffort } from './node-codex-reasoning';

let passed = 0, total = 0;
const check = (name: string, ok: boolean) => { total++; if (ok) { passed++; console.log('✅', name); } else { console.error('❌', name); } };

check('missing flag → low default', currentReasoningEffort({ config_revision: 0, model: null, config_update_capable: true }) === 'low');
check('configured effort read from flags', currentReasoningEffort({ config_revision: 1, model: null, flags: { modelReasoningEffort: 'high' }, config_update_capable: true }) === 'high');

const restarting = { kind: 'restarting' as const, requested: 'high', baseRevision: 2, polls: 0 };
check('revision + flag match → applied', afterPollReasoning(restarting, { config_revision: 3, model: null, flags: { modelReasoningEffort: 'high' }, config_update_capable: true }).kind === 'applied');
check('revision bumped but flag wrong → still restarting', afterPollReasoning(restarting, { config_revision: 3, model: null, flags: { modelReasoningEffort: 'low' }, config_update_capable: true }).kind === 'restarting');

const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
check('api sends patch.flags for reasoning', api.includes('patch.flags') && api.includes('req.patch.flags'));
const detail = readFileSync(new URL('./NodeDetailScreen.tsx', import.meta.url), 'utf8');
check('detail mounts reasoning section for codex-app-server', detail.includes('<NodeCodexReasoningSection') && detail.includes("node.runtime === 'codex-app-server'"));
check('detail mounts execution section before reasoning', detail.indexOf('<NodeCodexExecutionSection') < detail.indexOf('<NodeCodexReasoningSection'));
check('model section not gated by readOnly', detail.includes('{node ? <NodeModelSection') && !detail.includes('!readOnly && node ? <NodeModelSection'));

console.log(`node codex reasoning: ${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);
