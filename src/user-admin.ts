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
  /** RFC-038 §8:被授权的 Agent 分组个数。旧 Hub 没有。 */
  agent_group_count?: number;
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

/**
 * #552 —— 保存的 cfg.networkId 还对不对。登录时按 pickDefaultNetworkId 选过一次并落盘,之后:
 * 管理员把人拉进自己的网络并授权 Agent、或者把人移出某网络,落盘那个值就过期了 —— 每次发送都打到错的网络
 * (404 alias_not_found),气泡只显示「未送达」。启动 / 切回账号时用这个判断要不要改。
 *
 * 规则跟 pickDefaultNetworkId 的注释一致,只在以下情况返回新值(其余返回 undefined = 不动):
 *   - 令牌绑定了网络(current_network)且与保存的不同 → 用 current_network;
 *   - 保存的网络已经不在 networks 里了(被移出 / 网络删了)→ 重新挑;
 *   - 用户在某个网络里是受限成员,而保存的网络不是受限成员的那个(典型:登录时还没被拉进团队,
 *     落盘的是自己那个空的个人网络)→ 落到受限成员的网络。
 * 读不到 / networks 为空(旧 Hub、离线)→ 不动,fail-open。Hub 管理员不受第二条约束(管理员可跨网络发)。
 */
export function reconcileNetworkId(me: AuthMe | null | undefined, saved: string | undefined): string | undefined {
  if (!me) return undefined;
  const picked = pickDefaultNetworkId(me);
  if (!picked || picked === saved) return undefined;
  const cur = me.current_network;
  const current = typeof cur === 'string' ? cur : cur?.network_id;
  if (typeof current === 'string' && current.trim()) return picked;
  const list = (me.networks ?? []).filter(n => typeof n.network_id === 'string' && n.network_id);
  if (list.length === 0) return undefined;
  if (!saved) return picked;
  const row = list.find(n => n.network_id === saved);
  if (!row) return me.user?.role === 'admin' ? undefined : picked;
  const restrictedSomewhere = list.some(n => n.agent_access === 'granted');
  if (restrictedSomewhere && row.agent_access !== 'granted') return picked;
  return undefined;
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
export function memberAccessSummary(m: NetworkMember): { kind: 'all' } | { kind: 'count'; count: number; groups: number } {
  if (!grantsEditable(m) || m.agent_access === 'all') return { kind: 'all' };
  return { kind: 'count', count: m.agent_grant_count ?? 0, groups: m.agent_group_count ?? 0 };
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

/**
 * PUT …/agent-grants 的 body(整体替换)。按 node_id 排序,方便比较与测试。
 *
 * 🔴 一律带 agent_access。只发 grants 时 hub 不改模式:升级前就在网络里的成员是 'all',
 * 勾了节点保存后授权行写进去了、人却仍然看得见全部 —— 管理员以为限制了,其实没有(RFC-038 G1)。
 * mode='all' 时也把当前勾选带上:hub 照存,以后切回「仅指定」不用重勾。
 * viewer 在 hub 上恒不能派活(canRestWriteNetworkAsHuman),所以 viewer 的授权一律按只读发(G2)。
 */
export function grantsPayload(
  sel: GrantSelection,
  keepAliasGrants: readonly AgentGrant[] = [],
  opts: { mode?: AgentAccess; role?: MemberRole } = {},
): { agent_access: AgentAccess; grants: Array<{ node_id?: string; alias?: string; can_message: boolean }> } {
  const readOnly = opts.role === 'viewer';
  const byNode = [...sel.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([node_id, can_message]) => ({ node_id, can_message: readOnly ? false : can_message }));
  const byAlias = keepAliasGrants.map(g => ({ alias: g.alias as string, can_message: readOnly ? false : g.can_message }));
  return { agent_access: opts.mode ?? 'granted', grants: [...byNode, ...byAlias] };
}

/** GET …/agent-grants 的 agent_access → 对话框初始模式。旧 Hub / 缺字段按「仅指定」(与 hub 的 fail-closed 同向)。 */
export function initialAccessMode(agentAccess: AgentAccess | null | undefined): AgentAccess {
  return agentAccess === 'all' ? 'all' : 'granted';
}

/**
 * 从「全部 Agent」切到「仅指定」:还一个都没勾时,预填这个人**此刻看得见**的全部 Agent(='all' 时就是网络里全部),
 * 免得一点保存就把人清成零节点。已经勾过的(以前存下的授权)原样保留。viewer 预填为只读。
 */
export function prefillOnRestrict(sel: GrantSelection, agents: readonly PickableAgent[], role?: MemberRole): Map<string, boolean> {
  if (sel.size) return new Map(sel);
  const out = new Map<string, boolean>();
  for (const a of filterPickable(agents, '')) out.set(a.node_id, role !== 'viewer');
  return out;
}

/** 这一行能不能出「可对话」开关:viewer 不能派活,只显示「只读」。 */
export function showsCanMessage(role: MemberRole | undefined): boolean {
  return role !== 'viewer';
}

/** 当前网络里我的成员角色。 */
export function myNetworkRole(me: AuthMe | null | undefined, networkId: string | undefined): MemberRole | undefined {
  return currentNetworkRow(me, networkId)?.member_role;
}

/**
 * 对某个成员我能做什么(与 hub 路由逐条对齐,UI 不给出 hub 会拒的操作):
 *   editAccess —— 授权:目标是 member / viewer(owner/admin 恒为全部);面板本身只给 owner/admin/Hub 管理员。
 *   editRole   —— PUT /members/:uid 只认网络 **owner**(Hub 管理员不算);不改 owner、不改自己。
 *   remove     —— DELETE /members/:uid 认网络 owner / admin;owner 移不走、不移自己。
 */
export function memberActions(me: AuthMe | null | undefined, networkId: string | undefined, m: Pick<NetworkMember, 'user_id' | 'role'>): { editAccess: boolean; editRole: boolean; remove: boolean } {
  const mine = myNetworkRole(me, networkId);
  const self = !!me?.user?.user_id && me.user.user_id === m.user_id;
  const target = m.role !== 'owner' && !self;
  return {
    editAccess: grantsEditable(m),
    editRole: target && mine === 'owner',
    remove: target && (mine === 'owner' || mine === 'admin'),
  };
}

/** 改角色能选的:成员 / 只读成员 / 管理员(只有 owner 能改角色,所以管理员总在)。 */
export const ASSIGNABLE_ROLES: readonly MemberRole[] = ['member', 'viewer', 'admin'];

/** 保存时要发哪几个请求(按顺序):先改角色,再按**新**角色决定要不要写授权。 */
export function memberSavePlan(input: {
  role: MemberRole; nextRole: MemberRole;
  mode: AgentAccess; nextMode: AgentAccess;
  before: GrantSelection; after: GrantSelection;
  /** 组授权(group_id → 可对话)。Hub 不支持分组时不传。 */
  beforeGroups?: GrantSelection; afterGroups?: GrantSelection;
}): { role: boolean; grants: boolean } {
  const role = input.nextRole !== input.role;
  if (!grantsEditable({ role: input.nextRole })) return { role, grants: false };
  const becameViewer = role && input.nextRole === 'viewer';
  const groupsChanged = !!input.beforeGroups && !!input.afterGroups && grantsChanged(input.beforeGroups, input.afterGroups);
  const grants = input.mode !== input.nextMode || grantsChanged(input.before, input.after) || groupsChanged || becameViewer;
  return { role, grants };
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

/** 选择器里的一个 Agent。hostname / runtime 来自 GET /api/nodes(旧节点可能为空)。 */
export type PickableAgent = { node_id: string; alias: string; display_name?: string | null; role?: string | null; hostname?: string | null; runtime?: string | null };

/** daemon(host_supervisor)不是能对话的 Agent,不放进选择器。按名字 / 机器 / 类型搜(不分大小写)。 */
export function filterPickable(nodes: readonly PickableAgent[], query: string): PickableAgent[] {
  const q = query.trim().toLowerCase();
  const hit = (v: string | null | undefined) => !!v && v.toLowerCase().includes(q);
  return nodes
    .filter(n => n.role !== 'host_supervisor' && !!n.alias)
    .filter(n => !q || hit(n.alias) || hit(n.display_name) || hit(n.hostname) || hit(n.runtime))
    .sort((a, b) => a.alias.localeCompare(b.alias));
}

// —— 批量勾选(Vincent 2026-09-30「可以设置为全部或者是分组…而不是一个一个去选」)——
// 🔴 这些都是**一次性**的勾选快捷方式:展开成逐个节点的授权。以后新建的 Agent 不会自动加入
// (真正的动态分组是 RFC-038 ② 的 hub 侧 agent_groups)。UI 上要把这句话说出来。

export type GroupBy = 'none' | 'host' | 'runtime';
export type AgentGroup = { key: string; label: string | null; agents: PickableAgent[] };

/** 按机器(hostname)或类型(runtime)分组。空值归到 label=null 的「未知」组,排最后;其余按名字排。 */
export function groupAgents(agents: readonly PickableAgent[], by: Exclude<GroupBy, 'none'>): AgentGroup[] {
  const map = new Map<string, PickableAgent[]>();
  for (const a of agents) {
    const raw = (by === 'host' ? a.hostname : a.runtime) ?? '';
    const key = raw.trim();
    const list = map.get(key) ?? [];
    list.push(a);
    map.set(key, list);
  }
  return [...map.entries()]
    .map(([key, list]) => ({ key, label: key || null, agents: [...list].sort((a, b) => a.alias.localeCompare(b.alias)) }))
    .sort((a, b) => (a.label === null ? 1 : b.label === null ? -1 : a.key.localeCompare(b.key)));
}

/** 一组(或任意一批)Agent 的勾选状态:全选 / 部分 / 没选(三态复选框用)。空组算 none。 */
export function selectionState(sel: GrantSelection, agents: readonly PickableAgent[]): 'all' | 'some' | 'none' {
  if (!agents.length) return 'none';
  let on = 0;
  for (const a of agents) if (sel.has(a.node_id)) on++;
  return on === 0 ? 'none' : on === agents.length ? 'all' : 'some';
}

/**
 * 点一组的复选框:全选了 ⇒ 这组全部取消;否则(部分 / 没选)⇒ 把没选的补上,已选的保持原样(不动它们的可对话)。
 * 新补上的默认可对话;viewer 一律只读。
 */
export function toggleAgents(sel: GrantSelection, agents: readonly PickableAgent[], role?: MemberRole): Map<string, boolean> {
  const next = new Map(sel);
  if (selectionState(sel, agents) === 'all') {
    for (const a of agents) next.delete(a.node_id);
    return next;
  }
  for (const a of agents) if (!next.has(a.node_id)) next.set(a.node_id, role !== 'viewer');
  return next;
}

/** 「全选搜索结果」:把当前列表里的全部加上(已选的保持原样)。 */
export function selectAgents(sel: GrantSelection, agents: readonly PickableAgent[], role?: MemberRole): Map<string, boolean> {
  const next = new Map(sel);
  for (const a of agents) if (!next.has(a.node_id)) next.set(a.node_id, role !== 'viewer');
  return next;
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

/** 网络选择器的搜索:按名字 / id,不分大小写;顺序不变(当前网络仍在第一个)。 */
export function filterNetworkChoices(list: readonly NetworkChoice[], query: string): NetworkChoice[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...list];
  return list.filter(n => n.name.toLowerCase().includes(q) || n.network_id.toLowerCase().includes(q));
}

/** 在选中的网络里能不能建 admin:Hub 管理员,或我是那个网络的 owner。 */
export function canAddAdminsIn(me: AuthMe | null | undefined, networkId: string | undefined): boolean {
  return me?.user?.role === 'admin' || currentNetworkRow(me, networkId)?.member_role === 'owner';
}

// —— Agent 分组(RFC-038 §8,hub agent-network#2131)——
// 组是管理员自由定义的一组 Agent;授权给组 ⇒ 组里**以后新加的** Agent 也自动可见(与上面一次性的批量勾选不同)。
// 旧 Hub 没有分组接口(404)⇒ 客户端整块不显示。

/** GET /api/networks/:id/agent-groups 的一项。 */
export type HubAgentGroup = { group_id: string; name: string; description?: string | null; node_ids: string[]; member_count: number; granted_user_count: number };
/** agent-grants 里的一条组授权。 */
export type GroupGrant = { group_id: string; name?: string; can_message: boolean };

export function groupSelectionFromGrants(grants: readonly GroupGrant[] | null | undefined): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const g of grants ?? []) if (g.group_id) out.set(g.group_id, g.can_message);
  return out;
}

/** PUT agent-grants 的 group_grants(整体替换)。按 group_id 排序;viewer 一律只读。 */
export function groupGrantsPayload(sel: GrantSelection, role?: MemberRole): Array<{ group_id: string; can_message: boolean }> {
  return [...sel.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([group_id, can]) => ({ group_id, can_message: role === 'viewer' ? false : can }));
}

/** 分组名:1–64 个字符(去首尾空格),与 hub 同规则。 */
export function validGroupName(name: string): boolean {
  const n = name.trim();
  return n.length >= 1 && n.length <= 64;
}

/** 分组编辑有没有改动:名字,或成员集合。 */
export function groupEditChanged(before: { name: string; nodeIds: readonly string[] }, after: { name: string; nodeIds: readonly string[] }): boolean {
  if (before.name.trim() !== after.name.trim()) return true;
  if (before.nodeIds.length !== after.nodeIds.length) return true;
  const set = new Set(before.nodeIds);
  return after.nodeIds.some(id => !set.has(id));
}

/** 成员行右侧的摘要文案 key 与参数(「3 个 Agent · 2 个分组」/「未分配 Agent」)。 */
export function accessSummaryText(summary: ReturnType<typeof memberAccessSummary>): { key: string; params?: Record<string, number>; empty: boolean } {
  if (summary.kind === 'all') return { key: 'users.access.all', empty: false };
  if (summary.count && summary.groups) return { key: 'users.access.countGroups', params: { count: summary.count, groups: summary.groups }, empty: false };
  if (summary.groups) return { key: 'users.access.groups', params: { groups: summary.groups }, empty: false };
  if (summary.count) return { key: 'users.access.count', params: { count: summary.count }, empty: false };
  return { key: 'users.access.none', empty: true };
}
