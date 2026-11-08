// ck-style：新建节点向导里 runtime / model 的可选项搜索与分组（与模型命令面板同一口径）。
import { strict as assert } from 'node:assert';
import {
  filteredModelGroups,
  groupModelsByProvider,
  modelMatchesQuery,
  modelProviderOf,
  runtimeMatchesQuery,
  type RuntimeLike,
} from './wizard-choice-filter';

let n = 0;
const ck = (name: string, cond: boolean) => { n += 1; assert.ok(cond, name); console.log(`PASS: ${name}`); };

const runtimes: RuntimeLike[] = [
  { id: 'claude-agent-sdk', label: 'Claude Agent SDK', models: ['deepseek-v4-pro'] },
  { id: 'codex-app-server', label: 'Codex（TUI 共存）', models: [] },
  { id: 'grok-build-cli', label: '共存模式（实验性）', models: [], advancedOf: 'grok-build-acp', note: '实验性：钉版本' },
];

// 搜索：id / 标签 / 说明（大小写不敏感），空查询全命中
ck('empty query matches every runtime', runtimes.every(r => runtimeMatchesQuery(r, '')) && runtimes.every(r => runtimeMatchesQuery(r, null)));
ck('runtime search matches the id', runtimeMatchesQuery(runtimes[1], 'CODEX-APP'));
ck('runtime search matches the label (CJK included)', runtimeMatchesQuery(runtimes[2], '共存'));
ck('runtime search matches the note', runtimeMatchesQuery(runtimes[2], '钉版本'));
ck('runtime search rejects a miss', !runtimeMatchesQuery(runtimes[0], 'zzz'));

// 模型搜索与 provider 归属
ck('model search is case-insensitive on provider/model', modelMatchesQuery('tianma/MiniMax-M3.1-Flash', 'miniMAX') && modelMatchesQuery('opencode/mimo-v2.6-flash-free', 'OPENCODE/'));
ck('model search rejects a miss', !modelMatchesQuery('tianma/MiniMax-M3', 'gpt'));
const groups = groupModelsByProvider(['tianma/MiniMax-M3.1-Flash', 'tianma/MiniMax-M3', 'deepseek/deepseek-flash', 'opencode/north-mini-code-free']);
ck('models group by provider in first-seen order', groups.map(g => g.provider).join(',') === 'tianma,deepseek,opencode');
ck('group count is the number of models in that provider', groups[0].count === 2 && groups[2].count === 1);
ck('a bare model name is not given an invented provider', modelProviderOf('gpt-5.5') === '其他' && groupModelsByProvider(['gpt-5.5', 'gpt-5.5'])[0].provider === '其他');

// 过滤后的分组：空组不画，搜索不改变组内顺序
const filtered = filteredModelGroups(['tianma/MiniMax-M3.1-Flash', 'deepseek/deepseek-flash', 'tianma/MiniMax-M3'], 'deepseek');
ck('filtered groups drop empty providers', filtered.length === 1 && filtered[0].provider === 'deepseek' && filtered[0].models[0] === 'deepseek/deepseek-flash');
ck('no match yields no groups (empty state, not an error)', filteredModelGroups(['a/b'], 'zzz').length === 0);
ck('an empty model list stays empty (follow host login)', filteredModelGroups([], '').length === 0);

console.log(`\n${n}/${n} passed`);
