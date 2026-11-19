// 右侧「项管」页签的筛选（纯函数，单测用）：项管表里和这个 agent 有关的卡 ——
// 负责 Agent / 负责人 / 参与者指向它（按 node_id 或 alias），或旧 Hub 的 assignee 写的是它的名字。
import type { Requirement } from './requirements-model';

const DONE_LIMIT = 8;

export function requirementsForAgent(rows: readonly Requirement[], who: { alias: string; nodeId: string | null }): { doing: Requirement[]; pool: Requirement[]; done: Requirement[] } {
  const ids = new Set([who.alias, who.nodeId].filter((x): x is string => !!x));
  const hit = (r: Requirement) =>
    (r.agentOwner && ids.has(r.agentOwner.id)) ||
    (r.owner && ids.has(r.owner.id)) ||
    (r.participants ?? []).some(p => ids.has(p.id)) ||
    (!!r.assignee && r.assignee.trim() === who.alias);
  const mine = rows.filter(r => !r.archived && hit(r));
  const byTime = (a: Requirement, b: Requirement) => String((b as { updatedAt?: string }).updatedAt ?? '').localeCompare(String((a as { updatedAt?: string }).updatedAt ?? ''));
  return {
    doing: mine.filter(r => r.column === 'doing').sort(byTime),
    pool: mine.filter(r => r.column === 'pool').sort(byTime),
    done: mine.filter(r => r.column === 'done').sort(byTime).slice(0, DONE_LIMIT),
  };
}
