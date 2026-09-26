// 0.2.109 任务状态通知(手机端):人发给 agent 的任务到了终态(replied/completed = 完成,
// failed/expired/timeout = 失败)时提醒一次。纯逻辑,不 import react-native / expo。
//
// 数据源:与「任务」页同一个接口 GET /api/tasks(api.fetchTasks),按 from_name = 登录用户名过滤。
//
// 🔴 与消息通知去重(二选一的取舍):agent 用 commhub_reply 回任务时,hub 同时
//    (a) 把任务改成 replied,(b) 往 inbox 写一行 type=reply 给用户 —— 消息通知已经会响那一下。
//    所以终态**不另发第二条**,而是给同一个 agent 的那条消息通知加标签:
//      · 任务先到(消息后到)→ 记一个待用标签,消息通知发出时把标题换成「✅ X 完成了任务:…」;
//      · 消息先到(刚发过这个 agent 的消息通知)→ 原地更新那条通知的标题(同 identifier、静默渠道,不再响);
//      · 过了 PAIR_GRACE_MS 都没等到消息(超时/过期/失败常常没有回复行)→ 单独发一条任务通知(点它进任务详情)。
//    这样一次终态最多响一次。

import type { HubTask } from './api';
import { FRESH_WINDOW_MS, hubTsToMs } from './notify-policy';

import { TASK_STATUS_NOTIFICATION_KIND } from './mobile-notify-model';
export const TASK_NOTIFICATION_KIND = TASK_STATUS_NOTIFICATION_KIND;
/** 消息与任务终态互相等待的窗口。两边同一轮轮询拉到是常态;留两拍后台轮询(2×20 s)的余量。 */
export const PAIR_GRACE_MS = 45_000;
export const TASK_TITLE_MAX = 40;

const DONE = new Set(['replied', 'completed', 'done']);
const FAILED = new Set(['failed', 'expired', 'timeout', 'timed_out', 'error']);

export type TaskOutcome = 'done' | 'failed';

export function taskOutcome(status: unknown): TaskOutcome | null {
  if (typeof status !== 'string') return null;
  if (DONE.has(status)) return 'done';
  if (FAILED.has(status)) return 'failed';
  return null;
}

/** 任务标题 = 正文第一行(去空白),最多 TASK_TITLE_MAX 字。 */
export function taskTitle(content: unknown, max = TASK_TITLE_MAX): string {
  const first = typeof content === 'string' ? (content.split('\n').find(l => l.trim()) ?? '').trim().replace(/\s+/g, ' ') : '';
  const chars = Array.from(first);
  return chars.length > max ? chars.slice(0, max).join('') + '…' : first;
}

export type TaskFinish = { taskId: string; agent: string; outcome: TaskOutcome; title: string };

export type TaskSeen = { seeded: boolean; status: ReadonlyMap<string, string> };
export const initialTaskSeen = (): TaskSeen => ({ seeded: false, status: new Map() });
const TASK_SEEN_CAP = 500;

/**
 * 从一次任务列表里挑出「刚到终态」的任务。首份列表只登记;之后:
 *  · 见过、上次非终态、这次终态 → 提醒;
 *  · 没见过、这次就已终态(两拍之间开始又结束 / 别的设备发的)→ 终态时间在 FRESH_WINDOW_MS 内才提醒;
 *  · 见过且上次已是终态 → 不再提醒。
 */
