// 多用户账号与 Agent 权限(hub agent-network#2084)—— 客户端的纯逻辑。不 import react-native。
//
// Hub 的规则:网络里 role 为 member / viewer、agent_access 不是 'all'、且不是 Hub 管理员的用户是
// 「受限成员」,只看得到管理员授权给他的 Agent。这里只做 UI 需要的判断:谁能看到「用户管理」、
// 新建用户的表单校验、授权列表的编辑与提交形状、Agent 列表空态该说什么。

export type MemberRole = 'owner' | 'admin' | 'member' | 'viewer' | string;
export type AgentAccess = 'all' | 'granted';

/** GET /api/auth/me 里我们用到的部分。 */
export type AuthMe = {
  user?: { user_id?: string; username?: string; role?: string } | null;
  current_network?: string | { network_id?: string } | null;
  networks?: Array<{ network_id?: string; network_name?: string; member_role?: MemberRole; agent_access?: AgentAccess }> | null;
};

/** GET /api/networks/:id/members 的一项。 */
export type NetworkMember = {
  user_id: string;
  username: string;
  display_name?: string | null;
  role: MemberRole;
  joined_at?: string;
  /** 生效值:owner/admin/Hub 管理员恒为 all。旧 Hub 没有这个字段。 */
  agent_access?: AgentAccess;
  agent_grant_count?: number;
};

export type AgentGrant = { node_id: string | null; alias: string | null; can_message: boolean };

/** 当前网络在 auth/me 里的那一行。 */
export function currentNetworkRow(me: AuthMe | null | undefined, networkId: string | undefined) {
  const list = me?.networks ?? [];
  return list.find(n => n.network_id === networkId) ?? null;
}

/** 「用户管理」只给 Hub 管理员、或当前网络的 owner / admin。 */
export function canManageUsers(me: AuthMe | null | undefined, networkId: string | undefined): boolean {
  if (!me) return false;
  if (me.user?.role === 'admin') return true;
  const role = currentNetworkRow(me, networkId)?.member_role;
  return role === 'owner' || role === 'admin';
}

/** 当前网络里我是不是受限成员(只看授权的 Agent)。旧 Hub 没有 agent_access ⇒ 不受限。 */
export function isRestrictedIn(me: AuthMe | null | undefined, networkId: string | undefined): boolean {
  return currentNetworkRow(me, networkId)?.agent_access === 'granted';
}

/**
 * 登录后默认进哪个网络。旧规则 = Hub 给的 current_network,否则 networks[0](自己的个人网络排第一)。
 * 新规则只多一条:用户在某个网络里是受限成员 ⇒ 默认进那个网络 —— 管理员把人建进自己的网络、再授权 Agent,
 * 这个人登录后得落在那个网络里,而不是自己那个空的个人网络。旧 Hub 没有 agent_access ⇒ 与原来逐字相同。
 */
export function pickDefaultNetworkId(me: AuthMe | null | undefined): string | undefined {
  const cur = me?.current_network;
  const current = typeof cur === 'string' ? cur : cur?.network_id;
  if (typeof current === 'string' && current.trim()) return current;
  const list = me?.networks ?? [];
  const restricted = list.find(n => n.agent_access === 'granted' && typeof n.network_id === 'string' && n.network_id);
  const id = restricted?.network_id ?? list[0]?.network_id;
  return typeof id === 'string' && id.trim() ? id : undefined;
}

export const MIN_PASSWORD = 8;
export type NewUserDraft = { username: string; password: string; displayName: string; role: MemberRole };
export type NewUserProblem = 'username' | 'usernameChars' | 'password' | null;

/** 与 hub register() 同一套规则(提交前先挡住明显的错;弱密码词典只在 Hub 判)。 */
export function validateNewUser(d: Pick<NewUserDraft, 'username' | 'password'>): NewUserProblem {
  const u = d.username.trim();
  if (u.length < 2 || u.length > 50) return 'username';
  if (!/^[a-zA-Z0-9_\-一-鿿]+$/.test(u)) return 'usernameChars';
  if (d.password.length < MIN_PASSWORD) return 'password';
  return null;
}

/** 这一行的授权能不能编辑:owner / admin 恒为全部 Agent,不编辑。 */
export function grantsEditable(m: Pick<NetworkMember, 'role'>): boolean {
  return m.role !== 'owner' && m.role !== 'admin';
}

/** 成员行右侧的摘要:全部 / N 个。 */
export function memberAccessSummary(m: NetworkMember): { kind: 'all' } | { kind: 'count'; count: number } {
  if (!grantsEditable(m) || m.agent_access === 'all') return { kind: 'all' };
  return { kind: 'count', count: m.agent_grant_count ?? 0 };
}

