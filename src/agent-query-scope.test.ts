// #5428 评审:搜索词的记忆按 账号 + Hub + 网络 隔离。
import { agentQueryScope } from './nav-chrome';
const a = agentQueryScope({ serverUrl: 'https://h', networkId: 'n1', profileId: 'p_alice' });
const b = agentQueryScope({ serverUrl: 'https://h', networkId: 'n1', profileId: 'p_bob' });
const c = agentQueryScope({ serverUrl: 'https://h', networkId: 'n2', profileId: 'p_alice' });
const d = agentQueryScope({ serverUrl: 'https://h', networkId: 'n1', username: 'alice' });
const ok = a !== b && a !== c && d.includes('alice') && !a.includes('token');
console.log(ok ? 'agent-query-scope: 4/4 passed' : `agent-query-scope FAILED ${JSON.stringify([a, b, c, d])}`);
if (!ok) process.exit(1);
