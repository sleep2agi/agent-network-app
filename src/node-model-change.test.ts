import { readFileSync } from 'node:fs';
import { afterPoll, afterSubmit, modelControlAvailability, phaseText, validateModelId, RESTART_MAX_POLLS, modelChips, catalogHint, modelNotOnMachineNote, filterModels, groupCountLabel, providerGroupSummary } from './node-model-change';
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
check('api calls update_node_config with base_revision and patch fields', api.includes("name: 'update_node_config'") && api.includes('base_revision: req.baseRevision') && api.includes('req.patch.model') && api.includes('req.patch.flags'));
check('api maps HTTP 409 to conflict', api.includes('if (res.status === 409) return { ok: false, conflict: true'));
const section = readFileSync(new URL('./NodeModelSection.tsx', import.meta.url), 'utf8');
check('section polls fetchNodeConfig while restarting and applies afterPoll', section.includes('fetchNodeConfig(cfg, node.node_id)') && section.includes('afterPoll('));
check('section disables the control from modelControlAvailability and shows its hint', section.includes('modelControlAvailability(') && section.includes('availability.hint'));
check('section offers suggested models plus a custom id input', section.includes('suggestedModels(') && section.includes('TextInput'));
const detail = readFileSync(new URL('./NodeDetailScreen.tsx', import.meta.url), 'utf8');
check('known node mounts daemon Provider control for co-presence and legacy model control for other runtimes',
  detail.includes('{node && !daemonProviderNodeRuntime(node.runtime) ? <NodeModelSection cfg={cfg} node={node} runtimeVersion={s.version} />')
  && detail.includes('{node && daemonProviderNodeRuntime(node.runtime) ? (')
  && detail.includes('<NodeDaemonProviderSection cfg={cfg} node={node}'));

