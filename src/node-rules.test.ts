// app#225 规则文件区块纯逻辑 — run: bun src/node-rules.test.ts
import { hasUnsavedChanges, isTerminal, nextPollDelayMs, predictedRulesFileName, rulesStatusMessage } from './node-rules';

let pass = 0, total = 0;
const ck = (name: string, cond: boolean, extra = '') => {
  total++;
  if (cond) { pass++; console.log('✅', name); }
  else console.log('❌', name, extra);
};

// ── 文件名预测:与 agent-node 同规则,claude 系 → CLAUDE.md ──
ck('runtime claude-agent-sdk → CLAUDE.md', predictedRulesFileName({ runtime: 'claude-agent-sdk' }) === 'CLAUDE.md');
ck('runtime claude-code-cli → CLAUDE.md', predictedRulesFileName({ runtime: 'claude-code-cli' }) === 'CLAUDE.md');
ck('runtime 大小写不敏感', predictedRulesFileName({ runtime: 'Claude' }) === 'CLAUDE.md');
ck('codex → AGENTS.md', predictedRulesFileName({ runtime: 'codex' }) === 'AGENTS.md');
ck('grok → AGENTS.md', predictedRulesFileName({ runtime: 'grok' }) === 'AGENTS.md');
ck('session 无 runtime 时退到 node.runtime', predictedRulesFileName({}, { runtime: 'claude' }) === 'CLAUDE.md');
ck('都没有时退到 session.agent', predictedRulesFileName({ agent: 'claude-code' }) === 'CLAUDE.md');
ck('全空 → AGENTS.md(和节点侧 rulesFileNameForRuntime(undefined) 一致)', predictedRulesFileName(null, null) === 'AGENTS.md');
ck('session.runtime 优先于 node.runtime(顺序确实起作用)', predictedRulesFileName({ runtime: 'codex' }, { runtime: 'claude' }) === 'AGENTS.md');

// ── 终态 ──
ck('done/failed/timeout 是终态', isTerminal('done') && isTerminal('failed') && isTerminal('timeout'));
ck('pending/in_progress 不是', !isTerminal('pending') && !isTerminal('in_progress'));

// ── 轮询节奏:单调不减,且三段确实不同 ──
{
  const d = [0, 4_999, 5_000, 19_999, 20_000, 120_000].map(nextPollDelayMs);
  ck('轮询间隔随时间不减', d.every((v, i) => i === 0 || v >= d[i - 1]), JSON.stringify(d));
  ck('三段各不相同(边界值 5s/20s 上确实切换)', d[1] < d[2] && d[3] < d[4], JSON.stringify(d));
}

// ── 状态文案:每个终态都有话说,且 failed 带上节点给的原因 ──
{
  const base = { file_name: 'CLAUDE.md', exists: true, error: null as string | null };
  ck('读进行中', rulesStatusMessage({ ...base, op: 'read', status: 'pending' }).includes('读取'));
  ck('写完成点名文件', rulesStatusMessage({ ...base, op: 'write', status: 'done' }).includes('CLAUDE.md'));
  ck('读完成且文件存在 → 无需提示', rulesStatusMessage({ ...base, op: 'read', status: 'done' }) === '');
  ck('读完成但文件不存在 → 告诉他保存会新建', rulesStatusMessage({ ...base, exists: false, op: 'read', status: 'done' }).includes('新建'));
  const f = rulesStatusMessage({ ...base, op: 'write', status: 'failed', error: 'EACCES: permission denied' });
  ck('failed 带节点原因', f.includes('EACCES'), f);
  ck('timeout 说清两种可能(离线/版本)', /离线/.test(rulesStatusMessage({ ...base, op: 'read', status: 'timeout' })) && /版本/.test(rulesStatusMessage({ ...base, op: 'read', status: 'timeout' })));
  ck('file_name 为空时不显示 "null"', !rulesStatusMessage({ ...base, file_name: null, op: 'write', status: 'done' }).includes('null'));
}

// ── 未保存判定:逐字,不 trim ──
ck('相同 → 无改动', !hasUnsavedChanges('a\n', 'a\n'));
ck('只差末尾换行也算改动', hasUnsavedChanges('a', 'a\n'));
ck('节点上没读到过(null)且编辑器空 → 无改动', !hasUnsavedChanges('', null));
ck('节点上没读到过(null)但编辑器有字 → 有改动', hasUnsavedChanges('x', null));

console.log(`\n${pass}/${total} passed`);
if (pass !== total) process.exit(1);
