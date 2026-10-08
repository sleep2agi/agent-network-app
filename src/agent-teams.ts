// Agent 团队(看板 #766,父卡 #750;Hub agent-network#2519,≥ 0.9.0-preview.116):Agent 自己的组织树,和人的部门树无关。
// 接口 + 纯逻辑。权限照 Hub 的 agent-teams.ts 现算(GET 不回 viewer_can):
//   网络 owner / admin、Hub 管理员:全部;团队的 owner:管这个团队的子树,但不能改自己那个团队的 owner、不能把它挪出去或删掉;
//   其他人(含 viewer):只读。界面只画能做的事;万一判断和 Hub 不一致,403 照一句人话说。
import { appFetch } from './app-fetch';
import type { HubConfig } from './api';
import type { AuthMe } from './user-admin';

export type TeamNode = { node_id: string; alias: string | null; display_name: string | null };
export type AgentTeam = { id: string; name: string; parent_id: string | null; sort: number; lead: TeamNode | null; owner: { user_id: string; display_name: string } | null; members: TeamNode[] };
export type TeamPatch = { name?: string; parent_id?: string | null; sort?: number; lead_node_id?: string | null; owner_user_id?: string | null };

export const HUB_MIN = '0.9.0-preview.116';

export class TeamRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); }
}

export function teamErrorText(code: string): string {
  switch (code) {
    case 'agent_team_scope_denied': return '你没有权限改这个团队:只有网络管理员和团队负责人能改';
    case 'team_name_taken': return '同一上级下已经有同名团队';
    case 'invalid_team_name': return '团队名称 1–40 个字';
    case 'team_has_children': return '先删掉或移走子团队,才能删除这个团队';
    case 'team_cycle': return '不能移到自己或自己的下级团队下面';
    case 'team_too_deep': return '团队最多 10 层';
    case 'parent_not_found': case 'team_not_found': return '这个团队已经不存在了,刷新后再试';
    case 'node_not_found': return '这个 Agent 已不在本网络';
    case 'lead_not_in_network': return '负责的 Agent 必须在本网络';
    case 'owner_not_member': return '负责人必须是本网络成员';
    default: return '没有保存成功,请重试';
  }
}

async function call<T>(cfg: HubConfig, path: string, method = 'GET', body?: unknown): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await appFetch(`${cfg.serverUrl}${path}`, { method, headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: ctrl.signal });
    let data: any = null;
    try { data = await res.json(); } catch { /* 按状态码说 */ }
    if (!res.ok || data?.ok === false) {
      const code = String(data?.error ?? `HTTP ${res.status}`);
      throw new TeamRequestError(res.status === 403 ? teamErrorText('agent_team_scope_denied') : teamErrorText(code), res.status, code);
    }
    return data as T;
  } finally { clearTimeout(timer); }
}

const base = (net: string) => `/api/networks/${encodeURIComponent(net)}`;
/** null = 旧 Hub(没有这条路由:404 / 405,且不是「网络不存在」)。 */
export async function fetchAgentTeams(cfg: HubConfig, net: string): Promise<AgentTeam[] | null> {
  try {
    const d = await call<{ teams?: AgentTeam[] }>(cfg, `${base(net)}/agent-teams`);
    return Array.isArray(d.teams) ? d.teams : [];
  } catch (e) {
    if (e instanceof TeamRequestError && (e.status === 404 || e.status === 405) && e.code !== 'network_not_found') return null;
    throw e;
  }
}
export const createTeam = (cfg: HubConfig, net: string, name: string, parent_id: string | null) => call(cfg, `${base(net)}/agent-teams`, 'POST', { name, parent_id });
export const patchTeam = (cfg: HubConfig, net: string, id: string, patch: TeamPatch) => call(cfg, `${base(net)}/agent-teams/${encodeURIComponent(id)}`, 'PATCH', patch);
export const deleteTeam = (cfg: HubConfig, net: string, id: string) => call(cfg, `${base(net)}/agent-teams/${encodeURIComponent(id)}`, 'DELETE');
export const setNodeTeam = (cfg: HubConfig, net: string, nodeId: string, team_id: string | null) => call(cfg, `${base(net)}/nodes/${encodeURIComponent(nodeId)}/agent-team`, 'PUT', { team_id });

// ── 树 ──
export const teamNodeName = (n: TeamNode) => (n.display_name && n.display_name.trim()) || n.alias || n.node_id;
export const childTeams = (teams: readonly AgentTeam[], parent: string | null) => teams.filter(t => (t.parent_id ?? null) === parent).sort((a, b) => a.sort - b.sort);
export function flattenTeams(teams: readonly AgentTeam[]): Array<{ team: AgentTeam; depth: number }> {
  const out: Array<{ team: AgentTeam; depth: number }> = [];
  const walk = (parent: string | null, depth: number) => { for (const t of childTeams(teams, parent)) if (!out.some(r => r.team.id === t.id)) { out.push({ team: t, depth }); walk(t.id, depth + 1); } };
  walk(null, 0);
  return out;
}
/** id 和它的全部下级。 */
export function subtree(teams: readonly AgentTeam[], id: string): Set<string> {
  const out = new Set([id]);
  for (let grew = true; grew;) { grew = false; for (const t of teams) if (t.parent_id && out.has(t.parent_id) && !out.has(t.id)) { out.add(t.id); grew = true; } }
  return out;
}
export const teamOfNode = (teams: readonly AgentTeam[], nodeId: string) => teams.find(t => t.members.some(m => m.node_id === nodeId))?.id ?? null;
export const unassigned = <N extends { node_id: string }>(teams: readonly AgentTeam[], nodes: readonly N[]) => nodes.filter(n => !teamOfNode(teams, n.node_id));

// ── 权限 ──
export type TeamPerms = {
  readOnly: boolean; canCreateRoot: boolean;
  canEdit: (id: string) => boolean;          // 改名 / 设 lead / 建子团队
  canRelocate: (id: string) => boolean;      // 移动 / 删除 / 改 owner(要求上级也在范围里)
  canAssign: (target: string | null, current: string | null) => boolean;
  moveTargets: (id: string) => { allowed: ReadonlySet<string>; root: boolean };
};
export function teamPerms(teams: readonly AgentTeam[], me: AuthMe | null | undefined, net: string): TeamPerms {
  const role = me?.networks?.find(n => n.network_id === net)?.member_role;
  const all = me?.user?.role === 'admin' || role === 'owner' || role === 'admin';
  const scope = new Set<string>();
  if (!all && role && role !== 'viewer' && me?.user?.user_id) for (const t of teams) if (t.owner?.user_id === me.user.user_id) for (const id of subtree(teams, t.id)) scope.add(id);
  const ok = (id: string | null) => all || (!!id && scope.has(id));
  const parentOf = (id: string) => teams.find(t => t.id === id)?.parent_id ?? null;
  return {
    readOnly: !all && scope.size === 0, canCreateRoot: all,
    canEdit: ok, canRelocate: id => all || (ok(id) && ok(parentOf(id))),
    canAssign: (target, current) => (all ? target !== current : (target !== null || current !== null) && (target === null || scope.has(target)) && (current === null || scope.has(current)) && target !== current),
    moveTargets: id => { const own = subtree(teams, id); return { allowed: new Set(teams.map(t => t.id).filter(x => !own.has(x) && ok(x))), root: all }; },
  };
}
