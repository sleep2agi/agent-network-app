// 列表每行的「最新一条动态」(#506,Hub capability `last_event`,agent-network#2308,Hub ≥ 0.9.0-preview.97)。
// 纯逻辑(解析 + 选用哪一条,不拼文字):requirements-hub.ts 读行、排序用;怎么说成一句话在 task-card-activity.ts。
//
// Hub 给的形状(docs/requirements-assignments.md「列表每行的最新动态」):
//   { type: 'created' | 'changed' | 'comment', field: string | null,
//     actor: { id, kind: 'user' | 'node', display_name: string | null } | null,
//     at: ISO, summary?: string }
// 评论也算(评论不改卡,所以 updated_at 不动,只有这里看得见)。没有流水的卡 = null;旧 Hub 不给这个字段 = undefined。
import type { RequirementPersonRef } from './requirement-people';
import type { Requirement } from './requirements-model';
import { taskTimestamp } from './task-time';

export interface RequirementLastEvent {
  /** created / changed / comment;Hub 以后加的新类型原样留着,显示时按「更新了」。 */
  type: string;
  /** changed 时改的字段(column / priority / title / owner …);其余为 null。 */
  field: string | null;
  actor: RequirementPersonRef | null;
  /** Hub 按 people 同一规则给的名字;本机名单里找不到这个人时用它。 */
  actorName: string | null;
  at: string;
  /** 评论正文(已压空白、≤120 字)/ column 等的「旧 → 新」原始值 / 新标题 …;没有 = null。 */
  summary: string | null;
}

/** Hub 的 last_event → 解析结果。null / 形状不对 / at 读不懂 = null(按旧行为显示,不抛)。 */
export function lastEventFromHub(value: unknown): RequirementLastEvent | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.type !== 'string' || !v.type) return null;
  if (typeof v.at !== 'string' || !Number.isFinite(Date.parse(v.at))) return null;
  const a = v.actor && typeof v.actor === 'object' ? v.actor as Record<string, unknown> : null;
  const actor = a && (a.kind === 'user' || a.kind === 'node') && typeof a.id === 'string' && a.id ? { kind: a.kind, id: a.id } as RequirementPersonRef : null;
  const actorName = actor && typeof a!.display_name === 'string' && a!.display_name.trim() ? a!.display_name.trim() : null;
  return {
    type: v.type,
    field: typeof v.field === 'string' && v.field ? v.field : null,
    actor,
    actorName,
    at: v.at,
    summary: typeof v.summary === 'string' && v.summary.trim() ? v.summary : null,
  };
}

/** last_event 比 updated_at 早这么多以上 = 它不是最近那次动静(updated_at 被顺带推后 / 本机刚改完、行还带着旧的 last_event),退回按 updated_at 说。 */
const STALE_MS = 2000;

/** 要不要用 last_event:有、读得懂、而且不比 updated_at 旧(见 STALE_MS)。 */
export function usableEvent(item: Pick<Requirement, 'updatedAt' | 'lastEvent'>): { ev: RequirementLastEvent; ms: number } | null {
  const ev = item.lastEvent;
  if (!ev) return null;
  const ms = taskTimestamp(ev.at);
  if (ms === null) return null;
  const upd = taskTimestamp(item.updatedAt);
  if (upd !== null && upd - ms > STALE_MS) return null;
  return { ev, ms };
}

/** 卡片「最近动静」用的时刻(毫秒):last_event 可用就用它(评论比 updated_at 新),否则 updated_at;都没有 = null。「更新时间」列排序也用它。 */
export function activityTime(item: Pick<Requirement, 'updatedAt' | 'lastEvent'>): number | null {
  return usableEvent(item)?.ms ?? taskTimestamp(item.updatedAt);
}
