// 定时任务「复制」(owner 2026-09-29:「这个定时任务要支持一下复制的功能…然后可以去改里面的东西」)。
//
// 复制 = 用源计划预填**新建**表单,保存走 POST /api/scheduled-tasks,源计划一个字节不动。
// 单次计划的时间若已过去(复制一条跑完的单次计划是最常见的用法),顺延整天到下一个未来的同一时刻,
// 并把原时间交给表单显示提示 —— 不静默保存一个过去的时间(Hub 收到过去的 run_at 会立即执行)。
// 纯函数,不碰 RN,ck 测试直接跑(schedule-copy.test.ts)。
import type { HubScheduledTask, HubScheduleSpec } from './api';
import { fieldsOf, type ScheduleEditFields } from './schedule-edit-merge';

const DAY_MS = 86_400_000;
/** 顺延后至少离现在这么远,免得刚打开表单时间就又过去了。 */
const MIN_LEAD_MS = 5 * 60_000;

export interface ScheduleCopyDraft {
  fields: ScheduleEditFields;
  /** 单次计划的原时间已过、被顺延时 = 原 run_at;否则 null。 */
  adjustedFrom: string | null;
}

const cloneSpec = (spec: HubScheduleSpec): HubScheduleSpec =>
  spec.type === 'weekly' ? { ...spec, weekdays: [...spec.weekdays] } : { ...spec };

/** 过去的时刻按整天往后挪到 ≥ now + 5 分钟(保留几点几分);未来的原样返回。 */
export function nextFutureRunAt(runAt: string, nowMs: number): string {
  const at = Date.parse(runAt);
  if (!Number.isFinite(at)) return new Date(nowMs + DAY_MS).toISOString();
  if (at >= nowMs + MIN_LEAD_MS) return runAt;
  const days = Math.ceil((nowMs + MIN_LEAD_MS - at) / DAY_MS);
  return new Date(at + days * DAY_MS).toISOString();
}

/** 源计划 → 新建表单的草稿。suffix 由调用方按界面语言给(t('schedules.copy.suffix'))。 */
export function scheduleCopyDraft(source: HubScheduledTask, nowMs: number, suffix: string): ScheduleCopyDraft {
  const base = fieldsOf(source);
  let schedule = cloneSpec(base.schedule);
  let adjustedFrom: string | null = null;
  if (schedule.type === 'once') {
    const runAt = nextFutureRunAt(schedule.run_at, nowMs);
    if (runAt !== schedule.run_at) { adjustedFrom = schedule.run_at; schedule = { type: 'once', run_at: runAt }; }
  }
  return { fields: { ...base, name: `${source.name}${suffix}`, schedule }, adjustedFrom };
}
