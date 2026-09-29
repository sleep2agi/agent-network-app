// 任务详情的「更多」:收起时,里面有值的字段在那一行上一句话说出来(owner 09-29:详情太长,改成渐进展开;
// 但设过的东西不能被悄悄藏掉)。纯逻辑,不 import react-native;文案键在 i18n-tasks.ts。
import type { Requirement } from './requirements-model';
import type { EditDraft } from './task-board-model';

export type SummaryPart = { key: string; values?: Record<string, string | number> };

/** 顺序同「更多」里面的顺序:优先级 · 母任务 · 子任务 · 检查项 · 参与人 · Issue · 标签。没值的不说。 */
export function moreSummary(item: Requirement, draft: Pick<EditDraft, 'priority' | 'parentId'>, items: readonly Requirement[]): SummaryPart[] {
  const out: SummaryPart[] = [];
  if (draft.priority === 'high') out.push({ key: 'detail.sumHigh' });
  else if (draft.priority === 'low') out.push({ key: 'detail.sumLow' });
  else if (draft.priority === 'lowest') out.push({ key: 'detail.sumLowest' });
  if (draft.parentId) {
    const parent = items.find(i => i.id === draft.parentId);
    out.push(parent ? { key: 'detail.sumParent', values: { name: parent.name } } : { key: 'detail.sumParentUnknown' });
  }
  const kids = item.children?.total ?? items.filter(i => i.parentId === item.id).length;
  if (kids) out.push({ key: 'detail.sumChildren', values: { n: kids } });
  const list = item.checklist ?? [];
  if (list.length) out.push({ key: 'detail.sumChecklist', values: { done: list.filter(c => c.done).length, n: list.length } });
  const people = item.participants?.length ?? 0;
  if (people) out.push({ key: 'detail.sumParticipants', values: { n: people } });
  const issues = item.issues?.length ?? 0;
  if (issues) out.push({ key: 'detail.sumIssues', values: { n: issues } });
  const tags = item.tags?.length ?? 0;
  if (tags) out.push({ key: 'detail.sumTags', values: { n: tags } });
  return out;
}

/** 本机存的「更多」展开状态:'1' / '0';别的(没存过、坏值)= null,按收起。 */
export const parseMoreOpen = (raw: unknown): boolean | null => (raw === '1' || raw === true ? true : raw === '0' || raw === false ? false : null);
