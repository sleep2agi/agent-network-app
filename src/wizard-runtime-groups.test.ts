// 新建节点向导「高级」折叠的分组规则(owner 2026-09-25:Grok 默认 ACP,共存收进高级)。行为测试,不读源码。
import { advancedExpanded, advancedRuntimesOf, primaryRuntimes, runtimeDisplayLabel, showsAdvancedToggle, type WizardRuntime } from './wizard-runtime-groups';

let passed = 0, total = 0;
const check = (name: string, ok: boolean) => { total++; if (ok) { passed++; console.log('✅', name); } else { console.error('❌', name); } };

const L: WizardRuntime[] = [
  { id: 'claude-agent-sdk', label: 'Claude Agent SDK', models: ['m'] },
  { id: 'grok-build-acp', label: 'Grok', models: ['grok-build'] },
  { id: 'codex-sdk', label: 'Codex SDK', models: ['gpt'] },
  { id: 'grok-build-cli', label: '共存模式（实验性）', models: [], advancedOf: 'grok-build-acp', note: 'x' },
];

check('primary list hides advanced rows and keeps order', primaryRuntimes(L).map(r => r.id).join() === 'claude-agent-sdk,grok-build-acp,codex-sdk');
check('advanced rows of Grok = [grok-build-cli]', advancedRuntimesOf(L, 'grok-build-acp').map(r => r.id).join() === 'grok-build-cli');
check('rows without children have no advanced rows', advancedRuntimesOf(L, 'codex-sdk').length === 0);

check('toggle hidden while another runtime is selected', !showsAdvancedToggle(L, 'grok-build-acp', 'claude-agent-sdk'));
check('toggle shown when Grok (ACP) is selected', showsAdvancedToggle(L, 'grok-build-acp', 'grok-build-acp'));
check('toggle shown when the co-presence row is selected', showsAdvancedToggle(L, 'grok-build-acp', 'grok-build-cli'));
check('no toggle on a row without children even if selected', !showsAdvancedToggle(L, 'codex-sdk', 'codex-sdk'));

check('choosing Grok leaves the disclosure collapsed (ACP is what gets created)', !advancedExpanded(L, 'grok-build-acp', 'grok-build-acp', false));
check('user opening it expands it', advancedExpanded(L, 'grok-build-acp', 'grok-build-acp', true));
check('a selected advanced row is never hidden', advancedExpanded(L, 'grok-build-acp', 'grok-build-cli', false));
check('an open flag does not leak into another runtime', !advancedExpanded(L, 'grok-build-acp', 'claude-agent-sdk', true));

check('advanced row display label carries its parent', runtimeDisplayLabel(L, L[3]) === 'Grok · 共存模式（实验性）');
check('primary row display label is its own label', runtimeDisplayLabel(L, L[1]) === 'Grok');

console.log(`wizard runtime groups: ${passed}/${total} checks passed`);
if (passed !== total) process.exit(1);
