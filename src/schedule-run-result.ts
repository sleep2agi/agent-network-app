// 定时任务「执行记录」每一行的真实状态、用时和回复内容(纯函数,schedule-run-result.test.ts 直接测)。
//
// 旧页面只画 scheduled_task_runs.status,一次执行从派发到节点回复都停在「已送达」,也看不到节点
// 回了什么。Hub(agent-network server/src, origin/main)那边的事实:
//   - scheduled-tasks.ts dispatchScheduledOccurrence 建 tasks 行(from_name='scheduler'),
//     run.status = delivered | queued;没派出去的直接 skipped / failed(error_code 说明原因)。
//   - db.ts syncScheduledRunForTask 把任务终态镜像回 run:replied → error_code NULL;
//     failed / cancelled / expired → error_code = `task_<status>`,completed_at 取任务的。
//   - 「执行中」只在 tasks 行上:任务 status 为 acked / running(OPEN_TASK_STATUSES)。run 行
//     在终态之前一直是 delivered,所以要看执行中必须读 task(GET /api/tasks?task_id=…,
//     和执行记录同一个 network 作用域)。
//   - 节点的回复在 tasks.result;回复附件在 meta_json.reply_attachments(hub ≥ .50)或正文里的
//     /api/files/<id> 链接 —— 和聊天里回复气泡的来源完全一样。

import type { HubScheduledRun, HubTask } from './api';
import { mimeFromName } from './attach-download';
import { parseAttachmentRefs, parseMetaReplyAttachmentRefs } from './attachment-display';
import type { StatusTone } from './scheduled-view-model';
import { parseHubTime } from './time';

export type RunKind = 'delivered' | 'queued' | 'running' | 'done' | 'failed' | 'skipped' | 'pending' | 'unknown';

export interface RunDisplay {
  kind: RunKind;
  label: string;
  tone: StatusTone;
}

const RUN_TERMINAL = new Set(['replied', 'failed', 'cancelled', 'expired', 'skipped']);
const TASK_RUNNING = new Set(['acked', 'running']);

/** run 还没到终态、又绑了任务 —— 只有这种才值得去读 task 看是不是「执行中」。 */
export const runIsOpen = (run: Pick<HubScheduledRun, 'status' | 'task_id'>): boolean =>
  !!run.task_id && !RUN_TERMINAL.has(run.status);

/**
 * 执行记录状态。run 行是权威终态(Hub 已镜像);task 只用来把「已送达」细分出「执行中」,
 * 以及 run 行还没镜像到时(旧 Hub 或正在写)用任务终态补上。不认识的值原样、中性色 —— 不往「正常」兜。
 */
export function runDisplay(run: Pick<HubScheduledRun, 'status'>, task?: Pick<HubTask, 'status'> | null): RunDisplay {
  const status = run.status === 'delivered' || run.status === 'queued' ? (task?.status && RUN_TERMINAL.has(task.status) ? task.status : run.status) : run.status;
  switch (status) {
    case 'replied': return { kind: 'done', label: '已完成', tone: 'running' };
    case 'failed':
    case 'cancelled':
    case 'expired': return { kind: 'failed', label: '失败', tone: 'failed' };
    case 'skipped': return { kind: 'skipped', label: '已跳过', tone: 'rest' };
    case 'claiming': return { kind: 'pending', label: '处理中', tone: 'blocked' };
    case 'queued': return { kind: 'queued', label: '排队中 · 节点离线', tone: 'blocked' };
    case 'delivered':
      return task?.status && TASK_RUNNING.has(task.status)
        ? { kind: 'running', label: '执行中', tone: 'blocked' }
        : { kind: 'delivered', label: '已送达', tone: 'blocked' };
    default: return { kind: 'unknown', label: status || '未知', tone: 'rest' };
  }
}

const RUN_FAILURE_TEXT: Record<string, string> = {
  previous_run_active: '上一次还没结束,这次跳过',
  target_node_not_found: '节点已不存在',
  target_not_active: '节点不可用',
  task_failed: '节点执行出错',
  task_cancelled: '任务被取消',
  task_expired: '任务过期,节点 24 小时内没有回复',
};

