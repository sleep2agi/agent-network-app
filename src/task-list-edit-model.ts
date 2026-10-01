// 列表视图的就地编辑(owner 10-01:「任务列表里面要能像飞书多维表格一样能够直接编辑」)—— 纯逻辑,不 import react-native。
//   · 哪些格能改:标题 / 负责人(+ 负责 Agent)/ 优先级 / 期限 / 参与人 / 项目 / 状态 / 标签;只读的卡(viewer_can.edit=false)
//     只剩 hub 放开的字段(参与人:状态),其余格不响应、不画悬停框。
//   · 一次只改一个字段:每次编辑变成一个只带那一个字段的请求(PATCH / 状态走 move / 参与人走 assignments)。
//   · 先乐观改本地那一行,失败只把那一个字段退回原值(别的字段可能已经被另一次编辑改过)。
//   · 方向键在格子之间走(只在手里有鼠标的宽屏表格上;手机 / 平板手指照旧点行进详情)。
import { canEditTaskField } from './task-access';
import { normalizeTags } from './requirement-tags';
import { personKey, togglePerson, uniquePeople, type RequirementPersonRef } from './requirement-people';
import type { ReqColumn, ReqPriority, Requirement } from './requirements-model';
import type { EditPatch } from './task-board-model';
import type { FieldId } from './task-list-fields';

export const EDITABLE_CELLS: readonly FieldId[] = ['title', 'owner', 'priority', 'due', 'participants', 'project', 'status', 'tags'];

export type CellEdit =
  | { field: 'title'; name: string }
  | { field: 'owner'; owner: RequirementPersonRef | null }
  | { field: 'agent'; agentOwner: RequirementPersonRef | null }
  | { field: 'participants'; participants: RequirementPersonRef[] }
  | { field: 'priority'; priority: ReqPriority }
  | { field: 'due'; due: string }
  | { field: 'status'; column: ReqColumn }
  | { field: 'project'; projectId: string | null }
  | { field: 'tags'; tags: string[] };

/** 发给 Hub 的那一个请求。patch = PATCH /api/requirements/:id;move = 状态(同看板拖动);assign = 参与人(同详情)。 */
export type CellRequest =
  | { kind: 'patch'; patch: EditPatch }
  | { kind: 'move'; column: ReqColumn }
  | { kind: 'assign'; participants: RequirementPersonRef[] };

/**
 * 这一格我能不能就地改。不是可编辑的列(ID / 时间 / Issue)⇒ 不能;只读的卡只有 hub 放开的状态能改;
 * Hub 没这个字段(旧 Hub 的 owner / participants / tags / project_id 是 undefined)⇒ 不能,点了照旧进详情。
 */
export function cellEditable(item: Requirement, field: FieldId, ctx: { projects: boolean }): boolean {
  if (!EDITABLE_CELLS.includes(field) || item.archived) return false;
  if (field === 'status') return canEditTaskField(item, 'column');
  if (item.readOnly) return false;
  if (field === 'owner') return item.owner !== undefined;
  if (field === 'participants') return item.participants !== undefined;
  if (field === 'project') return ctx.projects && item.projectId !== undefined;
  if (field === 'tags') return item.tags !== undefined;
  return true;
}

const sameRef = (a: RequirementPersonRef | null | undefined, b: RequirementPersonRef | null | undefined) => (a ? personKey(a) : '') === (b ? personKey(b) : '');
const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** 编辑 → 请求;没变化 / 不合法(空标题、标签超限)⇒ null,什么都不发。 */
export function cellRequest(item: Requirement, edit: CellEdit): CellRequest | null {
  switch (edit.field) {
    case 'title': {
      const name = edit.name.trim();
      return name && name !== item.name ? { kind: 'patch', patch: { name } } : null;
    }
    case 'owner': return sameRef(item.owner, edit.owner) ? null : { kind: 'patch', patch: { owner: edit.owner ? { kind: edit.owner.kind, id: edit.owner.id } : null } };
    case 'agent': return sameRef(item.agentOwner, edit.agentOwner) ? null : { kind: 'patch', patch: { agent_owner: edit.agentOwner ? { kind: edit.agentOwner.kind, id: edit.agentOwner.id } : null } };
    case 'participants': {
      const next = uniquePeople(edit.participants);
      return sameList((item.participants ?? []).map(personKey), next.map(personKey)) ? null : { kind: 'assign', participants: next };
    }
    case 'priority': return edit.priority === item.priority ? null : { kind: 'patch', patch: { priority: edit.priority } };
    case 'due': return edit.due === item.due ? null : { kind: 'patch', patch: { due: edit.due } };
    case 'status': return edit.column === item.column ? null : { kind: 'move', column: edit.column };
    case 'project': return (item.projectId ?? null) === edit.projectId ? null : { kind: 'patch', patch: { project_id: edit.projectId } };
    case 'tags': {
      const tags = normalizeTags(edit.tags);
      return !tags || sameList(item.tags ?? [], tags) ? null : { kind: 'patch', patch: { tags } };
    }
  }
}

