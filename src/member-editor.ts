// 成员编辑器(设置 → 用户管理 → 成员,#417 重设计)—— 客户端纯逻辑。不 import react-native。
//
// 宽屏双栏弹窗与手机的「成员」页共用这一份:保存时发哪几个请求、各自的 body(与重设计前的编辑器逐字相同 ——
// member-editor.test.ts 拿旧编辑器的保存逻辑逐场景比对)、「保存」可不可点、已选 chip、
// 选择器的四个页签(全部 / 按机器 / 按类型 / 分组)与分组头的三态。

import {
  aliasOnlyGrants, filterPickable, grantsEditable, grantsPayload, groupAgents, groupGrantsPayload, memberSavePlan, selectionFromGrants, selectionState,
  type AgentAccess, type AgentGrant, type AgentGroup, type GrantSelection, type HubAgentGroup, type MemberRole, type PickableAgent,
} from './user-admin';
import { taskGrantsChanged, taskGrantsPayload, type ProjectGrantSelection, type TaskAccess } from './task-access';

/** 选择器的页签:全部 / 按机器 / 按类型 / 分组(Hub 的 Agent 分组;旧 Hub 没有分组接口时不出这一格)。 */
export type PickerTab = 'none' | 'host' | 'runtime' | 'groups';
export function pickerTabs(groupsSupported: boolean): PickerTab[] {
  return groupsSupported ? ['none', 'host', 'runtime', 'groups'] : ['none', 'host', 'runtime'];
}

/** 编辑器此刻的全部选择(与 Hub 读回来的原值)。 */
export type MemberDraft = {
  /** Hub 上的角色 / 编辑中的角色。 */
  role: MemberRole; nextRole: MemberRole;
  /** 读回来的 agent_access / 编辑中的。 */
  mode: AgentAccess; nextMode: AgentAccess;
  /** GET agent-grants 的原样(含老会话按 alias 的授权,保存时原样带回)。 */
  original: readonly AgentGrant[];
  /** 编辑中的逐个 Agent:node_id → 可对话。 */
  selection: GrantSelection;
  /** Hub 支持 Agent 分组时才有:组授权原值 / 编辑中(group_id → 可对话)。 */
  groups?: { before: GrantSelection; after: GrantSelection };
  /** 我能不能改这个人的授权(memberActions().editAccess)。 */
  canEditAccess: boolean;
  /** 任务权限(Hub 支持 task-grants 时才有)。 */
  tasks?: { before: { mode: TaskAccess; selection: ProjectGrantSelection }; mode: TaskAccess; selection: ProjectGrantSelection };
};

export type SaveRequest =
  | { kind: 'role'; body: { role: MemberRole } }
  | { kind: 'tasks'; body: { task_access: TaskAccess; project_grants: Array<{ project_id: string; can_edit: boolean }> } }
  | { kind: 'grants'; body: { agent_access: AgentAccess; grants: Array<{ node_id?: string; alias?: string; can_message: boolean }>; group_grants?: Array<{ group_id: string; can_message: boolean }> } };

/** 授权区块画不画(=能不能改):我有权改,且按**新**角色不是 owner / admin(那两种恒为全部)。 */
export function accessEditableFor(d: Pick<MemberDraft, 'canEditAccess' | 'nextRole'>): boolean {
  return d.canEditAccess && grantsEditable({ role: d.nextRole });
}

/**
 * 保存要发的请求,按顺序:改角色 → 任务权限 → Agent 授权(与重设计前一致:先改角色,再按新角色写授权)。
 * 没有改动 ⇒ 空数组(「保存」不可点)。
 */
export function memberSaveRequests(d: MemberDraft): SaveRequest[] {
  const before = selectionFromGrants(d.original);
  const plan = memberSavePlan({
    role: d.role, nextRole: d.nextRole, mode: d.mode, nextMode: d.nextMode, before, after: d.selection,
    ...(d.groups ? { beforeGroups: d.groups.before, afterGroups: d.groups.after } : {}),
  });
  const out: SaveRequest[] = [];
  if (plan.role) out.push({ kind: 'role', body: { role: d.nextRole } });
  if (accessEditableFor(d) && d.tasks && tasksChanged(d.tasks, d.nextRole)) {
    out.push({ kind: 'tasks', body: taskGrantsPayload(d.tasks.mode, d.tasks.selection, d.nextRole) });
  }
  if (plan.grants) {
    out.push({
      kind: 'grants',
      body: {
        ...grantsPayload(d.selection, aliasOnlyGrants(d.original), { mode: d.nextMode, role: d.nextRole }),
        // 只在 Hub 支持分组时发 group_grants;不发 = Hub 保持原样(旧 Hub 也不认这个字段)。
        ...(d.groups ? { group_grants: groupGrantsPayload(d.groups.after, d.nextRole) } : {}),
      },
    });
  }
  return out;
}

