// 节点页「任务」区的分组(2026-09-24 节点页重做)。
// 在 node-tasks.ts 的「运行中 / 等待队列」之上再分出两组:
//   - selfOpen:节点**自己发给自己**、还没结束的任务(from_name === to_name)。
//     有的节点把 send_task→自己 当定时器用(「自投提醒」),收到只 ack 从不回件,
//     它们会永远停在 acked;算进「运行中」会把真正在跑的活淹掉,运行中数字也失真。
//     这一组单独列出、默认折叠,不计入运行中。
//   - recent:最近结束的任务(终态),按结束时间倒序,只取前 N 条,给人看「刚干完什么」。
// 纯函数,不 import react-native。
import type { HubTask } from './api';
import { partitionNodeTasks, summarizeTask, RUNNING_STATUSES, QUEUED_STATUSES, type NodeTaskPartition, type NodeTaskRow } from './node-tasks';

/** hub tasks.status 里表示「已经结束」的值。 */
export const TERMINAL_STATUSES = new Set(['replied', 'completed', 'done', 'failed', 'cancelled', 'canceled', 'expired', 'timeout']);

export interface NodeTaskGroups extends NodeTaskPartition {
  /** 自己发给自己、未结束(运行中或排队)的任务;不计入 running/queue。 */
  selfOpen: NodeTaskRow[];
  /** 最近结束的任务,结束时间倒序。 */
  recent: NodeTaskRow[];
}

const endKey = (t: HubTask): string => (t.completed_at ?? t.updated_at ?? t.created_at ?? '').replace('T', ' ').slice(0, 19);

/** 「自己发给自己」:发件人与收件人都是这个节点。大小写与首尾空白不敏感。 */
export function isSelfTask(t: HubTask, alias: string): boolean {
  const norm = (v?: string) => (v ?? '').trim();
  const a = norm(alias);
  return !!a && norm(t.from_name) === a && norm(t.to_name ?? a) === a;
}

export function groupNodeTasks(tasks: readonly HubTask[] | undefined | null, alias: string, recentLimit = 8): NodeTaskGroups {
  const list = tasks ?? [];
  const open: HubTask[] = [];
  const selfOpenTasks: HubTask[] = [];
  const done: HubTask[] = [];
  for (const t of list) {
    if (!t?.task_id) continue;
    const status = (t.status ?? '').toLowerCase();
    const isOpen = RUNNING_STATUSES.has(status) || QUEUED_STATUSES.has(status);
    if (isOpen && isSelfTask(t, alias)) selfOpenTasks.push(t);
    else if (isOpen) open.push(t);
    else if (TERMINAL_STATUSES.has(status)) done.push(t);
  }
  const { running, queue } = partitionNodeTasks(open);
  // 自投提醒按时间倒序(最新的在上),和 running 的「最早开始在前」相反:人看它只关心最近几条。
  const selfOpen = selfOpenTasks
    .slice()
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    .map(t => ({ taskId: t.task_id!, status: t.status ?? '', from: t.from_name ?? 'hub', summary: summarizeTask(t.content), content: t.content ?? '', createdAt: t.created_at, since: t.created_at, priority: t.priority }));
  const recent = done
    .slice()
    .sort((a, b) => endKey(b).localeCompare(endKey(a)))
    .slice(0, Math.max(0, recentLimit))
    .map(t => ({ taskId: t.task_id!, status: t.status ?? '', from: t.from_name ?? 'hub', summary: summarizeTask(t.content), content: t.content ?? '', createdAt: t.created_at, since: t.completed_at ?? t.updated_at ?? t.created_at, priority: t.priority }));
  return { running, queue, selfOpen, recent };
}
