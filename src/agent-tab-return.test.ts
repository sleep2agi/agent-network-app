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
