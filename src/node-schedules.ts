// 节点页「定时任务」分区的纯模型:这个节点要执行的计划(两个来源合成一张表)。
//
// 来源与定时任务页(ScheduledTasksScreen)完全相同,不新增接口:
//   - Hub 计划:GET /api/scheduled-tasks —— Hub(commhub-server 0.9.0-preview.61,server/src/scheduled-tasks.ts)
//     列表只认 network 作用域和 `status`,**没有按执行节点过滤的参数**,所以在这里按 target_node_id 过滤;
//   - 节点计划(RFC-036):/api/status 上各会话的 external_schedules 快照(fetchExternalSchedules 已按 node_id 归并)。
// 两边都按 **node_id** 认执行节点,不按 alias:alias 能改名、能被另一台节点接走,node_id 不会。
// 纯逻辑,不 import react-native(node-schedules.test.ts 直接测)。

import type { HubExternalSchedule, HubExternalScheduleEditIntent, HubNodeExternalSchedules, HubScheduledRun, HubScheduledTask, HubTask } from './api';
import { runDisplay } from './schedule-run-result';
import {
  EXTERNAL_KIND_LABEL,
  INTENT_STATUS_LABEL,
  describeSchedule,
  formatAbsolute,
  formatRelative,
  scheduleStatusMeta,
  sortSchedules,
  type StatusTone,
} from './scheduled-view-model';

export type NodeScheduleSource = 'hub' | 'node';

export const NODE_SCHEDULE_SOURCE_LABEL: Record<NodeScheduleSource, string> = { hub: 'Hub 计划', node: '节点计划' };

/** 节点页 → 定时任务页:要落在哪一条上(或直接打开新建表单)。seq 让同一条连点两次也会再生效。 */
export type ScheduleOpenRequest =
  | { kind: 'hub'; scheduleId: string; seq: number }
  | { kind: 'node'; nodeId: string; scheduleId: string; seq: number }
  | { kind: 'create'; nodeId: string; seq: number };

/** Hub 计划里执行节点是这个 node_id 的。空 node_id 一条都不认(不拿 '' 去撞 '')。 */
export function hubSchedulesForNode<T extends Pick<HubScheduledTask, 'target_node_id'>>(items: readonly T[], nodeId: string | null | undefined): T[] {
  if (!nodeId) return [];
  return items.filter(item => item.target_node_id === nodeId);
}

/** 这个 node_id 上报的节点计划快照;没上报过为 null。 */
export function externalSchedulesForNode(nodes: readonly HubNodeExternalSchedules[], nodeId: string | null | undefined): HubNodeExternalSchedules | null {
  if (!nodeId) return null;
  return nodes.find(n => n.node_id === nodeId) ?? null;
}

export interface NodeScheduleToggle {
  /** 开关当前画成开还是关。 */
  value: boolean;
  disabled: boolean;
  /** 置灰时说清为什么(置灰而不是隐藏:隐藏会让人以为没有这个功能)。 */
  hint: string | null;
}

export interface NodeScheduleRow {
  /** 列表内唯一:`hub:<schedule_id>` / `node:<schedule id>`(节点计划 id 只在本节点内唯一)。 */
  key: string;
  source: NodeScheduleSource;
  sourceLabel: string;
  scheduleId: string;
  name: string;
  /** 频率的人话:Hub 计划走 describeSchedule;节点计划是「crontab · <节点上报的频率>」。 */
  frequency: string;
  /** 下次执行;暂停/停用/已结束时说状态,不画「—」。 */
  next: string;
  /** 上次执行结果(已完成/失败/执行中/已送达/已跳过…);还没执行过为 null。 */
  last: { label: string; tone: StatusTone } | null;
  toggle: NodeScheduleToggle;
}

/** 最近一次执行(runs?limit=1 的那一行 + 需要时读到的任务)→ 与执行记录同一套映射(#442 runDisplay)。 */
export function hubLastResult(run: Pick<HubScheduledRun, 'status'> | null | undefined, task?: Pick<HubTask, 'status'> | null): { label: string; tone: StatusTone } | null {
  if (!run) return null;
  const d = runDisplay(run, task);
  return { label: d.label, tone: d.tone };
}

const EXTERNAL_RESULT: Record<HubExternalSchedule['last_status'], { label: string; tone: StatusTone } | null> = {
  success: { label: '已完成', tone: 'running' },
  failed: { label: '失败', tone: 'failed' },
  running: { label: '执行中', tone: 'blocked' },
  unknown: null,
};

/** 节点计划的上次结果。unknown 但确实跑过 → 「未知」(中性色);从没跑过 → null。 */
export function externalLastResult(sch: Pick<HubExternalSchedule, 'last_status' | 'last_run_at'>): { label: string; tone: StatusTone } | null {
  const mapped = EXTERNAL_RESULT[sch.last_status];
  if (mapped) return mapped;
  return sch.last_run_at ? { label: '未知', tone: 'rest' } : null;
}

/** Hub 计划的开关:与定时任务页同一个 PATCH(status active ↔ paused);已结束的计划置灰。 */
export function hubToggle(row: Pick<HubScheduledTask, 'status'>): NodeScheduleToggle {
  if (row.status === 'active') return { value: true, disabled: false, hint: null };
  if (row.status === 'paused') return { value: false, disabled: false, hint: null };
  return { value: false, disabled: true, hint: `${scheduleStatusMeta(row.status).label},不会再执行` };
}

export const NODE_PLAN_READ_ONLY_HINT = '只读:只有 agent-node 托管的 cron 条目能在 app 里启停';
export const NODE_PLAN_OWNER_HINT = '只有节点 owner 能启停这条计划';