/** 乐观更新:只改这一个字段。 */
export function applyCellEdit(row: Requirement, edit: CellEdit): Requirement {
  switch (edit.field) {
    case 'title': return { ...row, name: edit.name.trim() };
    case 'owner': return { ...row, owner: edit.owner };
    case 'agent': return { ...row, agentOwner: edit.agentOwner };
    case 'participants': return { ...row, participants: uniquePeople(edit.participants) };
    case 'priority': return { ...row, priority: edit.priority };
    case 'due': return { ...row, due: edit.due };
    case 'status': return { ...row, column: edit.column };
    case 'project': return { ...row, projectId: edit.projectId };
    case 'tags': return { ...row, tags: normalizeTags(edit.tags) ?? row.tags };
  }
}

/** 失败退回:只把这一个字段换回编辑前的值,别的字段保持现在的样子。 */
export function rollbackCellEdit(row: Requirement, before: Requirement, edit: CellEdit): Requirement {
  switch (edit.field) {
    case 'title': return { ...row, name: before.name };
    case 'owner': return { ...row, owner: before.owner };
    case 'agent': return { ...row, agentOwner: before.agentOwner };
    case 'participants': return { ...row, participants: before.participants };
    case 'priority': return { ...row, priority: before.priority };
    case 'due': return { ...row, due: before.due };
    case 'status': return { ...row, column: before.column };
    case 'project': return { ...row, projectId: before.projectId };
    case 'tags': return { ...row, tags: before.tags };
  }
}

/** 参与人格里点一个人:有就去掉、没有就加上。 */
export const toggleParticipant = (item: Requirement, person: RequirementPersonRef): CellEdit => ({ field: 'participants', participants: togglePerson(item.participants ?? [], person, 'participants') });

/** 负责人格里点一个人:分两个角色时人类改负责人、Agent 改负责 Agent;再点一次已选的 = 清掉。旧 Hub 只有一个负责人。 */
export function pickOwner(item: Requirement, person: RequirementPersonRef, twoRoles: boolean): CellEdit {
  if (twoRoles && person.kind === 'node') return { field: 'agent', agentOwner: sameRef(item.agentOwner, person) ? null : { kind: 'node', id: person.id } };
  return { field: 'owner', owner: sameRef(item.owner, person) ? null : { kind: person.kind, id: person.id } };
}

/** 标签格里点一个标签 / 回车新建:有就去掉、没有就加在最后。 */
export function toggleTag(item: Requirement, tag: string): CellEdit {
  const cur = item.tags ?? [];
  const t = tag.trim();
  return { field: 'tags', tags: cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t] };
}

/** 加上这个标签以后还合不合法(最多 10 个、每个 1–20 字)。 */
export const tagAddable = (item: Requirement, tag: string): boolean => !!tag.trim() && (item.tags ?? []).includes(tag.trim()) === false && normalizeTags([...(item.tags ?? []), tag]) !== null;

export type CellPos = { row: string; field: FieldId };

/**
 * 选中格的键盘:↑↓←→ 走一格(到边就停)、Tab / Shift+Tab 左右、回车 / F2 打开编辑、Esc 取消选中。
 * 看不懂的键 ⇒ null(交给别人)。
 */
export function cellKey(pos: CellPos, key: string, shift: boolean, rows: readonly string[], fields: readonly FieldId[]): { move: CellPos } | { open: true } | { clear: true } | null {
  if (key === 'Enter' || key === 'F2') return { open: true };
  if (key === 'Escape') return { clear: true };
  const r = rows.indexOf(pos.row), c = fields.indexOf(pos.field);
  if (r < 0 || c < 0) return null;
  const step = key === 'ArrowUp' ? [-1, 0] : key === 'ArrowDown' ? [1, 0] : key === 'ArrowLeft' || (key === 'Tab' && shift) ? [0, -1] : key === 'ArrowRight' || key === 'Tab' ? [0, 1] : null;
  if (!step) return null;
  const nr = Math.min(rows.length - 1, Math.max(0, r + step[0]));
  const nc = Math.min(fields.length - 1, Math.max(0, c + step[1]));
  return { move: { row: rows[nr], field: fields[nc] } };
}
