// #5428:折叠屏双栏从别的 tab 回到 Agent,还原最后打开的会话;手机单栏、非会话画面、别的 tab 都不变。
import { agentTabReturnScreen } from './nav-chrome';

const chat = { name: 'chat', alias: '通信欧' };
const cases: [string, unknown, unknown][] = [
  ['双栏:从组织回 Agent → 还原会话', agentTabReturnScreen('agents', 'org', 'twoPane', chat), chat],
  ['手机单栏:回到列表', agentTabReturnScreen('agents', 'org', 'phone', chat)?.name, 'agents'],
  ['已在 Agent tab:不动', agentTabReturnScreen('agents', 'chat', 'twoPane', chat), null],
  ['记住的不是列表/会话:回列表', agentTabReturnScreen('agents', 'org', 'twoPane', { name: 'wizard' })?.name, 'agents'],
  ['去别的 tab:照常', agentTabReturnScreen('tasks', 'org', 'twoPane', chat)?.name, 'tasks'],
  ['没有记住的画面:回列表', agentTabReturnScreen('agents', 'org', 'twoPane', null)?.name, 'agents'],
];
let failed = 0;
for (const [name, got, want] of cases) if (got !== want) { failed++; console.log(`✗ ${name}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`); }
console.log(failed ? `agent-tab-return: ${failed} failed` : `agent-tab-return: ${cases.length}/${cases.length} passed`);
if (failed) process.exit(1);

// #1710 评审:打开会话 → 网络切换(screen 不变)→ 切 Tab 返回,不能还原旧网络的会话。
import { rememberAgentPane } from './nav-chrome';
{
  const chatN1 = { name: 'chat', alias: '旧网络里的会话' };
  let mem = rememberAgentPane(null, 'acct|hub|n1', { name: 'agents' });
  mem = rememberAgentPane(mem, 'acct|hub|n1', chatN1);
  const before = mem.screen === chatN1;
  mem = rememberAgentPane(mem, 'acct|hub|n2', chatN1); // 网络纠正:cfg 变了,screen 还是旧对象
  const clearedOnSwitch = mem.screen === null;
  mem = rememberAgentPane(mem, 'acct|hub|n2', chatN1); // 下一次渲染,仍是旧画面
  const staleNotAdopted = mem.screen === null;
  const back = agentTabReturnScreen('agents', 'org', 'twoPane', mem.screen);
  const chatN2 = { name: 'chat', alias: '新网络里打开的' };
  mem = rememberAgentPane(mem, 'acct|hub|n2', chatN2);
  const newOneKept = mem.screen === chatN2;
  const ok = before && clearedOnSwitch && staleNotAdopted && back?.name === 'agents' && newOneKept;
  console.log(ok ? 'agent-pane-memory: 5/5 passed' : `agent-pane-memory FAILED ${JSON.stringify({ before, clearedOnSwitch, staleNotAdopted, back, newOneKept })}`);
  if (!ok) process.exit(1);
}