export function pickTaskFinishes(seen: TaskSeen, tasks: readonly HubTask[] | null | undefined, username: string, nowMs: number): { seen: TaskSeen; finished: TaskFinish[] } {
  const status = new Map(seen.status);
  const finished: TaskFinish[] = [];
  for (const task of tasks ?? []) {
    const id = typeof task?.task_id === 'string' ? task.task_id : '';
    const agent = typeof task?.to_name === 'string' ? task.to_name.trim() : '';
    const st = typeof task?.status === 'string' ? task.status : '';
    if (!id || !agent || !st) continue;
    if (username && task.from_name && task.from_name !== username) continue;
    const prev = status.get(id);
    status.delete(id);
    status.set(id, st);
    if (!seen.seeded) continue;
    const outcome = taskOutcome(st);
    if (!outcome) continue;
    if (prev !== undefined) {
      if (taskOutcome(prev)) continue;
    } else {
      const ms = hubTsToMs(normalize(task.completed_at) ?? normalize(task.updated_at) ?? normalize(task.created_at));
      if (ms === null || nowMs - ms > FRESH_WINDOW_MS) continue;
    }
    finished.push({ taskId: id, agent, outcome, title: taskTitle(task.content) });
  }
  while (status.size > TASK_SEEN_CAP) status.delete(status.keys().next().value as string);
  return { seen: { seeded: true, status }, finished };
}

function normalize(v: unknown): string | null {
  return typeof v === 'string' && v ? v.replace('T', ' ').slice(0, 19) : null;
}

export function taskLabel(f: Pick<TaskFinish, 'agent' | 'outcome' | 'title'>): string {
  const t = f.title ? `:${f.title}` : '';
  return f.outcome === 'done' ? `✅ ${f.agent} 完成了任务${t}` : `❌ ${f.agent} 任务失败${t}`;
}

export function taskNotificationIdentifier(profileKey: string, taskId: string): string {
  return `anet-task:${profileKey}:${taskId}`;
}

// ── 消息 ⇄ 任务终态的配对 ──
export type PendingMark = TaskFinish & { at: number };
export type PairState = {
  /** 任务终态已到、还没配上消息的标签(按 agent,一个 agent 只留最新一个)。 */
  readonly marks: Readonly<Record<string, PendingMark>>;
  /** 最近一次给某 agent 发消息通知的时刻 + 当时的通知内容(用于原地加标签)。 */
  readonly lastMessage: Readonly<Record<string, { at: number; identifier: string; body: string; channelId: string }>>;
};
export const initialPairState = (): PairState => ({ marks: {}, lastMessage: {} });

/** 任务终态到了:消息刚发过 → 原地加标签('relabel');否则记下等消息('pending')。 */
export function onTaskFinished(s: PairState, f: TaskFinish, nowMs: number): { state: PairState; action: 'relabel' | 'pending' } {
  const last = s.lastMessage[f.agent];
  if (last && nowMs - last.at <= PAIR_GRACE_MS) {
    const lastMessage = { ...s.lastMessage };
    delete lastMessage[f.agent];
    return { state: { ...s, lastMessage }, action: 'relabel' };
  }
  return { state: { ...s, marks: { ...s.marks, [f.agent]: { ...f, at: nowMs } } }, action: 'pending' };
}

/** 要给某 agent 发消息通知了:有待用标签就取走(返回它),并记下这次消息通知。 */
export function onMessagePosted(s: PairState, agent: string, post: { identifier: string; body: string; channelId: string }, nowMs: number): { state: PairState; mark: PendingMark | null } {
  const mark = s.marks[agent] && nowMs - s.marks[agent].at <= PAIR_GRACE_MS ? s.marks[agent] : null;
  const marks = { ...s.marks };
  if (mark) delete marks[agent];
  return { state: { marks, lastMessage: { ...s.lastMessage, [agent]: { ...post, at: nowMs } } }, mark };
}

/** 等不到消息的标签:过期的取出来单独发任务通知。 */
export function takeExpiredMarks(s: PairState, nowMs: number): { state: PairState; expired: PendingMark[] } {
  const marks: Record<string, PendingMark> = {};
  const expired: PendingMark[] = [];
  for (const [agent, m] of Object.entries(s.marks)) {
    if (nowMs - m.at > PAIR_GRACE_MS) expired.push(m); else marks[agent] = m;
  }
  const lastMessage: Record<string, { at: number; identifier: string; body: string; channelId: string }> = {};
  for (const [agent, m] of Object.entries(s.lastMessage)) if (nowMs - m.at <= PAIR_GRACE_MS) lastMessage[agent] = m;
  return { state: { marks, lastMessage }, expired };
}
