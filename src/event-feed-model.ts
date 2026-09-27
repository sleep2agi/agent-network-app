// 服务器 → 事件与日志: what one row of the event stream says, and where the rows come from.
//
// Before this module the screen listed every SSE frame raw: opening it on a quiet network showed
// 「1 / 500」 and a single chip reading `connected` — the stream's own hello frame — because the
// SSE only carries what happens AFTER it opens. Two changes, both pure so they are tested without
// React (event-feed-model.test.ts):
//
//   1. History. The hub (commhub-server ≤ 0.9.0-preview.61) has no recent-events endpoint for the
//      network observer stream: `/events/network/:id` is live-only and `/api/task_events` rows carry
//      no sender/recipient. The recent rows of `GET /api/tasks` (network-scoped, the same call and
//      the same token the 任务 page already makes) hold exactly the routing metadata the stream
//      emits, so the screen preloads those. `taskRowToFeedEvent` copies ONLY routing fields — the
//      task's content/result never enter the feed state (the page promises 「不含消息内容」).
//   2. Readability. Each row reads 「发起 → 接收 · 状态 · 相对时间」 with the task_id small;
//      transport lifecycle frames (`connected`) fold into the status line instead of being rows.
import type { HubTask } from './api';
import { parseHubTime } from './time';

export type FeedKind = 'task' | 'reply' | 'broadcast' | 'node' | 'other';
export type FeedTone = 'running' | 'blocked' | 'rest' | 'failed' | 'accent';

export interface FeedEvent {
  /** Stable React key; also the dedupe key between the preload and the live stream. */
  key: string;
  kind: FeedKind;
  /** Raw hub type (`new_task`, `new_reply`, `node_deleted`, …) — kept so unknown types stay visible. */
  type: string;
  taskId: string;
  from: string;
  to: string;
  status: string;
  priority: string;
  /** Epoch ms of the event (hub created_at for history, receive time for live frames). */
  atMs: number;
  source: 'history' | 'live';
}

/** Frames about the SSE transport itself, not about the network. Never a list row. */
export const TRANSPORT_EVENT_TYPES: readonly string[] = ['connected', 'ping', 'keepalive', 'heartbeat'];

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function isTransportEvent(ev: { type?: unknown } | null | undefined): boolean {
  return TRANSPORT_EVENT_TYPES.includes(str(ev?.type).toLowerCase());
}

export function kindOf(type: string): FeedKind {
  switch (type.toLowerCase()) {
    case 'new_task': case 'task_status_transition': return 'task';
    case 'new_reply': case 'task_replied': return 'reply';
    case 'broadcast': return 'broadcast';
    case 'node_deleted': case 'node_renamed': case 'node_added': return 'node';
    default: return 'other';
  }
}

/**
 * One `/api/tasks` row → a history event. Only routing metadata is copied: `content`, `result`,
 * `meta_json` and every other field are dropped here, so they cannot leak into what renders.
 */
export function taskRowToFeedEvent(row: HubTask): FeedEvent | null {
  const taskId = str(row.task_id);
  if (!taskId) return null;
  const at = parseHubTime(row.created_at)?.getTime();
  return {
    key: `task:${taskId}`,
    kind: 'task',
    type: 'new_task',
    taskId,
    from: str(row.from_name),
    to: str(row.to_name),
    status: str(row.status),
    priority: str(row.priority),
    atMs: typeof at === 'number' && Number.isFinite(at) ? at : 0,
    source: 'history',
  };
}

/** One SSE frame → a live event; null for transport frames (see TRANSPORT_EVENT_TYPES). */
export function liveFrameToFeedEvent(frame: Record<string, unknown>, receivedAtMs: number, seq: number): FeedEvent | null {
  if (isTransportEvent(frame)) return null;
  const type = str(frame.type) || '(unknown)';
  const kind = kindOf(type);
  const taskId = str(frame.task_id);
  const from = str(frame.from) || str(frame.from_name);
  const to = str(frame.to) || str(frame.to_name) || (kind === 'node' ? str(frame.alias) : '');
  return {
    key: `live:${seq}`,
    kind,
    type,
    taskId,
    from,
    to,
    status: str(frame.status),
    priority: str(frame.priority),
    atMs: receivedAtMs,
    source: 'live',
  };
}

/**
 * Preloaded history, oldest first (the list reads top → bottom like a log and follows new rows at
 * the bottom). Rows without a task id are dropped; duplicates keep their first occurrence.
 */
