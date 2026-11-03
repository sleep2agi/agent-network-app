// 「节点来分类」分组的判据（纯逻辑）。跑法同其它 *.test.ts：node scripts/run-tests.mjs
import { groupKeyOf, groupMapOf, runtimeGroup, hostGroup, statusGroup, parseGroupBy, GROUP_BY_OPTIONS } from './agent-group-by';

let p = 0, t = 0;
const ck = (name: string, ok: boolean) => { t++; if (ok) p++; console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`); };

const row = (o: any) => ({ runtime: null, agent: null, server: null, hostname: null, status: 'idle', ...o });

// 运行时：优先 runtime，其次 agent，都没有才是「未上报」
ck('runtime 优先取 runtime 字段', runtimeGroup(row({ runtime: 'agent-node:opencode', agent: 'agent-node:claude' })) === 'OpenCode');
ck('runtime 缺失时退回 agent', runtimeGroup(row({ agent: 'agent-node:codex' })) === 'Codex');
ck('两者都没有 ⇒ 未上报（不是「其它」）', runtimeGroup(row({})) === '未上报');
ck('未识别运行时原样保留', runtimeGroup(row({ runtime: 'agent-node:acp' })) === 'agent-node:acp');

// 主机：server 优先，hostname 次之
ck('server 优先', hostGroup(row({ server: 'dev-1', hostname: 'mac.local' })) === 'dev-1');
ck('server 缺失用 hostname', hostGroup(row({ hostname: 'mac.local' })) === 'mac.local');
ck('都没有 ⇒ 未知主机', hostGroup(row({})) === '未知主机');

// 状态四档，running 归「运行中」
ck('working ⇒ 运行中', statusGroup(row({ status: 'working' })) === '运行中');
ck('running ⇒ 运行中（老 hub）', statusGroup(row({ status: 'running' })) === '运行中');
ck('offline ⇒ 离线', statusGroup(row({ status: 'offline' })) === '离线');
ck('未知状态不冒充空闲', statusGroup(row({ status: '' })) === '未知');

// 部门切法：拿不到归属必须落「未归属」，不能退回别名前缀
const dept = (alias: string) => (alias === 'A' ? 'TMWork' : undefined);
ck('dept：有归属用归属', groupKeyOf(row({}) as any, 'dept', dept, 'A') === 'TMWork');
ck('dept：无归属 ⇒ 未归属（不猜前缀）', groupKeyOf(row({}) as any, 'dept', dept, '通信苹果欧') === '未归属');

// 切法解析：认不出就退回默认 dept
ck('默认 dept', parseGroupBy(null) === 'dept' && parseGroupBy('nope') === 'dept');
for (const k of GROUP_BY_OPTIONS) ck(`合法切法 ${k} 能解析`, parseGroupBy(k) === k);

// 预先算好的 map 与逐行算一致
const sessions = [
  { alias: 'A', runtime: 'agent-node:claude', status: 'working' },
  { alias: 'B', runtime: 'agent-node:codex', status: 'offline' },
] as any;
const m = groupMapOf(sessions, 'runtime');
ck('groupMapOf 与逐行一致', m.get('A') === 'Claude' && m.get('B') === 'Codex');
const ms = groupMapOf(sessions, 'status');
ck('groupMapOf 状态切法', ms.get('A') === '运行中' && ms.get('B') === '离线');

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
