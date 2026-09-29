// 定时任务编辑遇到 409 revision_conflict 时,草稿怎么办(owner 2026-09-29:每 2 分钟跑一次的计划,
// 编辑中途跑了一次 → 保存 409 → 草稿被整个扔掉)。
//
// 旧 Hub(≤ .66)每次执行都把 revision +1,所以「编辑中途跑了一次」和「别的设备改了」都是 409。
// 这里按字段三方比较:base = 打开编辑时的那份,draft = 用户现在的表单,latest = 冲突后重新读的那份。
//   · 用户改过的字段 ∩ 服务器改过的字段 = ∅(只差执行状态,或别人改的是别的字段)→ 合并后自动重试一次;
//   · 有交集且两边值不同 → 冲突视图,由用户选。
// 纯函数,不碰 RN,ck 测试直接跑(schedule-edit-merge.test.ts)。
import type { HubScheduledTask, HubScheduleSpec, ScheduledTaskMutationInput } from './api';

export type ScheduleEditFields = ScheduledTaskMutationInput;
export type ScheduleEditKey = keyof ScheduleEditFields;
export const SCHEDULE_EDIT_KEYS: readonly ScheduleEditKey[] = ['name', 'target_node_id', 'task', 'priority', 'timezone', 'schedule', 'misfire_policy'];

/** 服务器行 → 表单能改的那几项(与 ScheduleFormModal 回填同一口径)。 */
export function fieldsOf(row: HubScheduledTask): ScheduleEditFields {
  return {
    name: row.name,
    target_node_id: row.target_node_id,
    task: row.task_content,
    priority: row.priority,
    timezone: row.timezone,
    schedule: row.schedule,
    misfire_policy: row.misfire_policy || 'catch_up_once',
  };
}

// 单次计划的时间在表单里是「到分钟」的本地时间,回写时秒被截掉;按分钟比,免得没动也算改了。
const minuteOf = (iso: string) => {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 60_000) : iso;
};

function sameSchedule(a: HubScheduleSpec, b: HubScheduleSpec): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'once' && b.type === 'once') return minuteOf(a.run_at) === minuteOf(b.run_at);
  if (a.type === 'interval' && b.type === 'interval') return a.every_seconds === b.every_seconds;
  if (a.type === 'daily' && b.type === 'daily') return a.time === b.time;
  if (a.type === 'weekly' && b.type === 'weekly') {
    const x = [...a.weekdays].sort(), y = [...b.weekdays].sort();
    return a.time === b.time && x.length === y.length && x.every((d, i) => d === y[i]);
  }
  return false;
}

export function sameField<K extends ScheduleEditKey>(key: K, a: ScheduleEditFields[K], b: ScheduleEditFields[K]): boolean {
  if (key === 'schedule') return sameSchedule(a as HubScheduleSpec, b as HubScheduleSpec);
  if (typeof a === 'string' && typeof b === 'string') return a.trim() === b.trim();
  return a === b;
}

export function changedKeys(from: ScheduleEditFields, to: ScheduleEditFields): ScheduleEditKey[] {
  return SCHEDULE_EDIT_KEYS.filter(key => !sameField(key, from[key], to[key]));
}

/** 用户改过的字段取草稿,其余取最新;`theirs` 时两边都改了的字段也取最新。 */
export function mergeDraft(base: HubScheduledTask, latest: HubScheduledTask, draft: ScheduleEditFields, prefer: 'mine' | 'theirs' = 'mine'): ScheduleEditFields {
  const from = fieldsOf(base), now = fieldsOf(latest);
  const mine = new Set(changedKeys(from, draft));
  const theirs = new Set(changedKeys(from, now));
  const out = { ...now } as Record<ScheduleEditKey, unknown>;
  for (const key of SCHEDULE_EDIT_KEYS) {
    if (!mine.has(key)) continue;
    if (prefer === 'theirs' && theirs.has(key)) continue;
    out[key] = draft[key];
  }
  return out as ScheduleEditFields;
}

export type ConflictPlan =
  /** 没有真冲突:带着合并结果、以最新 revision 重试。 */
  | { kind: 'retry'; base: HubScheduledTask; input: ScheduleEditFields }
  /** 同一字段两边改成了不同值:给用户看。keys 按表单顺序。 */
  | { kind: 'conflict'; base: HubScheduledTask; keys: ScheduleEditKey[] }
  /** 计划已不在列表里(被取消/删掉):草稿留着,只报错。 */
  | { kind: 'gone' };

export function planConflict(base: HubScheduledTask, latest: HubScheduledTask | null | undefined, draft: ScheduleEditFields): ConflictPlan {
  if (!latest) return { kind: 'gone' };
  const from = fieldsOf(base), now = fieldsOf(latest);
  const theirs = new Set(changedKeys(from, now));
  const keys = changedKeys(from, draft).filter(key => theirs.has(key) && !sameField(key, draft[key], now[key]));
  if (keys.length) return { kind: 'conflict', base: latest, keys };
  return { kind: 'retry', base: latest, input: mergeDraft(base, latest, draft) };
}
