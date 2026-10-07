// 定时任务编辑器(ScheduleEditor.tsx)的纯逻辑:节点页点一行打开什么、表单脏不脏、关闭要不要确认、
// 保存(含 409 合并重试)怎么走。定时任务页和节点页共用同一个编辑器,这里是两边共用的那一份判定。
// 纯逻辑,不 import react-native(schedule-editor-model.test.ts 直接测)。
import type { HubMisfirePolicy, HubScheduledTask, HubScheduleSpec } from './api';
import type { NodeScheduleRow, ScheduleOpenRequest } from './node-schedules';
import { planConflict, type ScheduleEditFields, type ScheduleEditKey } from './schedule-edit-merge';

/**
 * 编辑器开着的是什么。edit / copy 带的是**打开那一刻**的那一行:节点页每 10 秒轮询会换掉列表里的对象,
 * 编辑器要是跟着列表走,表单会被轮询回填、用户正在改的内容被冲掉。
 */
export type ScheduleEditorState =
  | { kind: 'edit'; row: HubScheduledTask }
  | { kind: 'create'; nodeId: string }
  | { kind: 'copy'; row: HubScheduledTask };

/** 编辑器 props:编辑哪一条 / 从哪一条复制 / 新建时预选哪个执行节点。 */
export function editorPropsOf(state: ScheduleEditorState | null): { editing: HubScheduledTask | null; copyFrom: HubScheduledTask | null; initialTarget?: string } {
  if (!state) return { editing: null, copyFrom: null };
  if (state.kind === 'edit') return { editing: state.row, copyFrom: null };
  if (state.kind === 'copy') return { editing: null, copyFrom: state.row };
  return { editing: null, copyFrom: null, initialTarget: state.nodeId };
}

/** 节点页的「＋ 新建」:执行节点预填为这个节点。 */
export const createEditorFor = (nodeId: string): ScheduleEditorState => ({ kind: 'create', nodeId });

export type NodeRowClick =
  /** Hub 计划:就地打开编辑器(不切页面)。 */
  | { kind: 'editor'; state: ScheduleEditorState }
  /** 节点计划(节点上报的 crontab 等)没有这个编辑器能改的字段:仍去定时任务页的「节点计划」落在那一条。 */
  | { kind: 'navigate'; request: ScheduleOpenRequest }
  | { kind: 'none' };

export function nodeRowClick(
  row: Pick<NodeScheduleRow, 'source' | 'scheduleId'>,
  hub: readonly HubScheduledTask[],
  nodeId: string,
  seq: number,
): NodeRowClick {
  if (row.source === 'hub') {
    const hit = hub.find(item => item.schedule_id === row.scheduleId);
    return hit ? { kind: 'editor', state: { kind: 'edit', row: hit } } : { kind: 'none' };
  }
  return { kind: 'navigate', request: { kind: 'node', nodeId, scheduleId: row.scheduleId, seq } };
}

// ── 表单脏不脏 ────────────────────────────────────────────────────────────────

export type IntervalUnit = 'seconds' | 'minutes' | 'hours' | 'days';

/** 表单里的原始输入(还没换算成 Hub 的 schedule)。 */
export interface ScheduleFormState {
  name: string;
  task: string;
  target: string;
  kind: HubScheduleSpec['type'];
  when: string;
  every: string;
  unit: IntervalUnit;
  clock: string;
  weekdays: number[];
  misfirePolicy: HubMisfirePolicy;
  priority: 'high' | 'normal' | 'low';
  timezone: string;
}

/**
 * 只比当前类型用得到的那几项(从「间隔」切到「每天」再切回来、间隔值没变,不算改了),
 * 文本两端空白不算(保存时本来就 trim)。
 */
export function formSnapshot(f: ScheduleFormState): string {
  const cadence = f.kind === 'once' ? { when: f.when }
    : f.kind === 'interval' ? { every: f.every.trim(), unit: f.unit }
    : f.kind === 'daily' ? { clock: f.clock.trim() }
    : { clock: f.clock.trim(), weekdays: [...f.weekdays].sort((a, b) => a - b) };
  return JSON.stringify({
    name: f.name.trim(), task: f.task.trim(), target: f.target, kind: f.kind, cadence,
    misfirePolicy: f.misfirePolicy, priority: f.priority, timezone: f.timezone.trim(),
  });
}

/** pristine = 打开(回填完)那一刻的快照;还没回填完(null)一律当没改。 */
export const isFormDirty = (pristine: string | null, current: string): boolean => pristine !== null && pristine !== current;

/** 关编辑器(✕ / 取消 / Esc / 点遮罩 / 安卓返回):有没保存的修改先问,保存中不弹(保存完自己会关)。 */
export function closeIntent(dirty: boolean, saving = false): 'close' | 'confirm' {
  return dirty && !saving ? 'confirm' : 'close';
}

// ── 保存(409 revision_conflict 的三方合并)────────────────────────────────────

export interface ScheduleSaveApi {
  update: (row: HubScheduledTask, input: ScheduleEditFields) => Promise<unknown>;
  /** 冲突后重新读这条(不在了 = undefined)。 */
  refetch: (scheduleId: string) => Promise<HubScheduledTask | undefined>;
  is409Conflict: (e: unknown) => boolean;
}

export type ScheduleSaveOutcome =
  | { kind: 'saved' }
  /** 同一字段两边改得不一样:停在冲突视图让用户选,草稿不丢。 */
  | { kind: 'conflict'; latest: HubScheduledTask; keys: ScheduleEditKey[] }
  | { kind: 'gone' }
  | { kind: 'refetchFailed'; message: string }
  /** 合并重试又撞了一次:表单换成合并后的那份,让用户再点保存。 */
  | { kind: 'retryAgain'; base: HubScheduledTask; input: ScheduleEditFields };

/** 保存一次;409 且没有同字段冲突 → 合并后自动重试一次。其它错误照常抛。 */
export async function saveScheduleEdit(api: ScheduleSaveApi, row: HubScheduledTask, input: ScheduleEditFields, retried = false): Promise<ScheduleSaveOutcome> {
  try {
    await api.update(row, input);
    return { kind: 'saved' };
  } catch (e) {
    if (!api.is409Conflict(e)) throw e;
    let latest: HubScheduledTask | undefined;
    try { latest = await api.refetch(row.schedule_id); }
    catch (err) { return { kind: 'refetchFailed', message: err instanceof Error ? err.message : String(err) }; }
    const plan = planConflict(row, latest, input);
    if (plan.kind === 'gone') return { kind: 'gone' };
    if (plan.kind === 'conflict') return { kind: 'conflict', latest: plan.base, keys: plan.keys };
    if (retried) return { kind: 'retryAgain', base: plan.base, input: plan.input };
    return saveScheduleEdit(api, plan.base, plan.input, true);
  }
}

/** 编辑器保存成功 / 取消了计划之后,宿主页面(节点页列表 / 定时任务页)的收尾:先关编辑器,再就地刷新列表。 */
export async function afterEditorSaved(close: () => void, reload: () => Promise<void>): Promise<void> {
  close();
  await reload();
}

/** 编辑器里的「最近执行」只取几条(完整记录在定时任务页)。 */
export const EDITOR_RECENT_RUNS = 5;
