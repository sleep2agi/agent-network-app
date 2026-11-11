// 节点管理授权的纯模型(admin 11-11「节点的权限要好好设计」)。Hub 端见 agent-network server/src/node-grants.ts。
// 能力 × 范围 × 级别:schedules(定时任务)现在可用;board(看板)计划中,界面里显示但不可选。
import type { NodeGrant } from './api';
import { t } from './i18n';
import './i18n-node-grants';
import type { DeptChoice, NodeChoice } from './node-allowlist-model';

export const GRANT_CAPABILITIES = [
  { key: 'schedules', available: true },
  { key: 'board', available: false },
] as const;

export type GrantDraft = Pick<NodeGrant, 'capability' | 'scope_kind' | 'scope_id' | 'level'>;

export const capabilityLabel = (c: string) => (c === 'schedules' || c === 'board' ? t(`nodeGrants.cap.${c}`) : c);

export function scopeLabel(g: Pick<NodeGrant, 'scope_kind' | 'scope_id'>, depts: readonly DeptChoice[], nodes: readonly NodeChoice[]): string {
  if (g.scope_kind === 'network') return t('nodeGrants.scope.network');
  if (g.scope_kind === 'department') return t('nodeGrants.scope.department', { name: depts.find(d => d.id === g.scope_id)?.path || g.scope_id });
  const n = nodes.find(x => x.node_id === g.scope_id);
  return t('nodeGrants.scope.node', { name: n?.alias || g.scope_id });
}

export const levelLabel = (l: string) => t(l === 'read' ? 'nodeGrants.level.read' : 'nodeGrants.level.edit');

export function grantLine(g: GrantDraft, depts: readonly DeptChoice[], nodes: readonly NodeChoice[]): string {
  return `${capabilityLabel(g.capability)} · ${scopeLabel(g, depts, nodes)} · ${levelLabel(g.level)}`;
}

export const sameGrantSlot = (a: GrantDraft, b: GrantDraft) => a.capability === b.capability && a.scope_kind === b.scope_kind && a.scope_id === b.scope_id;

/** 加一条:同一「能力 + 范围」已存在就替换级别,不重复。 */
export function addGrant(list: readonly GrantDraft[], g: GrantDraft): GrantDraft[] {
  return [...list.filter(x => !sameGrantSlot(x, g)), g];
}
export function removeGrant(list: readonly GrantDraft[], g: GrantDraft): GrantDraft[] {
  return list.filter(x => !sameGrantSlot(x, g));
}

/** 草稿能不能提交:部门 / 节点范围必须选了对象。 */
export const draftComplete = (g: GrantDraft) => g.scope_kind === 'network' || !!g.scope_id;

/** Hub 的拒绝 → 人话。 */
export function grantErrorText(r: { status: number; error: string; message?: string }): string {
  if (r.status === 403) return t('nodeGrants.err.forbidden');
  if (r.error === 'capability_not_supported') return t('nodeGrants.err.notSupported');
  if (r.error === 'department_not_found' || r.error === 'node_not_found') return t('nodeGrants.err.scopeGone');
  return t('nodeGrants.err.generic', { error: r.message || r.error });
}