export function historyFromTasks(rows: readonly HubTask[] | null | undefined): FeedEvent[] {
  const seen = new Set<string>();
  const out: FeedEvent[] = [];
  for (const row of rows ?? []) {
    const ev = taskRowToFeedEvent(row);
    if (!ev || seen.has(ev.key)) continue;
    seen.add(ev.key);
    out.push(ev);
  }
  return out.sort((a, b) => a.atMs - b.atMs || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * Merge the preload into what the live stream already delivered (the fetch may land after the
 * first frames). A live `new_task` for a task the history also holds wins — it is the newer fact.
 */
export function mergeHistory(history: readonly FeedEvent[], live: readonly FeedEvent[], max: number): FeedEvent[] {
  const liveNewTask = new Set(live.filter(e => e.type === 'new_task' && e.taskId).map(e => e.taskId));
  const merged = [...history.filter(e => !liveNewTask.has(e.taskId)), ...live];
  return merged.length > max ? merged.slice(merged.length - max) : merged;
}

const STATUS: Record<string, { label: string; tone: FeedTone }> = {
  queued: { label: '排队中', tone: 'blocked' },
  pending: { label: '排队中', tone: 'blocked' },
  delivered: { label: '已送达', tone: 'accent' },
  running: { label: '执行中', tone: 'running' },
  in_progress: { label: '执行中', tone: 'running' },
  working: { label: '执行中', tone: 'running' },
  replied: { label: '已回复', tone: 'running' },
  completed: { label: '已完成', tone: 'running' },
  done: { label: '已完成', tone: 'running' },
  blocked: { label: '受阻', tone: 'blocked' },
  failed: { label: '失败', tone: 'failed' },
  error: { label: '出错', tone: 'failed' },
  expired: { label: '已过期', tone: 'failed' },
  timeout: { label: '超时', tone: 'failed' },
  cancelled: { label: '已取消', tone: 'rest' },
  canceled: { label: '已取消', tone: 'rest' },
};

const KIND_LABEL: Record<FeedKind, string> = {
  task: '任务',
  reply: '回复',
  broadcast: '广播',
  node: '节点',
  other: '',
};

/** The status chip. An unknown hub status shows verbatim (gray) rather than being remapped. */
export function statusChip(ev: Pick<FeedEvent, 'kind' | 'type' | 'status'>): { label: string; tone: FeedTone } {
  const known = STATUS[ev.status.toLowerCase()];
  if (known) return known;
  if (ev.status) return { label: ev.status, tone: 'rest' };
  if (ev.kind === 'node') {
    const t = ev.type.toLowerCase();
    return { label: t === 'node_deleted' ? '节点已删除' : t === 'node_renamed' ? '节点已改名' : '节点已加入', tone: 'rest' };
  }
  return { label: KIND_LABEL[ev.kind] || ev.type, tone: 'rest' };
}

/** 「刚刚」「3 分钟前」「2 小时前」「4 天前」, then MM-DD HH:MM. */
export function relativeTime(atMs: number, nowMs: number): string {
  if (!Number.isFinite(atMs) || atMs <= 0) return '';
  const min = Math.floor(Math.max(0, nowMs - atMs) / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  const d = new Date(atMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Which conversation a click opens. The app's chat with alias X is the viewer's own thread with X,
 * so a row opens a chat only when the viewer is one side of it; agent ↔ agent traffic has no chat
 * here and opens the task detail instead (null when there is not even a task id).
 */
export function clickTarget(ev: Pick<FeedEvent, 'from' | 'to' | 'taskId'>, me: string | null | undefined):
  { kind: 'chat'; alias: string } | { kind: 'task'; taskId: string } | null {
  const self = str(me);
  if (self) {
    if (ev.from === self && ev.to && ev.to !== self) return { kind: 'chat', alias: ev.to };
    if (ev.to === self && ev.from && ev.from !== self) return { kind: 'chat', alias: ev.from };
  }
  return ev.taskId ? { kind: 'task', taskId: ev.taskId } : null;
}

export interface FeedRowModel {
  from: string;
  to: string;
  chip: { label: string; tone: FeedTone };
  time: string;
  /** Small secondary line: the task id (full; the row truncates it visually). */
  taskId: string;
  high: boolean;
  /** Screen-reader sentence for the whole row. */
  a11y: string;
}

export function feedRowModel(ev: FeedEvent, nowMs: number): FeedRowModel {
  const chip = statusChip(ev);
  const from = ev.from || '（未知）';
  const to = ev.to || '（未指定）';
  const time = relativeTime(ev.atMs, nowMs);
  return {
    from,
    to,
    chip,
    time,
    taskId: ev.taskId,
    high: ev.priority.toLowerCase() === 'high' || ev.priority.toLowerCase() === 'urgent',
    a11y: `${from} 发给 ${to}，${chip.label}${time ? `，${time}` : ''}`,
  };
}

/** The one-line stream status shown under the title (replaces the `connected` row). */
export function streamStatusLine(input: { conn: 'connecting' | 'connected' | 'disconnected'; historyCount: number; liveCount: number; historyError?: string | null }): string {
  const conn = input.conn === 'connected' ? '实时连接中' : input.conn === 'connecting' ? '正在连接实时流…' : '实时流已断开，正在重连…';
  const parts = [conn];
  if (input.historyError) parts.push('最近记录加载失败');
  else if (input.historyCount > 0) parts.push(`最近 ${input.historyCount} 条任务`);
  if (input.liveCount > 0) parts.push(`实时新增 ${input.liveCount} 条`);
  return parts.join(' · ');
}

export const FEED_EMPTY_TITLE = '最近没有任务流转';
