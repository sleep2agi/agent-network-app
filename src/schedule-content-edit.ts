// 定时任务详情页「全屏」里直接改任务内容(owner 09-30「定时任务…也需要全屏以及支持语音输入」)。
// 纯逻辑,不 import RN / api(api 的调用由调用方传进来),ck 测试直接跑(schedule-content-edit.test.ts)。
//
// 保存只发 revision + task(updateScheduledTaskContent),其余字段 Hub 保持原样。
// 409 revision_conflict 的处理和编辑表单(schedule-edit-merge.ts)同一个口径,草稿任何分支都不丢:
//   · 重新读;计划没了 → gone;
//   · 最新那份的任务内容和打开时一样(只是跑了一次 / 别人改的是别的字段),或者已经和草稿一样
//     → 用最新 revision 自动重试一次(还 409 就停下让用户再点);
//   · 任务内容被别处改成了别的 → conflict,给用户选「用我的覆盖」/「用最新的」。
import type { HubScheduledTask } from './api';

export const SCHEDULE_CONTENT_MAX = 10_000;

export type ContentSaveDeps = {
  patch: (row: HubScheduledTask, task: string) => Promise<{ schedule?: HubScheduledTask }>;
  refetch: (scheduleId: string) => Promise<HubScheduledTask | null | undefined>;
};

export type ContentSaveResult =
  | { kind: 'saved'; schedule: HubScheduledTask | null }
  | { kind: 'conflict'; latest: HubScheduledTask }
  | { kind: 'gone' }
  | { kind: 'retryAgain'; latest: HubScheduledTask }
  | { kind: 'error'; message: string };

export function isRevisionConflict(e: unknown): boolean {
  const x = e as { status?: unknown; code?: unknown } | null;
  return !!x && x.status === 409 && x.code === 'revision_conflict';
}

const same = (a: string, b: string) => a.trim() === b.trim();

/** 草稿和打开时那份比,有没有要保存的改动(Hub 会 trim,只差首尾空白不算)。 */
export function contentDirty(base: HubScheduledTask, draft: string): boolean {
  return !same(base.task_content, draft);
}

/** 保存按钮能不能点:有改动、非空、不超长、没在保存。 */
export function canSaveContent(base: HubScheduledTask, draft: string, busy: boolean): boolean {
  return !busy && contentDirty(base, draft) && !!draft.trim() && draft.trim().length <= SCHEDULE_CONTENT_MAX;
}

export async function saveScheduleContent(deps: ContentSaveDeps, base: HubScheduledTask, draft: string, retried = false): Promise<ContentSaveResult> {
  const text = draft.trim();
  try {
    const res = await deps.patch(base, text);
    return { kind: 'saved', schedule: res.schedule ?? null };
  } catch (e) {
    if (!isRevisionConflict(e)) return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
    let latest: HubScheduledTask | null | undefined;
    try { latest = await deps.refetch(base.schedule_id); }
    catch (err) { return { kind: 'error', message: err instanceof Error ? err.message : String(err) }; }
    if (!latest) return { kind: 'gone' };
    if (!same(latest.task_content, base.task_content) && !same(latest.task_content, text)) return { kind: 'conflict', latest };
    if (retried) return { kind: 'retryAgain', latest };
    return saveScheduleContent(deps, latest, draft, true);
  }
}
