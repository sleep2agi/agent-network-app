// Pure logic for the network event stream screen — ring buffer +
// connection-state derivation + type→visual bucket. Kept RN-free so
// the bun-runnable test file next door can exercise every branch
// without mocking React or Metro.
//
// 🔴 UI truth (通信龙 07-31): the /events/network/{netId} SSE stream
// carries ROUTING METADATA ONLY (task_id / from / to / status /
// priority / message_id). It does NOT contain the message content.
// The screen must SAY that in its subtitle; users can't be shown a
// screen labeled "日志" and find no message bodies — the interface
// must promise what it actually delivers. See LogsScreen.tsx header.

import type { HubTaskEvent } from './api';

/** Ring-buffer cap. On overflow the OLDEST entries are dropped so
 *  the phone doesn't grow the log list without bound. Reported by
 *  the screen's counter — you'll see e.g. "500 / 500 (12 dropped)". */
export const LOGS_MAX = 500;

/** Reconnect base + max backoff for logs-sse. Kept here so tests can
 *  assert both live inside sane bounds — a stray 0ms would hammer the
 *  hub; a stray 5-minute value would look "hung" to users. */
export const RECONNECT_MIN_MS = 2000;
export const RECONNECT_MAX_MS = 30_000;

// Any JSON payload the hub can push over the SSE frame. We keep the
// shape open because the observer stream is under active evolution
// (new hub versions may add fields); locking the shape here would
// silently drop useful data.
export type LogEvent = Record<string, unknown> & {
  /** Received-at timestamp (client clock), used for row time labels
   *  when the payload doesn't carry created_at. */
  _at?: number;
};

/** Ring-buffer push. Returns the new array (immutable — React state).
 *  `dropped` counts how many events fell off the OLD end this call. */
export function pushLog(
  buffer: LogEvent[],
  event: LogEvent,
  max = LOGS_MAX,
): { entries: LogEvent[]; dropped: number } {
  const next = [...buffer, event];
  if (next.length <= max) return { entries: next, dropped: 0 };
  const overflow = next.length - max;
  return { entries: next.slice(overflow), dropped: overflow };
}

/** Batch push variant — same guarantee, single allocation. */
export function pushLogBatch(
  buffer: LogEvent[],
  events: LogEvent[],
  max = LOGS_MAX,
): { entries: LogEvent[]; dropped: number } {
  const next = [...buffer, ...events];
  if (next.length <= max) return { entries: next, dropped: 0 };
  const overflow = next.length - max;
  return { entries: next.slice(overflow), dropped: overflow };
}

// Connection state — three explicit kinds. UI renders three different
// banners so "no events yet" (connected + zero rows) and "not
// connected" (transport down) can't be confused. See
// [[feedback_unknown_state_ui_must_say_what_and_where]].
export type ConnState = 'connecting' | 'connected' | 'disconnected';

// Type → visual bucket. Colors chosen from the theme (accent / running
// / failed / blocked / rest) so light+dark modes both work.
//
// 🔴 Any unrecognized type falls into 'unknown' — NOT into a default
// bucket. The screen renders the raw type string next to a neutral
// gray chip so a hub-side new type is visible instead of silently
// remapped ([[feedback_allowlist_must_be_exact_value_not_shape_match]]).
export type TypeBucket =
  | 'task'         // new_task, task_status_transition
  | 'broadcast'
  | 'lifecycle'    // node_deleted, node_renamed, etc.
  | 'unknown';

export function typeBucket(type?: unknown): TypeBucket {
  const t = typeof type === 'string' ? type.toLowerCase() : '';
  if (t === 'new_task' || t === 'task_status_transition' || t === 'task_replied') return 'task';
  if (t === 'broadcast') return 'broadcast';
  if (t === 'node_deleted' || t === 'node_renamed' || t === 'node_added') return 'lifecycle';
  return 'unknown';
}

// UI states — three kinds, distinct testIDs so QA can tell an empty
// connected stream apart from a disconnected one.
export type LogsListState =
  | { kind: 'connecting' }             // haven't seen the first frame yet
  | { kind: 'empty-connected' }        // connected + zero events → the network is quiet
  | { kind: 'ready'; events: LogEvent[] }
  | { kind: 'disconnected'; error?: string; entriesShown: number };

export function deriveLogsState(input: {
  conn: ConnState;
  events: LogEvent[];
  error?: string;
}): LogsListState {
  if (input.conn === 'connecting' && input.events.length === 0) return { kind: 'connecting' };
  if (input.conn === 'disconnected') {
    return { kind: 'disconnected', error: input.error, entriesShown: input.events.length };
  }
  if (input.events.length === 0) return { kind: 'empty-connected' };
  return { kind: 'ready', events: input.events };
}

/** Auto-scroll pause detection. If the user has scrolled up more than
 *  this many pixels from the visual bottom, we STOP auto-scrolling to
 *  new events — otherwise the row they're reading gets yanked away
 *  every time a new event arrives (通信龙 07-31: "日志一来就被冲走"). */
export const AUTOSCROLL_PAUSE_THRESHOLD_PX = 80;

export function shouldPauseAutoscroll(distanceFromBottomPx: number): boolean {
  return distanceFromBottomPx > AUTOSCROLL_PAUSE_THRESHOLD_PX;
}

// Backoff schedule for the SSE reconnector. Exposed so the test file
// can pin the sequence — a subtle bug (e.g. never crossing the ceiling)
// would look fine in production until the first long outage.
export function nextBackoffMs(currentMs: number): number {
  const doubled = Math.max(currentMs, RECONNECT_MIN_MS) * 2;
  return Math.min(doubled, RECONNECT_MAX_MS);
}

// Utility for the row's time label — "just now" for anything within
// 60s of receive, otherwise HH:MM:SS. Kept here because both the row
// component and the debug/dev overlay use the same formatter.
export function formatEventTime(atMs: number, nowMs: number): string {
  const diff = nowMs - atMs;
  if (diff < 60_000) return '刚刚';
  const d = new Date(atMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// (unused) placeholder so `import type { HubTaskEvent }` isn't tree-shaken —
// LogEvent is intentionally wider than HubTaskEvent to accept new hub
// payloads (task_status_transition etc.). Keeping the type reference
// documents the relationship.
export type _RelatedShape = HubTaskEvent;
