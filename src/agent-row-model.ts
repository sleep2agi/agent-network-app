// One agent row in the phone / Android two-pane list (WeChat-style conversation list).
// Pure: no React / react-native, so agent-row-model.test.ts imports it directly.
//
// 0.2.106 — Vincent on 0.2.104 (unfolded foldable): the list rows were ~70 dp cards with
// an 8 dp gap and a green 「在线」 word on every row. Rows are now flat, 68 dp, and every
// piece of text on them has to carry information:
//   - online / offline is the dot on the avatar — the 「在线」 word said the same thing again;
//   - a word label appears only for a state the dot cannot tell apart (工作中 / 异常 / 阻塞);
//   - the right column is the last message time + the unread badge.

import type { HubMessage, HubUserMessage, Session } from './api';
import { hubTimeMs } from './agent-unread-counts';

/** Row height (dp): 12 + 44 avatar + 12. WeChat's list row is 64–72. */
export const AGENT_ROW_HEIGHT = 68;
export const AGENT_ROW_AVATAR = 44;
/** Online dot on the avatar's bottom-right corner (incl. its 2 dp ring). */
export const AGENT_ROW_DOT = 12;
export const AGENT_ROW_PAD_X = 16;
export const AGENT_ROW_GAP = 12;
/** Hairline separators start under the text, not under the avatar (WeChat). */
export const AGENT_ROW_SEPARATOR_INSET = AGENT_ROW_PAD_X + AGENT_ROW_AVATAR + AGENT_ROW_GAP;

/** Theme colour key for the avatar dot (theme.ts `colors[...]`). */
export type DotTone = 'running' | 'failed' | 'blocked' | 'rest';

export interface RowStatus {
  /** false ⇒ the dot is grey and the avatar is dimmed. */
  online: boolean;
  dot: DotTone;
  /** A word only when the dot alone does not tell the state apart. */
  label: string | null;
  labelTone: DotTone | null;
}

export function rowStatus(status?: string | null): RowStatus {
  switch (status) {
    case 'working':
    case 'running':
      return { online: true, dot: 'running', label: '工作中', labelTone: 'running' };
    case 'error':
    case 'failed':
      return { online: true, dot: 'failed', label: '异常', labelTone: 'failed' };
    case 'blocked':
      return { online: true, dot: 'blocked', label: '阻塞', labelTone: 'blocked' };
    case 'offline':
    case '':
    case undefined:
    case null:
      return { online: false, dot: 'rest', label: null, labelTone: null };
    default:
      // idle and any other live state: the green dot says "online"; no word.
      return { online: true, dot: 'running', label: null, labelTone: null };
  }
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * Short time for the right column, device-local, WeChat's scheme:
 * < 1 min → 刚刚 · today → HH:MM · yesterday → 昨天 · within the week → 周X ·
 * this year → M/D · older → YYYY/M/D. 0 / invalid → '' (the column stays empty).
 * A time slightly in the future (clock skew between hub and phone) reads as 刚刚.
 */
export function formatRowTime(ms: number, nowMs: number = Date.now()): string {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  if (nowMs - ms < 60_000) return '刚刚';
  const d = new Date(ms);
  const now = new Date(nowMs);
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days <= 0) return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (days === 1) return '昨天';
  if (days < 7) return WEEKDAYS[d.getDay()];
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export interface LatestMessage { at: number; text: string }

/** Collapse whitespace so a multi-line / markdown message fits one preview line. */
export const previewText = (raw: unknown, max = 80): string => {
  if (typeof raw !== 'string') return '';
  const one = raw.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max) : one;
};

/**
 * Latest message each agent sent the signed-in user — same two sources, same filter as
 * agent-unread-counts.ts `latestMessageAtByAgent` (which the 新消息 group sorts by), plus
 * the text for the preview line.
 */
export function latestMessageByAgent(snap: {
  serverBody: unknown;
  replyRows?: readonly unknown[];
  replyUsername?: string;
}): Record<string, LatestMessage> {
  const out: Record<string, LatestMessage> = {};
  const bump = (alias: unknown, at: unknown, text: unknown) => {
    if (typeof alias !== 'string' || !alias) return;
    const ms = hubTimeMs(at);
    if (!ms || ms <= (out[alias]?.at ?? 0)) return;
    out[alias] = { at: ms, text: previewText(text) };
  };
  const body = snap.serverBody as { messages?: HubUserMessage[] } | null;
  for (const m of Array.isArray(body?.messages) ? body!.messages! : []) bump(m?.from_session, m?.created_at, m?.content || m?.title);
  for (const r of (snap.replyRows ?? []) as readonly HubMessage[]) {
    if (snap.replyUsername && r?.to_alias === snap.replyUsername) bump(r.from_alias, r.created_at, r.content);
  }
  return out;
}

export interface AgentRowModel {
  alias: string;
  status: RowStatus;
  /** Second line: the last message, else what the agent reports it is doing, else ''. */
  preview: string;
  /** Right column, top. Always the time of the event the preview line shows. */
  time: string;
  /** Which event `preview` / `time` describe (null ⇒ no activity data; no time). */
  source: ActivitySource;
  /** ms of that event (0 when unknown) — the value `sortByActivity` orders by. */
  activityAt: number;
  pinned: boolean;
}

export type ActivitySource = 'message' | 'task' | null;

/**
 * The row's activity: the preview text and the time of the SAME event.
 *   - a last message with text → that message, at its time;
 *   - else the session's task text → that text, at the time of the task row it came from
 *     (`taskAt`, agent-task-time.ts; 0 ⇒ the hub has no row for that text ⇒ no time);
 *   - else a last message with no text → no preview, the message time.
 */
export function rowActivity(
  session: Pick<Session, 'task'>,
  latest?: LatestMessage,
  taskAt = 0,
): { preview: string; source: ActivitySource; at: number } {
  if (latest?.text) return { preview: latest.text, source: 'message', at: latest.at };
  const task = previewText(session.task);
  if (task) return { preview: task, source: taskAt > 0 ? 'task' : null, at: taskAt > 0 ? taskAt : 0 };
  if (latest) return { preview: '', source: 'message', at: latest.at };
  return { preview: '', source: null, at: 0 };
}

/**
 * 🔴 The time is never `session.updated_at`: the hub bumps updated_at on every heartbeat (its
 * stale sweeper marks a session offline when it stops moving), so it would print "刚刚" on every
 * online row. It is the time of whatever the preview line shows (rowActivity).
 */
export function agentRowModel(
  session: Pick<Session, 'alias' | 'status' | 'task'>,
  opts: { latest?: LatestMessage; taskAt?: number; pinned?: boolean; nowMs?: number } = {},
): AgentRowModel {
  const act = rowActivity(session, opts.latest, opts.taskAt);
  return {
    alias: session.alias,
    status: rowStatus(session.status),
    preview: act.preview,
    time: act.at ? formatRowTime(act.at, opts.nowMs) : '',
    source: act.source,
    activityAt: act.at,
    pinned: !!opts.pinned,
  };
}