/** 任务权限有没有改:按规整后的 payload 比(角色改成 viewer 时「可编辑」会被清掉,那也算改动)。 */
export function tasksChanged(t: NonNullable<MemberDraft['tasks']>, role: MemberRole): boolean {
  const normalized = new Map(taskGrantsPayload(t.mode, t.selection, role).project_grants.map(g => [g.project_id, g.can_edit] as [string, boolean]));
  return taskGrantsChanged(t.before, { mode: t.mode, selection: normalized });
}

export const memberEditorDirty = (d: MemberDraft): boolean => memberSaveRequests(d).length > 0;

// —— 已选 chip(宽屏「已选」托盘 / 手机选择页顶上那排)——

export type SelectedChip = { kind: 'agent' | 'group'; id: string; label: string; alias: string; canMessage: boolean };

/**
 * 已选的 Agent 与分组,一行一个 chip:分组在前(按名字),Agent 在后(按 alias)。
 * 授权里有、但节点清单里已经没有的 node_id(节点删了)也列出来(标签 = node_id),让管理员能把它移掉 ——
 * 以前它们在界面上看不见,只会随保存原样发回去。
 */
export function selectedChips(agents: readonly PickableAgent[] | null, selection: GrantSelection, groups: readonly HubAgentGroup[], groupSel: GrantSelection): SelectedChip[] {
  const byId = new Map((agents ?? []).map(a => [a.node_id, a] as const));
  const groupChips = groups.filter(g => groupSel.has(g.group_id)).map(g => ({ kind: 'group' as const, id: g.group_id, label: g.name, alias: g.name, canMessage: groupSel.get(g.group_id) === true }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const agentChips = [...selection.entries()].map(([id, can]) => {
    const a = byId.get(id);
    return { kind: 'agent' as const, id, label: a ? (a.display_name || a.alias) : id, alias: a?.alias ?? id, canMessage: can };
  }).sort((a, b) => a.alias.localeCompare(b.alias));
  return [...groupChips, ...agentChips];
}

// —— 选择器的清单 ——

/** 当前页签要画的分段:全部 = 一段无标题;按机器 / 按类型 = 每组一段(带三态头)。「分组」页签不走这里。 */
export function pickerSections(visible: readonly PickableAgent[], tab: PickerTab): AgentGroup[] {
  if (tab === 'host' || tab === 'runtime') return groupAgents(visible, tab);
  return [{ key: '', label: null, agents: [...visible] }];
}

/** 分组头右边的计数「已选 / 总数」与三态。 */
export function sectionCount(sel: GrantSelection, agents: readonly PickableAgent[]): { on: number; total: number; state: 'all' | 'some' | 'none' } {
  return { on: agents.filter(a => sel.has(a.node_id)).length, total: agents.length, state: selectionState(sel, agents) };
}

/** 「分组」页签按名字搜。 */
export function filterAgentGroups(groups: readonly HubAgentGroup[], query: string): HubAgentGroup[] {
  const q = query.trim().toLowerCase();
  return groups.filter(g => !q || g.name.toLowerCase().includes(q)).slice().sort((a, b) => a.name.localeCompare(b.name));
}

/** 「分组」页签的全选:把列出来的组都加上(已选的保持原样;新加的默认可对话,viewer 只读)。 */
export function selectGroups(sel: GrantSelection, groups: readonly HubAgentGroup[], role?: MemberRole): Map<string, boolean> {
  const next = new Map(sel);
  for (const g of groups) if (!next.has(g.group_id)) next.set(g.group_id, role !== 'viewer');
  return next;
}

/** 选择器的 Agent 行副标题「机器 · 类型」(都没有就不画)。 */
export function agentMeta(a: Pick<PickableAgent, 'hostname' | 'runtime'>): string {
  return [a.hostname, a.runtime].filter(v => !!v && String(v).trim()).join(' · ');
}

/** 可访问 Agent 的清单(与选择器同一个过滤:不含 daemon)。 */
export const pickableAgents = (agents: readonly PickableAgent[] | null): PickableAgent[] => filterPickable(agents ?? [], '');

/** 角色下面那一行说明的 i18n key。 */
export function roleHintKey(role: MemberRole): string {
  return role === 'viewer' ? 'users.roleHint.viewer' : role === 'admin' ? 'users.roleHint.admin' : 'users.roleHint.member';
}
