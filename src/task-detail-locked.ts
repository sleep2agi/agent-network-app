// 参与人的卡(hub viewer_can.edit_fields):详情里改不了的字段画成「标签 + 值」的纯文字,不画输入框 / 下拉箭头 /
// 快捷日期 / 富文本工具栏 —— 看起来能点、点了没反应,比直接说「只能看」更糟。纯逻辑,不 import react-native。
import { t } from './i18n';
import { taskText } from './i18n-tasks';
import './i18n-task-tags';
import './i18n-task-issues';
import { formatDueFull, personName } from './i18n-task-presentation';
import { childrenOf, hasDetails, hasRoles } from './task-board-model';
import { priorityLabel } from './task-priority';
import { REQ_COLUMN_LABEL, type Requirement, type RequirementProject } from './requirements-model';
import type { RequirementPerson } from './requirement-people';

export type LockedRow = { key: string; label: string; value: string; multiline?: boolean };

const NONE = '—';

/** 常显区:负责人 · 负责 Agent · 项目 · 预计完成 · 描述(与可编辑时的顺序一样)。 */
export function lockedMainRows(item: Requirement, people: readonly RequirementPerson[], projects: readonly RequirementProject[] | null): LockedRow[] {
  const rows: LockedRow[] = [];
  const unassigned = t('tasks.copy.6');
  if (item.owner === undefined) rows.push({ key: 'owner', label: t('tasks.copy.15'), value: item.assignee || unassigned });
  else rows.push({ key: 'owner', label: t('tasks.copy.15'), value: item.owner ? personName(item.owner, people) : unassigned });
  if (hasRoles(item)) rows.push({ key: 'agent', label: t('tasks.copy.82'), value: item.agentOwner ? personName(item.agentOwner, people) : unassigned });
  if (projects && item.projectId !== undefined) {
    const p = item.projectId ? projects.find(x => x.id === item.projectId) : null;
    rows.push({ key: 'project', label: t('tasks.copy.30'), value: p?.name || t('tasks.copy.31') });
  }
  rows.push({ key: 'due', label: t('tasks.copy.119'), value: item.due ? formatDueFull(item.due) || item.due : NONE });
  if (hasDetails(item)) rows.push({ key: 'description', label: t('tasks.copy.125'), value: item.description?.trim() || NONE, multiline: true });
  return rows;
}

/** 「更多」里检查项以上的:开始 · 优先级 · 母任务 · 子任务。 */
export function lockedMoreRows(item: Requirement, items: readonly Requirement[]): LockedRow[] {
  const rows: LockedRow[] = [];
  if (item.start !== undefined) rows.push({ key: 'start', label: t('detail.start'), value: item.start || NONE });
  rows.push({ key: 'priority', label: t('tasks.copy.32'), value: priorityLabel(item.priority) });
  if (item.parentId !== undefined) {
    const parent = item.parentId ? items.find(i => i.id === item.parentId) : null;
    rows.push({ key: 'parent', label: t('taskSel.parent'), value: parent?.name || NONE });
  }
  const kids = childrenOf(items, item.id);
  if (kids.length) rows.push({ key: 'children', label: t('tasks.copy.218'), value: kids.map(k => `${k.name}(${taskText(REQ_COLUMN_LABEL[k.column])})`).join('\n'), multiline: true });
  return rows;
}

/** 「更多」里检查项以下的:参与人 · Issue · 标签 · 创建时间。 */
export function lockedRestRows(item: Requirement, people: readonly RequirementPerson[]): LockedRow[] {
  const rows: LockedRow[] = [];
  if (item.owner !== undefined) rows.push({ key: 'participants', label: t('tasks.copy.53'), value: (item.participants ?? []).map(r => personName(r, people)).join('、') || NONE });
  if (item.issues?.length) rows.push({ key: 'issues', label: t('issues.heading'), value: item.issues.map(i => `${i.repo}#${i.number}${i.title ? ` ${i.title}` : ''}`).join('\n'), multiline: true });
  if (item.tags !== undefined) rows.push({ key: 'tags', label: t('tags.title'), value: item.tags.length ? item.tags.join('、') : NONE });
  if (item.createdAt) rows.push({ key: 'created', label: t('tasks.copy.139').replace(/[:：]\s*$/, ''), value: item.createdAt.slice(0, 10) });
  return rows;
}
