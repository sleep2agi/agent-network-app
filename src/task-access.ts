// 任务(需求卡)的人员权限 —— 客户端纯逻辑(hub RFC-038 §9,agent-network#2163)。不 import react-native。
//
// Hub 上每个成员有一个 task_access:'all'(全部任务,旧语义)或 'scoped'(仅相关任务 = 我负责 / 我参与 / 我建的,
// 加上授权给他的项目;项目可以只看或可编辑)。这里只做 UI 需要的:授权的读写形状、切换时的预填、有没有改动,
// 以及看板上「这张卡我能不能改」。Hub 不支持(没有 task-grants 接口、auth/me 里没有 task_access)⇒ 整块不出现。

import type { AuthMe, MemberRole } from './user-admin';

export type TaskAccess = 'all' | 'scoped';
/** 编辑中的项目授权:project_id → 可编辑。 */
export type ProjectGrantSelection = ReadonlyMap<string, boolean>;
export type ProjectGrant = { project_id: string; can_edit: boolean };
/** 选择器里的一个项目(与看板的 RequirementProject 同形的子集)。 */
export type GrantableProject = { id: string; name: string; color?: string; archived?: boolean; sort?: number };

/** GET …/task-grants 的响应 → 编辑状态。缺字段按 scoped + 无授权(与 hub 的 fail-closed 同向)。 */
export function taskGrantsFromHub(resp: { task_access?: unknown; project_grants?: unknown } | null | undefined): { mode: TaskAccess; selection: Map<string, boolean> } {
  const mode: TaskAccess = resp?.task_access === 'all' ? 'all' : 'scoped';
  const selection = new Map<string, boolean>();
  if (Array.isArray(resp?.project_grants)) {
    for (const g of resp!.project_grants as unknown[]) {
      const r = g as { project_id?: unknown; can_edit?: unknown };
      if (typeof r?.project_id === 'string' && r.project_id) selection.set(r.project_id, r.can_edit === true);
    }
  }
  return { mode, selection };
}

/** PUT …/task-grants 的 body(整体替换)。按 project_id 排序;viewer 一律只看(hub 上 viewer 本来就不能改)。 */
export function taskGrantsPayload(mode: TaskAccess, sel: ProjectGrantSelection, role?: MemberRole): { task_access: TaskAccess; project_grants: ProjectGrant[] } {
  const viewer = role === 'viewer';
  const project_grants = [...sel.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([project_id, can_edit]) => ({ project_id, can_edit: viewer ? false : can_edit }));
  return { task_access: mode, project_grants };
}

/** 有没有改动(没改就不发请求)。 */
export function taskGrantsChanged(before: { mode: TaskAccess; selection: ProjectGrantSelection }, after: { mode: TaskAccess; selection: ProjectGrantSelection }): boolean {
  if (before.mode !== after.mode) return true;
  if (before.selection.size !== after.selection.size) return true;
  for (const [k, v] of after.selection) if (before.selection.get(k) !== v) return true;
  return false;
}

/**
 * 从「全部任务」切到「仅相关任务」:还一个项目都没勾时,预填全部未归档项目、只看 —— 一点保存不会把人清空
 * (与 Agent 权限切「仅指定」时的预填同一个思路,RFC-038 §9.4)。已经勾过的原样保留。
 */
export function prefillProjectsOnScope(sel: ProjectGrantSelection, projects: readonly GrantableProject[]): Map<string, boolean> {
  if (sel.size) return new Map(sel);
  return new Map(projects.filter(p => !p.archived).map(p => [p.id, false] as [string, boolean]));
}

/** 勾选 / 取消一个项目;新勾上的默认只看。 */
export function toggleProject(sel: ProjectGrantSelection, projectId: string): Map<string, boolean> {
  const next = new Map(sel);
  if (next.has(projectId)) next.delete(projectId); else next.set(projectId, false);
  return next;
}

export function setProjectEditable(sel: ProjectGrantSelection, projectId: string, canEdit: boolean): Map<string, boolean> {
  const next = new Map(sel);
  if (next.has(projectId)) next.set(projectId, canEdit);
  return next;
}

/** 选择器里列哪些项目:未归档的 + 已归档但已经授权的(别让已有授权消失在界面外);按 sort、名字。 */
export function grantableProjects(projects: readonly GrantableProject[], sel: ProjectGrantSelection): GrantableProject[] {
  return projects
    .filter(p => !p.archived || sel.has(p.id))
    .slice()
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name));
}

/** 当前网络里我是不是「仅相关任务」的成员(看板空态文案用)。旧 Hub 没有 task_access ⇒ 不是。 */
export function isTaskScopedIn(me: AuthMe | null | undefined, networkId: string | undefined): boolean {
  const row = (me?.networks ?? []).find(n => n.network_id === networkId) as { task_access?: unknown } | undefined;
  return row?.task_access === 'scoped';
}

/**
 * 卡片对我是不是只读:hub 只对 scoped 调用者在每张卡上给 viewer_can;没有这个字段(旧 Hub / 全部任务的人)⇒ 能改。
 * 只认显式的 edit === false —— 看不懂的值按能改处理,最坏是 hub 回 403,不会把能改的卡锁死。
 */
export function readOnlyFromHub(row: Record<string, unknown>): boolean {
  const can = row.viewer_can as { edit?: unknown } | undefined;
  return !!can && typeof can === 'object' && can.edit === false;
}
