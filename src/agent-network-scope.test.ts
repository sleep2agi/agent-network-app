// #769 —— 新账号:个人网络(空,当前网络)+ 被拉进的主网络(有 Agent)。Agent 列表读的是所有网络的并集,
// 点主网络的 Agent 发消息,以前 POST /api/task 带的是个人网络 → Hub 404 alias_not_found(「未送达 · 没有找到
// 这个 Agent」),历史 /api/tasks?network_id=个人网络 也是空的。
//
// 锁住:会话里的发送 / 历史用**这个 Agent 所在的网络**(点的那一行带来的 network_id),单网络用户逐字不变,
// 旧 Hub(行上没有 network_id)退回当前网络。最后一段校验接线:ChatScreen 只通过 cfgForAgent 用 cfg,
// 列表把行的 network_id 带出来,App 把它交给每一个 ChatScreen。
import { readFileSync } from 'node:fs';
import { fetchTasks, forgetSendIdentity, sendTask, type HubConfig, type Session } from './api';
import { agentNetworkId, cfgForAgent, rememberAgentNetworks } from './agent-network';

let passed = 0;
let total = 0;
const ck = (name: string, ok: boolean) => {
  total++;
  if (ok) { passed++; console.log('PASS:', name); }
  else console.error('FAIL:', name);
};

const PERSONAL = 'net_personal';
const MAIN = 'net_main';
const AGENT = 'agent-main';
const row = (alias: string, network_id?: string | null): Session => ({ alias, status: 'idle', ...(network_id === undefined ? {} : { network_id }) });

type Call = { url: string; body?: any };
const calls: Call[] = [];
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input);
  const body = init?.body ? JSON.parse(init.body) : undefined;
  calls.push({ url, body });
  // The production hub: only MAIN knows the agent.
  if (url.endsWith('/api/task')) {
    return body?.network_id === MAIN
      ? new Response(JSON.stringify({ ok: true, task_id: 't_ok' }), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response(JSON.stringify({ ok: false, error: 'alias_not_found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({ ok: true, tasks: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

const account = (token: string, networkId?: string): HubConfig =>
  ({ serverUrl: 'https://hub.example.test', token, username: 'tang', ...(networkId ? { networkId } : {}) });
const send = async (cfg: HubConfig, alias: string) => {
  calls.length = 0;
  forgetSendIdentity();
  await sendTask(cfg, alias, 'hi', undefined, 'normal', 'dreq_00000000000000000000000000000769').catch(() => undefined);
  return calls.filter(c => c.url.endsWith('/api/task'))[0]?.body?.network_id;
};
const history = async (cfg: HubConfig, alias: string) => {
  calls.length = 0;
  await fetchTasks(cfg, { to_name: alias, limit: 20 }).catch(() => undefined);
  return new URL(calls[0]?.url ?? 'https://x/').searchParams.get('network_id');
};

// ── 1. two networks: personal (current, empty) + main (has the agent)
{
  const cfg = account('utok_two', PERSONAL);
  rememberAgentNetworks(cfg, [row(AGENT, MAIN), row('agent-other', MAIN)]);
  const scoped = cfgForAgent(cfg, AGENT, MAIN);
  ck('two networks: send from the clicked row uses the main network', await send(scoped, AGENT) === MAIN);
  ck('two networks: history uses the main network', await history(scoped, AGENT) === MAIN);
  ck('two networks: the account cfg itself is not rewritten', cfg.networkId === PERSONAL);
  // Entry without a row (notification / scheduled task): the list saw this alias in exactly one network.
  ck('two networks: no row → the one network the list saw', await send(cfgForAgent(cfg, AGENT), AGENT) === MAIN);
}

// ── 2. same alias in two networks: the row decides; with no row it is ambiguous → current network
{
  const cfg = account('utok_dup', PERSONAL);
  rememberAgentNetworks(cfg, [row(AGENT, MAIN), row(AGENT, PERSONAL)]);
  ck('same alias: row in main → main', cfgForAgent(cfg, AGENT, MAIN).networkId === MAIN);
  ck('same alias: row in personal → personal', cfgForAgent(cfg, AGENT, PERSONAL).networkId === PERSONAL);
  ck('same alias: no row → never guessed, current network', agentNetworkId(cfg, AGENT) === undefined && cfgForAgent(cfg, AGENT) === cfg);
}

// ── 3. single-network user: unchanged (same object, same requests)
{
  const cfg = account('utok_one', MAIN);
  rememberAgentNetworks(cfg, [row(AGENT, MAIN)]);
  ck('single network: cfg returned as-is', cfgForAgent(cfg, AGENT, MAIN) === cfg && cfgForAgent(cfg, AGENT) === cfg);
  ck('single network: send uses the current network', await send(cfgForAgent(cfg, AGENT, MAIN), AGENT) === MAIN);
  ck('single network: history uses the current network', await history(cfgForAgent(cfg, AGENT, MAIN), AGENT) === MAIN);
}

// ── 4. old hub: rows carry no network_id → current network
{
  const cfg = account('utok_old', PERSONAL);
  rememberAgentNetworks(cfg, [row(AGENT), row('agent-other', null)]);
  ck('old hub: no network on the row → current network', cfgForAgent(cfg, AGENT, undefined) === cfg && cfgForAgent(cfg, AGENT, null) === cfg);
  ck('old hub: send uses the current network', await send(cfgForAgent(cfg, AGENT), AGENT) === PERSONAL);
  ck('old hub: history uses the current network', await history(cfgForAgent(cfg, AGENT), AGENT) === PERSONAL);
}

// ── 5. another account on the same hub does not inherit this account's list
{
  rememberAgentNetworks(account('utok_a', PERSONAL), [row(AGENT, MAIN)]);
  ck('per-account: another token never sees the list', agentNetworkId(account('utok_b', PERSONAL), AGENT) === undefined);
}

// ── 6. wiring (source): every agent-scoped request in ChatScreen goes through cfgForAgent
{
  const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
  const agents = readFileSync(new URL('./AgentsScreen.tsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  ck('ChatScreen: cfg = cfgForAgent(account cfg, alias, row network)',
    /export default function ChatScreen\(\{ cfg: accountCfg, alias, networkId,/.test(chat)
    && /const cfg = useMemo\(\(\) => cfgForAgent\(accountCfg, alias, networkId\), \[accountCfg, alias, networkId\]\);/.test(chat));
  ck('ChatScreen: the account cfg is used nowhere else', (chat.match(/\baccountCfg\b/g) ?? []).length === 3);
  ck('AgentsScreen: every row opens with its network_id', (agents.match(/openChat\(item\.alias, item\.network_id\)/g) ?? []).length === 2
    && !/openChat\(item\.alias\)/.test(agents));
  ck('AgentsScreen: the list feeds the alias → network map', /rememberAgentNetworks\(cfg, next\)/.test(agents));
  const routes = app.match(/onOpenChat=\{\(alias, networkId\) => setScreen\(\{ name: 'chat', alias, networkId \}\)\}/g) ?? [];
  ck('App: every AgentsScreen hands the row network to the chat screen', routes.length === 3
    // The two notifiers (no row to carry) are the only alias-only chat openers left; they use the list's map.
    && (app.match(/onOpenChat=\{alias => setScreen\(\{ name: 'chat', alias \}\)\}/g) ?? []).length === 2);
  const chatSites = app.match(/<ChatScreen[\s\S]*?alias=\{screen\.alias\}\s*\n\s*networkId=\{screen\.networkId\}/g) ?? [];
  ck('App: every list-opened ChatScreen receives networkId', chatSites.length === 3);
}

console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