/** 失败/跳过的原因:中文说明 + 原始代码(代码留着,方便对照 Hub 日志)。没有原因返回 ''。 */
export function runFailureText(run: Pick<HubScheduledRun, 'error_code' | 'error_message'>, task?: Pick<HubTask, 'status'> | null): string {
  const code = run.error_code || (task?.status && task.status !== 'replied' && RUN_TERMINAL.has(task.status) ? `task_${task.status}` : '');
  const known = code ? RUN_FAILURE_TEXT[code] : undefined;
  const parts = [known ? `${known}(${code})` : code, run.error_message ?? ''].filter(Boolean);
  return parts.join(' · ');
}

/**
 * 用时 = completed_at − 派发时刻。派发时刻取 created_at(run 行真正被写入的时刻),没有才用
 * scheduled_for:错过执行后补跑的那次,scheduled_for 可能比派发早好几个小时,拿它算会把
 * 「等 Hub 补跑」的时间也算进节点用时。没有完成时刻(还在跑)或时间倒挂 → null。
 */
export function runDurationMs(run: Pick<HubScheduledRun, 'created_at' | 'scheduled_for' | 'completed_at'>, task?: Pick<HubTask, 'completed_at'> | null): number | null {
  const end = parseHubTime(run.completed_at ?? task?.completed_at ?? undefined);
  const start = parseHubTime(run.created_at || run.scheduled_for || undefined);
  if (!end || !start) return null;
  const ms = end.getTime() - start.getTime();
  return ms >= 0 ? ms : null;
}

export function formatRunDuration(ms: number | null): string {
  if (ms === null) return '';
  const s = Math.floor(ms / 1000);
  if (s < 1) return '不到 1 秒';
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} 分 ${s % 60} 秒` : `${m} 分钟`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} 小时 ${m % 60} 分` : `${h} 小时`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} 天 ${h % 24} 小时` : `${d} 天`;
}

/** 行上的用时文案:只有真派出去了(有 task)的执行才谈得上「用时」,跳过/派发失败不画。 */
export function runDurationText(run: Pick<HubScheduledRun, 'task_id' | 'created_at' | 'scheduled_for' | 'completed_at'>, task?: Pick<HubTask, 'completed_at'> | null): string {
  if (!run.task_id) return '';
  const text = formatRunDuration(runDurationMs(run, task));
  return text ? `用时 ${text}` : '';
}

export interface RunAttachment {
  key: string;
  name: string;
  isImage: boolean;
  isVideo: boolean;
  uri: string;
  needsAuth: true;
  mime?: string;
  size?: number;
}

/** 节点回复里的附件 —— 与聊天 replyAttachmentViews 同源:meta_json.reply_attachments + 正文 /api/files 链接。 */
export function runReplyAttachments(task: Pick<HubTask, 'result' | 'meta_json'> | null | undefined, serverUrl: string): RunAttachment[] {
  if (!task) return [];
  const out: RunAttachment[] = [];
  const seen = new Set<string>();
  const push = (fileId: string, name: string, mime?: string, size?: number) => {
    if (seen.has(fileId)) return;
    seen.add(fileId);
    const resolved = mime ?? mimeFromName(name);
    out.push({
      key: fileId,
      name,
      isImage: (resolved ?? '').startsWith('image/') || /\.(png|jpe?g|gif|webp|heic)$/i.test(name),
      isVideo: (resolved ?? '').startsWith('video/'),
      uri: `${serverUrl}/api/files/${fileId}`,
      needsAuth: true,
      mime: resolved,
      size,
    });
  };
  for (const a of parseMetaReplyAttachmentRefs(task.meta_json)) push(a.fileId, a.name, a.mime, a.size);
  for (const a of parseAttachmentRefs(task.result ?? '')) push(a.fileId, a.name, a.mime);
  return out;
}
