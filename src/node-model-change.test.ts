import { readFileSync } from 'node:fs';
import { afterPoll, afterSubmit, modelControlAvailability, phaseText, validateModelId, RESTART_MAX_POLLS } from './node-model-change';
import { RUNTIME_MODEL_SUGGESTIONS, suggestedModels } from './runtime-catalog';

let passed = 0, total = 0;
const check = (name: string, ok: boolean) => { total++; if (ok) { passed++; console.log('✅', name); } else { console.error('❌', name); } };

// validator
check('empty / whitespace-only model id rejected', !validateModelId('').ok && !validateModelId('   ').ok);
check('inner whitespace rejected', !validateModelId('opencode/mimo v2').ok);
check('provider/model form accepted and trimmed', (() => { const v = validateModelId('  opencode/mimo-v2.6-flash-free '); return v.ok && v.model === 'opencode/mimo-v2.6-flash-free'; })());

// availability (three states)
check('no config endpoint (null) disables with upgrade hint', !modelControlAvailability(null).enabled && modelControlAvailability(null).hint.includes('升级'));
check('capable=false disables and points at anet node edit', (() => { const a = modelControlAvailability({ config_revision: 0, model: 'x', config_update_capable: false }); return !a.enabled && a.hint.includes('anet node edit'); })());
check('capable=true enables', modelControlAvailability({ config_revision: 0, model: 'x', config_update_capable: true }).enabled);

// submit outcomes
check('ok submit → restarting from base revision', (() => { const p = afterSubmit('m2', 3, { ok: true }); return p.kind === 'restarting' && p.baseRevision === 3 && p.polls === 0; })());
check('409 → conflict', afterSubmit('m2', 3, { ok: false, conflict: true, error: 'revision' }).kind === 'conflict');
check('other failure → error with message', (() => { const p = afterSubmit('m2', 3, { ok: false, error: 'boom' }); return p.kind === 'error' && p.message === 'boom'; })());

// polling
const restarting = { kind: 'restarting' as const, requested: 'm2', baseRevision: 3, polls: 0 };
check('revision bumped + model matches → applied', afterPoll(restarting, { config_revision: 4, model: 'm2', config_update_capable: true }).kind === 'applied');
check('revision bumped but model differs → still restarting', afterPoll(restarting, { config_revision: 4, model: 'm1', config_update_capable: true }).kind === 'restarting');
check('same revision with requested model → still restarting (hub not yet finalized)', afterPoll(restarting, { config_revision: 3, model: 'm2', config_update_capable: true }).kind === 'restarting');
check('read failure counts as a poll, never as applied', (() => { const p = afterPoll(restarting, null); return p.kind === 'restarting' && p.polls === 1; })());
check(`timeout after ${RESTART_MAX_POLLS} polls`, (() => {
  let p = restarting as ReturnType<typeof afterPoll>;
  for (let i = 0; i < RESTART_MAX_POLLS; i++) { if (p.kind !== 'restarting') break; p = afterPoll(p, null); }
  return p.kind === 'timeout';
})());
check('timeout text tells the user to check the node, not that it succeeded', phaseText({ kind: 'timeout', requested: 'm2' }).includes('没有以新模型回来'));
check('applied text names the model', phaseText({ kind: 'applied', model: 'm2' }).includes('m2'));

// runtime catalog == wizard table (single source enforced by test, not by import:
// the wizard's literal is itself pinned by wizard-runtimes.test.ts)
const wiz = readFileSync(new URL('./CreateNodeWizardScreen.tsx', import.meta.url), 'utf8');
const table = wiz.slice(wiz.indexOf('const RUNTIMES'), wiz.indexOf('const PERMISSION_MODES'));
for (const [id, models] of Object.entries(RUNTIME_MODEL_SUGGESTIONS)) {
  const line = table.split('\n').find((l: string) => l.includes(`id: '${id}'`)) ?? '';
  const m = line.match(/models: \[([^\]]*)\]/);
  const wizModels = m ? m[1].split(',').map((s: string) => s.trim().replace(/^'|'$/g, '')).filter(Boolean) : null;
  check(`catalog for ${id} equals wizard table`, wizModels !== null && JSON.stringify(wizModels) === JSON.stringify(models));
}
check('unknown runtime suggests nothing (custom id still allowed)', suggestedModels('nope').length === 0 && suggestedModels(null).length === 0);

// wiring contracts
const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
check('api reads GET /api/nodes/:id/config and treats 404 as no endpoint', api.includes('/api/nodes/${encodeURIComponent(nodeId)}/config') && api.includes('if (res.status === 404 || res.status === 501) return null;'));
check('api calls update_node_config with base_revision and patch.model', api.includes("name: 'update_node_config'") && api.includes('base_revision: req.baseRevision') && api.includes('patch: { model: req.patch.model }'));
check('api maps HTTP 409 to conflict', api.includes('if (res.status === 409) return { ok: false, conflict: true'));
const section = readFileSync(new URL('./NodeModelSection.tsx', import.meta.url), 'utf8');
check('section polls fetchNodeConfig while restarting and applies afterPoll', section.includes('fetchNodeConfig(cfg, node.node_id)') && section.includes('afterPoll('));
check('section disables the control from modelControlAvailability and shows its hint', section.includes('modelControlAvailability(') && section.includes('availability.hint'));
check('section offers suggested models plus a custom id input', section.includes('suggestedModels(') && section.includes('TextInput'));
const detail = readFileSync(new URL('./NodeDetailScreen.tsx', import.meta.url), 'utf8');
check('detail screen mounts the model section for editable nodes only', detail.includes('<NodeModelSection cfg={cfg} node={node} />') && detail.includes("!readOnly && node ? <NodeModelSection"));

console.log(`node model change: ${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);
