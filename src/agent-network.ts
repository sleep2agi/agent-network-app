// #769 —— 一个 Agent 的会话(发送 / 历史 / 已读 / 附件)要打到**这个 Agent 所在的网络**,不是账号的「当前网络」。
//
// 新注册的账号会自动建一个空的个人网络并把它记成当前网络;同时它又是别人主网络的成员。Agent 列表读的
// /api/status 不带 network_id(Hub 返回该用户所有网络的并集,每行带 network_id),所以列表里看得到主网络的
// Agent;但发送 / 历史以前一律用 cfg.networkId(个人网络)→ Hub 404 alias_not_found,历史也是空的。
//
// 取法:优先用用户点的那一行带来的 network_id(两个网络有同名 Agent 时只有它能区分);没有带(通知 /
// 定时任务等入口)就看列表里这个别名是不是只出现在一个网络里 —— 唯一才用,有歧义或旧 Hub 不带
// network_id 时退回当前网络(与修复前逐字相同)。
import type { HubConfig, Session } from './api';

const known = new Map<string, Map<string, Set<string>>>();
const scopeOf = (cfg: Pick<HubConfig, 'serverUrl' | 'token'>) => `${cfg.serverUrl}\u0000${cfg.token}`;

/** 记下 Agent 列表最近一次读到的「别名 → 所在网络」。列表每次刷新都整份替换。 */
export function rememberAgentNetworks(cfg: Pick<HubConfig, 'serverUrl' | 'token'>, sessions: readonly Session[]): void {
  const byAlias = new Map<string, Set<string>>();
  for (const s of sessions) {
    const net = typeof s.network_id === 'string' ? s.network_id.trim() : '';
    if (!s.alias || !net) continue;
    const set = byAlias.get(s.alias) ?? new Set<string>();
    set.add(net);
    byAlias.set(s.alias, set);
  }
  known.set(scopeOf(cfg), byAlias);
}

/** 这个 Agent 的网络:行带来的 > 列表里唯一的那个 > undefined(= 用当前网络)。 */
export function agentNetworkId(cfg: Pick<HubConfig, 'serverUrl' | 'token'>, alias: string, rowNetworkId?: string | null): string | undefined {
  const row = typeof rowNetworkId === 'string' ? rowNetworkId.trim() : '';
  if (row) return row;
  const nets = known.get(scopeOf(cfg))?.get(alias);
  return nets && nets.size === 1 ? [...nets][0] : undefined;
}

/** 会话用的 cfg:Agent 的网络和当前网络不同才换,其余原样返回(同一个对象,单网络用户零变化)。 */
export function cfgForAgent(cfg: HubConfig, alias: string, rowNetworkId?: string | null): HubConfig {
  const net = agentNetworkId(cfg, alias, rowNetworkId);
  return net && net !== cfg.networkId ? { ...cfg, networkId: net } : cfg;
}