/** 编辑中的选择:node_id → 可对话。 */
export type GrantSelection = ReadonlyMap<string, boolean>;

export function selectionFromGrants(grants: readonly AgentGrant[]): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const g of grants) if (g.node_id) out.set(g.node_id, g.can_message);
  return out;
}

/** 老会话按 alias 授权的那些(没有 node_id,选择器里画不出来):保存时原样带回,别被整体替换抹掉。 */
export function aliasOnlyGrants(grants: readonly AgentGrant[]): AgentGrant[] {
  return grants.filter(g => !g.node_id && !!g.alias);
}

/** PUT …/agent-grants 的 body(整体替换)。按 node_id 排序,方便比较与测试。 */
export function grantsPayload(sel: GrantSelection, keepAliasGrants: readonly AgentGrant[] = []): { grants: Array<{ node_id?: string; alias?: string; can_message: boolean }> } {
  const byNode = [...sel.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([node_id, can_message]) => ({ node_id, can_message }));
  const byAlias = keepAliasGrants.map(g => ({ alias: g.alias as string, can_message: g.can_message }));
  return { grants: [...byNode, ...byAlias] };
}

/** 编辑后和原来有没有差别(没差别就不用「保存」)。 */
export function grantsChanged(before: GrantSelection, after: GrantSelection): boolean {
  if (before.size !== after.size) return true;
  for (const [k, v] of after) if (before.get(k) !== v) return true;
  return false;
}

/** 勾选 / 取消一个 Agent。新勾上的默认可对话。 */
export function toggleAgent(sel: GrantSelection, nodeId: string): Map<string, boolean> {
  const next = new Map(sel);
  if (next.has(nodeId)) next.delete(nodeId); else next.set(nodeId, true);
  return next;
}

export function setCanMessage(sel: GrantSelection, nodeId: string, value: boolean): Map<string, boolean> {
  const next = new Map(sel);
  if (next.has(nodeId)) next.set(nodeId, value);
  return next;
}

/** 选择器里的一个 Agent。 */
export type PickableAgent = { node_id: string; alias: string; display_name?: string | null; role?: string | null };

/** daemon(host_supervisor)不是能对话的 Agent,不放进选择器。按名字搜(alias / 显示名,不分大小写)。 */
export function filterPickable(nodes: readonly PickableAgent[], query: string): PickableAgent[] {
  const q = query.trim().toLowerCase();
  return nodes
    .filter(n => n.role !== 'host_supervisor' && !!n.alias)
    .filter(n => !q || n.alias.toLowerCase().includes(q) || (n.display_name ?? '').toLowerCase().includes(q))
    .sort((a, b) => a.alias.localeCompare(b.alias));
}

/**
 * Agent 列表是空的时候说什么。
 *   search / filter —— 用户在搜 / 筛(原来的文案);
 *   restricted —— 当前网络里是受限成员、一个 Agent 都没被分配:「还没有被分配任何 Agent，请联系管理员」;
 *   none —— 原来的「还没有 agent,用右上角 + 新建」。
 */
export function agentsEmptyKind(opts: { query: string; filtering: boolean; restricted: boolean }): 'search' | 'filter' | 'restricted' | 'none' {
  if (opts.query.trim()) return 'search';
  if (opts.filtering) return 'filter';
  return opts.restricted ? 'restricted' : 'none';
}

/** 新建用户时能选的网络:Hub 管理员 = 全部网络(GET /api/networks);否则 = 我是 owner / admin 的那些。当前网络排第一。 */
export type NetworkChoice = { network_id: string; name: string };
export function manageableNetworks(
  me: AuthMe | null | undefined,
  currentNetworkId: string | undefined,
  allNetworks?: ReadonlyArray<{ network_id?: string; network_name?: string | null; name?: string | null }> | null,
): NetworkChoice[] {
  const hubAdmin = me?.user?.role === 'admin';
  const source = hubAdmin && allNetworks?.length
    ? allNetworks
    : (me?.networks ?? []).filter(n => n.member_role === 'owner' || n.member_role === 'admin');
  const out: NetworkChoice[] = [];
  const seen = new Set<string>();
  for (const n of source) {
    const id = n?.network_id;
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    seen.add(id);
    const name = (('name' in n ? n.name : null) || n.network_name || id) as string;
    out.push({ network_id: id, name });
  }
  return out.sort((a, b) => (a.network_id === currentNetworkId ? -1 : b.network_id === currentNetworkId ? 1 : a.name.localeCompare(b.name)));
}

/** 在选中的网络里能不能建 admin:Hub 管理员,或我是那个网络的 owner。 */
export function canAddAdminsIn(me: AuthMe | null | undefined, networkId: string | undefined): boolean {
  return me?.user?.role === 'admin' || currentNetworkRow(me, networkId)?.member_role === 'owner';
}
