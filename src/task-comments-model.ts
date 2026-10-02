// 任务详情「评论」的纯逻辑(#474)。组件在 TaskComments.tsx;数据是 Hub 任务动态里 kind = comment 的事件。
import type { RequirementPersonRef } from './requirement-people';
import { commentText, type ActivityEvent } from './task-activity-model';

/** 先显示最近这么多条,更早的点「还有 N 条」展开。 */
export const COMMENTS_SHOWN = 20;

export interface CardComment { id: string; actor: RequirementPersonRef | null; text: string; ms: number; at: string }

const pad = (n: number) => String(n).padStart(2, '0');
/** 本地时间「2026-10-02 19:05」(动态列表里存的是 UTC ISO)。 */
export function localStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 一张卡的动态 → 评论,旧 → 新;空正文的丢掉。 */
export function cardComments(events: readonly ActivityEvent[]): CardComment[] {
  return events
    .filter(e => e.kind === 'comment')
    .map(e => ({ id: e.id, actor: e.actor, text: commentText(e), ms: e.ms, at: localStamp(e.ms) }))
    .filter(c => c.text.trim().length > 0)
    .sort((a, b) => a.ms - b.ms || (Number(a.id) - Number(b.id)));
}
