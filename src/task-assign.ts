// 从看板直接指派:卡片菜单「指派负责人… / 设置参与人…」、点卡片上的参与人头像、批量条「指派负责人…」。
// 纯逻辑,不 import react-native。写入只带改了的那一个字段(owner / participants),和详情里同一个 PATCH。
import type { Requirement } from './requirements-model';
import { personKey, uniquePeople, type RequirementPersonRef } from './requirement-people';

/** 一次指派改的字段(Requirement 上的名字)。只会带一个键。 */
export type AssignChange = { owner?: RequirementPersonRef | null; agentOwner?: RequirementPersonRef | null; participants?: RequirementPersonRef[] };

/**
 * 菜单里两项怎么画:hidden = 这个 Hub 没有稳定负责人 / 参与人(旧 Hub 的卡),不给入口;
 * locked = 卡对我只读(viewer_can.edit=false;参与人放开的 edit_fields 只有状态和检查项,Hub 拒绝改人);on = 能改。
 */
export function assignAccess(item: Pick<Requirement, 'owner' | 'participants' | 'readOnly'>): 'on' | 'locked' | 'hidden' {
  if (item.owner === undefined || item.participants === undefined) return 'hidden';
  return item.readOnly ? 'locked' : 'on';
}

export const canAssignPeople = (item: Pick<Requirement, 'owner' | 'participants' | 'readOnly'>): boolean => assignAccess(item) === 'on';

/** 选了负责人:和现在一样 = null(不发请求)。 */
export function ownerChange(item: Pick<Requirement, 'owner'>, picked: readonly RequirementPersonRef[]): AssignChange | null {
  const next = picked[0] ? { kind: picked[0].kind, id: picked[0].id } : null;
  const before = item.owner ? personKey(item.owner) : '';
  return before === (next ? personKey(next) : '') ? null : { owner: next };
}

/** 参与人选择器只列人类(同新建对话框):打开时只带入人类那几位。 */
export const humanParticipants = (item: Pick<Requirement, 'participants'>): RequirementPersonRef[] =>
  uniquePeople((item.participants ?? []).filter(p => p.kind === 'user'));

/**
 * 选完参与人:人类按选的来,原来就有的 Agent 参与人原样留着(选择器里看不到它们,不能被悄悄删掉)。
 * 和现在是同一组人 = null(不发请求)。
 */
export function participantsChange(item: Pick<Requirement, 'participants'>, pickedHumans: readonly RequirementPersonRef[]): AssignChange | null {
  const cur = uniquePeople(item.participants ?? []);
  const next = uniquePeople([...pickedHumans.filter(p => p.kind === 'user'), ...cur.filter(p => p.kind !== 'user')]);
  const same = next.length === cur.length && next.every(p => cur.some(c => personKey(c) === personKey(p)));
  return same ? null : { participants: next };
}

/** 批量指派负责人:能改的卡才发;只读的 / 旧 Hub 的卡跳过,数出来告诉人。 */
export function bulkOwnerPlan(items: readonly Requirement[], ids: readonly string[]): { editable: string[]; skipped: number } {
  const editable: string[] = [];
  let skipped = 0;
  for (const id of ids) {
    const item = items.find(i => i.id === id);
    if (!item) continue;
    if (canAssignPeople(item)) editable.push(id); else skipped++;
  }
  return { editable, skipped };
}

/** 这次改动回退时要恢复的字段(只恢复改了的那个)。 */
export function revertAssign(row: Requirement, prev: Requirement, change: AssignChange): Requirement {
  const out: Requirement = { ...row };
  if (change.owner !== undefined) out.owner = prev.owner;
  if (change.agentOwner !== undefined) out.agentOwner = prev.agentOwner;
  if (change.participants !== undefined) out.participants = prev.participants;
  return out;
}