/**
 * 节点计划的开关。能改的只有托管 cron(editable + revision,RFC-036);改法是提交「编辑意向」,
 * 由节点自己落地 —— 所以意向在途时开关画成**意向要的值**并置灰,等节点回执。
 * ownerDenied:读意向记录拿到 403(不是节点 owner),提交也必然被拒,提前置灰说明。
 */
export function nodePlanToggle(
  sch: Pick<HubExternalSchedule, 'id' | 'kind' | 'enabled' | 'editable' | 'revision'>,
  nodeId: string,
  openIntents: Readonly<Record<string, Pick<HubExternalScheduleEditIntent, 'status' | 'patch'>>>,
  ownerDenied = false,
): NodeScheduleToggle {
  const editable = sch.editable === true && sch.kind === 'cron' && typeof sch.revision === 'number';
  if (!editable) return { value: sch.enabled, disabled: true, hint: NODE_PLAN_READ_ONLY_HINT };
  if (ownerDenied) return { value: sch.enabled, disabled: true, hint: NODE_PLAN_OWNER_HINT };
  const open = openIntents[`${nodeId}:${sch.id}`];
  if (open) {
    const want = open.patch.enabled ?? sch.enabled;
    return { value: want, disabled: true, hint: `意向在途(${INTENT_STATUS_LABEL[open.status] ?? open.status}):等节点应用${open.patch.enabled === undefined ? '' : `「${want ? '启用' : '停用'}」`}` };
  }
  return { value: sch.enabled, disabled: false, hint: null };
}

function hubNext(row: Pick<HubScheduledTask, 'status' | 'next_run_at'>, nowMs: number): string {
  if (row.status === 'paused') return '已暂停';
  if (row.status !== 'active') return scheduleStatusMeta(row.status).label;
  const rel = formatRelative(row.next_run_at, nowMs);
  if (!rel) return '暂无下次';
  const abs = formatAbsolute(row.next_run_at, nowMs);
  return rel === abs ? `下次 ${abs}` : `下次 ${rel} · ${abs}`;
}

function externalNext(sch: Pick<HubExternalSchedule, 'enabled' | 'next_run_at'>, nowMs: number): string {
  if (!sch.enabled) return '已停用';
  const abs = formatAbsolute(sch.next_run_at, nowMs);
  if (!abs) return '暂无下次';
  const rel = formatRelative(sch.next_run_at, nowMs);
  return rel === abs ? `下次 ${abs}` : `下次 ${rel} · ${abs}`;
}

export interface NodeScheduleInput {
  nodeId: string | null | undefined;
  hub: readonly HubScheduledTask[];
  external: readonly HubNodeExternalSchedules[];
  /** 每条 Hub 计划最近一次执行(键 schedule_id);没取到/没执行过就不在表里。 */
  lastRuns?: Readonly<Record<string, { run: HubScheduledRun | null; task?: HubTask | null }>>;
  openIntents?: Readonly<Record<string, HubExternalScheduleEditIntent>>;
  ownerDenied?: boolean;
  nowMs: number;
  deviceTimezone?: string;
}

/**
 * 两个来源合成节点页的行:Hub 计划在前(与定时任务页同一排序:下次最早的在前,已结束的在后),
 * 节点计划在后(按名称)。只收执行节点 = nodeId 的。
 */
export function nodeScheduleRows(input: NodeScheduleInput): NodeScheduleRow[] {
  const { nodeId, nowMs } = input;
  if (!nodeId) return [];
  const hubRows = sortSchedules(hubSchedulesForNode(input.hub, nodeId)).map((row): NodeScheduleRow => {
    const last = input.lastRuns?.[row.schedule_id];
    return {
      key: `hub:${row.schedule_id}`,
      source: 'hub',
      sourceLabel: NODE_SCHEDULE_SOURCE_LABEL.hub,
      scheduleId: row.schedule_id,
      name: row.name,
      frequency: describeSchedule(row.schedule, row.timezone, input.deviceTimezone, nowMs),
      next: hubNext(row, nowMs),
      last: hubLastResult(last?.run, last?.task),
      toggle: hubToggle(row),
    };
  });
  const ext = externalSchedulesForNode(input.external, nodeId);
  const nodeRows = [...(ext?.schedules ?? [])]
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN') || a.id.localeCompare(b.id))
    .map((sch): NodeScheduleRow => ({
      key: `node:${sch.id}`,
      source: 'node',
      sourceLabel: NODE_SCHEDULE_SOURCE_LABEL.node,
      scheduleId: sch.id,
      name: sch.name,
      frequency: `${EXTERNAL_KIND_LABEL[sch.kind] ?? sch.kind} · ${sch.frequency}`,
      next: externalNext(sch, nowMs),
      last: externalLastResult(sch),
      toggle: nodePlanToggle(sch, nodeId, input.openIntents ?? {}, input.ownerDenied),
    }));
  return [...hubRows, ...nodeRows];
}

export const NODE_SCHEDULES_EMPTY = '这个节点还没有定时任务';

/**
 * 最近一次执行要不要重读:计划被执行过(last_run_at / revision 变了)或上次读到的还没结束
 * (「已送达 → 执行中 → 已完成」要能在节点页上走完)。与定时任务页 runsKey 同一口径。
 */
export const lastRunKey = (row: Pick<HubScheduledTask, 'schedule_id' | 'last_run_at' | 'revision'>) =>
  `${row.schedule_id}:${row.last_run_at ?? ''}:${row.revision}`;