// stale-catalog resilience (2026-09-23: mimo-v2.5-free withdrawn from OpenCode Zen while still listed)
check('catalog no longer lists the withdrawn opencode/mimo-v2.5-free', !Object.values(RUNTIME_MODEL_SUGGESTIONS).flat().includes('opencode/mimo-v2.5-free'));
check('catalog lists the live-verified opencode/mimo-v2.6-flash-free first for opencode-cli', suggestedModels('opencode-cli')[0] === 'opencode/mimo-v2.6-flash-free');
check('a current model absent from the catalog is still rendered (prepended)', JSON.stringify(modelChips(['a/b', 'c/d'], 'x/y')) === JSON.stringify(['x/y', 'a/b', 'c/d']));
check('a current model present in the catalog is not duplicated', JSON.stringify(modelChips(['a/b', 'c/d'], 'c/d')) === JSON.stringify(['a/b', 'c/d']));
check('no current model → chips are exactly the catalog', JSON.stringify(modelChips(['a/b'], null)) === JSON.stringify(['a/b']) && JSON.stringify(modelChips(['a/b'], '  ')) === JSON.stringify(['a/b']));
check('empty catalog with a current model still shows that model', JSON.stringify(modelChips([], 'p/m')) === JSON.stringify(['p/m']));
check('opencode-cli gets the lagging-catalog hint; others get none', catalogHint('opencode-cli') !== null && catalogHint('opencode-cli')!.includes('OpenCode Zen') && catalogHint('claude-agent-sdk') === null && catalogHint(null) === null);
check('section renders chips via modelChips and shows the catalog hint', section.includes('modelChips(') && section.includes('catalogHint('));
check('a model the machine does not report gets a warning', (modelNotOnMachineNote('grok-4.7', ['grok-4.6', 'grok-4.5']) || '').includes('grok-4.7'));
check('a model the machine reports gets no warning', modelNotOnMachineNote('grok-4.6', ['grok-4.6', 'grok-4.5']) === null);
check('no catalog or no model → no warning', modelNotOnMachineNote('grok-4.7', []) === null && modelNotOnMachineNote(null, ['a/b']) === null && modelNotOnMachineNote('   ', ['a/b']) === null);
check('section shows the not-on-machine warning', section.includes('modelNotOnMachineNote('));
// 模型筛选(admin 2026-10-31:几十个模型一屏放不下,要能敲几个字找)
const catalogBig = ['opencode/go-a', 'opencode/go-b', 'anthropic/claude-x', 'openai/gpt-y'];
check('空查询返回全部模型', JSON.stringify(filterModels(catalogBig, '')) === JSON.stringify(catalogBig));
check('只有空格也当空查询', filterModels(catalogBig, '   ').length === 4);
check('按模型名子串筛选,大小写不敏感', JSON.stringify(filterModels(catalogBig, 'CLAUDE')) === JSON.stringify(['anthropic/claude-x']));
check('按 provider 名也能筛选', JSON.stringify(filterModels(catalogBig, 'opencode/')) === JSON.stringify(['opencode/go-a', 'opencode/go-b']));
check('没有匹配时返回空数组(界面给提示)', filterModels(catalogBig, 'zzz').length === 0);
check('筛选结果保持原顺序', JSON.stringify(filterModels(catalogBig, 'o')) === JSON.stringify(['opencode/go-a', 'opencode/go-b', 'anthropic/claude-x', 'openai/gpt-y']));
check('section 用 filterModels 渲染而不是直接摊开 chips', section.includes('filterModels(chips, filter)'));
check('section 有清除按钮与空结果提示', section.includes('node-model-filter-clear') && section.includes('node-model-filter-empty'));
// 分组计数与总览(2026-10-31:开了筛选之后「有几个」看不出来)
check('分组标题带数量', groupCountLabel({ provider: 'opencode', models: ['opencode/a', 'opencode/b'] }) === 'opencode · 2');
check('总览给出模型数与 Provider 数', providerGroupSummary([{ provider: 'a', models: ['a/1'] }, { provider: 'b', models: ['b/1', 'b/2'] }]) === '共 3 个模型 · 2 个 Provider');
check('没有模型时不出总览', providerGroupSummary([]) === null);
check('section 用 groupCountLabel 与总览渲染', section.includes('groupCountLabel(g)') && section.includes('node-model-group-summary'));
// 2026-11-01 admin 截图:机器没上报模型清单时「建议」只剩「当前」一个 chip,点下去输入框还是空的
check('V2 目录为空时退回兄弟/内置候选(而不是只剩当前模型)', section.includes('v2 && v2Catalog.length > 0') && section.includes('suggestedModels(node.runtime)'));
check('退回内置候选时给出说明', section.includes('这台机器还没上报模型清单'));
check('点选 chip 后输入框显示所选模型', section.includes('value={custom.trim() ? custom : picked}'));
check('手输会清掉 chip 选中态', section.includes('setCustom(text); if (picked) setPicked(\'\')'));
check('opencode-cli 的内置候选不是空列表', suggestedModels('opencode-cli').length > 0);
// 读不到的目录要能手动再敲一次(2026-11-01:admin 那台机器目录一直没上报,只能退出重进)
check('退回内置候选时给「重新读取模型列表」入口', section.includes('node-model-catalog-retry') && section.includes('重新读取模型列表'));
check('重新读取靠计数触发 effect', section.includes('catalogAttempt') && section.includes('catalogAttempt]'));
// 2026-11-01:本机没上报时,用同 runtime 兄弟节点的候选,而不是只有内置两个
check('section 用 peerCatalogSources 兜底并记住台数', section.includes('peerCatalogSources(') && section.includes('setPeerNodes('));
check('提示里写明有几台节点报了候选', section.includes('其他 ${peers.nodes} 台节点报过的模型'));
check('兄弟候选要提示「本机未必装了同一个 Provider」', section.includes('本机未必装了同一个 Provider'));
check('退回兄弟候选时提示来源', section.includes('同 runtime 其他节点'));
check('有兄弟候选时不再显示内置候选说明', section.includes('usingPeerFallback'));
// RN 的 Text 不解析 markdown:提示文案里带 ** 会原样显示成星号(0.384 手滑过一次)
const uiStrings = section.split('\n').filter((l) => l.includes("setV2Note(\`") || l.includes('>{hint}<'));
check('面向用户的提示里没有 markdown 星号', !uiStrings.some((l) => l.includes('**')));
console.log(`node model change: ${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);
