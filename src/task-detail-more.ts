// 任务详情的「更多」:收起时,里面有值的字段在那一行上一句话说出来(owner 09-29:详情太长,改成渐进展开;
// 但设过的东西不能被悄悄藏掉)。纯逻辑,不 import react-native;文案键在 i18n-tasks.ts。
import type { Requirement } from './requirements-model';
import type { EditDraft } from './task-board-model';

export type SummaryPart = { key: string; values?: Record<string, string | number> };

/**
 * 顺序同「更多」里面的顺序:开始 · 母任务 · Issue。没值的不说。
 * #701 起子任务、检查项(左栏「子任务」)和标签(右栏属性)常显,不再进摘要;优先级在头部 pill,参与人在属性里。
 */
export function moreSummary(item: Requirement, draft: Pick<EditDraft, 'parentId'> & { start?: string }, items: readonly Requirement[]): SummaryPart[] {
  const out: SummaryPart[] = [];
  const start = draft.start?.trim().slice(0, 10);
  if (start && /^\d{4}-\d{2}-\d{2}$/.test(start)) out.push({ key: 'detail.sumStart', values: { m: +start.slice(5, 7), d: +start.slice(8, 10) } });
  if (draft.parentId) {
    const parent = items.find(i => i.id === draft.parentId);
    out.push(parent ? { key: 'detail.sumParent', values: { name: parent.name } } : { key: 'detail.sumParentUnknown' });
  }
  const issues = item.issues?.length ?? 0;
  if (issues) out.push({ key: 'detail.sumIssues', values: { n: issues } });
  return out;
}

/** 本机存的「更多」展开状态:'1' / '0';别的(没存过、坏值)= null,按收起。 */
export const parseMoreOpen = (raw: unknown): boolean | null => (raw === '1' || raw === true ? true : raw === '0' || raw === false ? false : null);
