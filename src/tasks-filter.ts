// Pure logic for the Tasks screen — status filter + poll intervals +
// UI state derivation from an api.ts response. Kept RN-free so the
// bun-runnable test file next door can exercise every branch without
// mocking React or Metro.
//
// 🔴 POLL_LIST_MS / POLL_DETAIL_MS live here so `usePoll(...)` AND the
// testID string in the screen file (poll-list-ms={POLL_LIST_MS}) share
// ONE source. Assertions that pull from this same constant are same-
// source with the behavior (the poll interval), not with a written-down
// literal — mutation reddens the assertion. See
// [[feedback_assert_the_fact_not_the_declaration]].

import type { HubTask, FetchTaskEventsResult } from './api';

export const POLL_LIST_MS = 5000;    // task list refresh cadence
export const POLL_DETAIL_MS = 5000;  // single-task detail refresh cadence

// Filter chips exposed in the top bar. `all` is the un-filtered pass-
// through. running/failed/replied are the three the brief pinned; adding
// a fourth means bumping this array AND the filter switch below AND the
// witnessed-red round for it — no silent widening.
export const TASK_FILTERS = ['all', 'running', 'failed', 'replied'] as const;
export type TaskFilter = (typeof TASK_FILTERS)[number];

/** Filter a task list by the selected chip. `all` returns the input verbatim
 *  so callers can uniformly consume filterTasks(list, filter). */
export function filterTasks(tasks: HubTask[], filter: TaskFilter): HubTask[] {
  if (filter === 'all') return tasks;
  return tasks.filter(t => (t.status || '') === filter);
}

// TasksScreen list has three loaded states — kept distinct so the UI
// never collapses "no data yet" with "0 tasks" with "load errored":
//   - 'loading' — first fetch in flight, nothing to show yet
//   - 'error'   — fetch failed and we have no cached data to fall back to
//   - 'ready'   — fetch completed; `tasks` may still be empty (real 0)
export type TasksListState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; tasks: HubTask[] };

export function deriveListState(input: {
  loaded: boolean;
  tasks: HubTask[] | null;
  lastError: string | null;
}): TasksListState {
  if (!input.loaded && (input.tasks === null || input.tasks.length === 0)) {
    if (input.lastError) return { kind: 'error', message: input.lastError };
    return { kind: 'loading' };
  }
  if (input.tasks && input.lastError && input.tasks.length === 0) {
    return { kind: 'error', message: input.lastError };
  }
  return { kind: 'ready', tasks: input.tasks ?? [] };
}

// Events feed collapses into one of four visual states. This mirrors
// the discriminated FetchTaskEventsResult from api.ts and adds a
// pre-fetch 'loading' state that api.ts can't return on its own.
export type EventsFeedState =
  | { kind: 'loading' }
  | { kind: 'ok'; events: NonNullable<Extract<FetchTaskEventsResult, { ok: true }>['events']>; count: number }
  | { kind: 'not-wired'; error: string }   // hub doesn't expose the endpoint (or is too old)
  | { kind: 'error'; error: string };      // transient network / hub 5xx / etc.

export function eventsResultToState(
  result: FetchTaskEventsResult | null,
): EventsFeedState {
  if (!result) return { kind: 'loading' };
  if (result.ok) return { kind: 'ok', events: result.events, count: result.count };
  if (result.unconfirmed) return { kind: 'not-wired', error: result.error };
  return { kind: 'error', error: result.error };
}

// Status → semantic bucket used for the badge color on list rows.
// 'unknown' is intentional: a status the app doesn't know about should
// render as gray (rest) rather than fall through to a default green —
// see [[feedback_allowlist_must_be_exact_value_not_shape_match]].
export type StatusBucket = 'running' | 'failed' | 'replied' | 'pending' | 'unknown';

export function statusBucket(status?: string): StatusBucket {
  switch ((status || '').toLowerCase()) {
    case 'running':
    case 'working':
    case 'delivered':
      return 'running';
    case 'failed':
    case 'error':
    case 'timeout':
      return 'failed';
    case 'replied':
    case 'completed':
      return 'replied';
    case 'pending':
    case 'created':
    case '':
      return 'pending';
    default:
      return 'unknown';
  }
}
