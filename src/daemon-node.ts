// 看板 #692 —— 守护节点(role = host_supervisor)不接 AI 对话:它只执行 创建 / 停止 / 重启 / 删除
// 这类结构化命令,聊天框里打字发过去只会石沉大海。所以:
//   - 会话页把输入框换成一行说明 + 两个入口(它托管的节点 / 运行日志),历史消息照常显示;
//   - Agent 列表里它的行不画未读红点。
// 角色从 GET /api/nodes 来(App.tsx 本来就为头像每 30 s 拉一次,同一份结果顺手喂进这里),
// 读 `role`,没有再看 `config_snapshot.role`(与 local-daemon.ts / node-info.ts 同一口径)。
// 还没拉到 = 不知道 = 按普通节点画(与升级前逐字相同),不猜。
// 纯逻辑,不 import react / react-native。

export const HOST_SUPERVISOR_ROLE = 'host_supervisor';

export type RoleNode = {
  node_id?: string;
  alias?: string;
  role?: string | null;
  hostname?: string | null;
  lifecycle_daemon_node_id?: string | null;
  config_snapshot?: { role?: string | null } | null;
};

export const nodeRole = (node: RoleNode | null | undefined): string | null =>
  node?.role ?? node?.config_snapshot?.role ?? null;

export const isHostSupervisorNode = (node: RoleNode | null | undefined): boolean =>
  nodeRole(node) === HOST_SUPERVISOR_ROLE;

/** 会话页底部画什么:普通输入框,还是守护节点的说明条。 */
export type ChatComposerKind = 'chat' | 'daemon';
export const chatComposerKind = (hostSupervisor: boolean): ChatComposerKind => (hostSupervisor ? 'daemon' : 'chat');

/** 列表行的未读徽标:守护节点一律不画(它没有可「读」的对话)。 */
export function agentRowBadge<B>(badge: B | null, hostSupervisor: boolean): B | null {
  return hostSupervisor ? null : badge;
}

/** 这个守护节点托管的节点(Hub 的 lifecycle_daemon_node_id 指向它),按别名排序、去重、不含自己。 */
export function managedNodeAliases(nodes: readonly RoleNode[] | null | undefined, daemonAlias: string): string[] {
  if (!nodes) return [];
  const daemon = nodes.find(n => n.alias === daemonAlias && isHostSupervisorNode(n));
  if (!daemon?.node_id) return [];
  const out = new Set<string>();
  for (const n of nodes) {
    if (n.alias && n.alias !== daemonAlias && n.lifecycle_daemon_node_id === daemon.node_id) out.add(n.alias);
  }
  return [...out].sort();
}

/** 「托管的节点」入口打开的 Agent 列表筛选(server-stats.ts AgentListFilter 的「机器」那一格)。 */
export function managedNodesFilter(daemonAlias: string, aliases: readonly string[], hostname?: string | null) {
  return { host: hostname?.trim() || daemonAlias, aliases: [...aliases], hostLabel: daemonAlias };
}

// ── 模块级仓库(同 lib/avatars.ts 的 hydrateHubAvatars:每次轮询喂一次,内容变了才通知) ─────────
type Snapshot = { daemons: ReadonlySet<string>; managed: ReadonlyMap<string, readonly string[]>; hostnames: ReadonlyMap<string, string> };
let snapshot: Snapshot = { daemons: new Set(), managed: new Map(), hostnames: new Map() };
let snapshotKey = '';
let version = 0;
const listeners = new Set<() => void>();

export function hydrateNodeRoles(nodes: readonly RoleNode[] | null | undefined): void {
  if (!nodes) return;
  const daemons = new Set<string>();
  const hostnames = new Map<string, string>();
  for (const n of nodes) {
    if (!n?.alias || !isHostSupervisorNode(n)) continue;
    daemons.add(n.alias);
    if (n.hostname?.trim()) hostnames.set(n.alias, n.hostname.trim());
  }
  const managed = new Map<string, readonly string[]>();
  for (const alias of daemons) managed.set(alias, managedNodeAliases(nodes, alias));
  const key = JSON.stringify([[...daemons].sort(), [...managed].sort(), [...hostnames].sort()]);
  if (key === snapshotKey) return;
  snapshotKey = key;
  snapshot = { daemons, managed, hostnames };
  version++;
  listeners.forEach(l => l());
}

export const isHostSupervisorAlias = (alias: string): boolean => snapshot.daemons.has(alias);
export const managedAliasesOf = (alias: string): readonly string[] => snapshot.managed.get(alias) ?? [];
export const daemonHostnameOf = (alias: string): string | null => snapshot.hostnames.get(alias) ?? null;

/** useSyncExternalStore(subscribeNodeRoles, nodeRolesVersion) —— 角色变了重画。 */
export function subscribeNodeRoles(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
export const nodeRolesVersion = (): number => version;

/** 测试用 / 切账号时清空。 */
export function resetNodeRoles(): void {
  snapshot = { daemons: new Set(), managed: new Map(), hostnames: new Map() };
  snapshotKey = '';
  version++;
  listeners.forEach(l => l());
}
