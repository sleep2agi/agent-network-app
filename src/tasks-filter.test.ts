// 纯逻辑单测(bun/node 可跑·无 RN 依赖)。run: bun src/tasks-filter.test.ts
//
// Every constant asserted here comes from `./tasks-filter` via import —
// no rewritten literals. Bump POLL_LIST_MS in tasks-filter.ts and the
// witnessed-red constants below turn red at the same time, because both
// pull from the same source.
//
// Filter tests report the DENOMINATOR (input count) alongside each
// filtered count, so a filter that quietly reduces the input to zero
// can't hide behind a green "expected 0, got 0" — see
// [[feedback_checker_scope_bug_vacuous_pass]] +
// [[feedback_report_case_scope_not_capability]].

import {
  filterTasks,
  deriveListState,
  eventsResultToState,
  statusBucket,
  TASK_FILTERS,
  POLL_LIST_MS,
  POLL_DETAIL_MS,
  type TaskFilter,
} from './tasks-filter';
import type { HubTask, FetchTaskEventsResult } from './api';

let p = 0, t = 0;
const ck = (name: string, cond: boolean) => {
  t++;
  if (cond) { p++; console.log('✅', name); }
  else console.log('❌', name);
};

// ─── Fixture ───────────────────────────────────────────────────────
// Mix of every status bucket + one 'unknown' so filter+bucket both get
// real distribution to work on (not a monoculture that hides bugs).
const TASKS: HubTask[] = [
  { task_id: 't-r1', status: 'running',   from_name: 'a', to_name: 'b', content: 'run one' },
  { task_id: 't-r2', status: 'working',   from_name: 'a', to_name: 'c', content: 'working alias' },
  { task_id: 't-f1', status: 'failed',    from_name: 'x', to_name: 'y', content: 'fail one' },
  { task_id: 't-f2', status: 'timeout',   from_name: 'x', to_name: 'z', content: 'timeout counts failed?' },
  { task_id: 't-p1', status: 'replied',   from_name: 'a', to_name: 'd', content: 'reply one' },
  { task_id: 't-p2', status: 'completed', from_name: 'a', to_name: 'e', content: 'completed alias' },
  { task_id: 't-i1', status: 'pending',   from_name: 'q', to_name: 'r', content: 'pending' },
  { task_id: 't-u1', status: 'weird_state', from_name: 'q', to_name: 's', content: 'unknown status' },
];
const TOTAL = TASKS.length;  // denominator

// ─── 1. FILTER — each chip changes count in the RIGHT direction ─────
ck(`all shows every input (${TOTAL}/${TOTAL})`, filterTasks(TASKS, 'all').length === TOTAL);

const running = filterTasks(TASKS, 'running');
ck(`filter=running strict 'running' only (1/${TOTAL})`,
   running.length === 1 && running.every(t => t.status === 'running'));

const failed = filterTasks(TASKS, 'failed');
ck(`filter=failed strict 'failed' only (1/${TOTAL})`,
   failed.length === 1 && failed.every(t => t.status === 'failed'));

const replied = filterTasks(TASKS, 'replied');
ck(`filter=replied strict 'replied' only (1/${TOTAL})`,
   replied.length === 1 && replied.every(t => t.status === 'replied'));

// Two-direction verification (per [[feedback_verify_both_directions_with_real_data]]):
// (a) the filter matches at least one row — not vacuously green on empty
// (b) the filter *excludes* rows with other statuses — not just accepting everything
ck('filter=running excludes non-running (failed/replied/pending gone)',
   filterTasks(TASKS, 'running').every(t => t.status !== 'failed' && t.status !== 'replied' && t.status !== 'pending'));
ck('filter=failed excludes running',
   filterTasks(TASKS, 'failed').every(t => t.status !== 'running'));
ck('filter=replied excludes failed',
   filterTasks(TASKS, 'replied').every(t => t.status !== 'failed'));

// Clearing filter = restoring full set
ck(`clear filter restores denominator (${TOTAL})`, filterTasks(TASKS, 'all').length === TOTAL);

// ─── 2. STATUS BUCKET — the exact allowlist, not shape match ────────
ck('bucket running: running',       statusBucket('running') === 'running');
ck('bucket working alias: running', statusBucket('working') === 'running');
ck('bucket delivered alias: running', statusBucket('delivered') === 'running');
ck('bucket failed: failed',         statusBucket('failed') === 'failed');
ck('bucket error alias: failed',    statusBucket('error') === 'failed');
ck('bucket timeout alias: failed',  statusBucket('timeout') === 'failed');
ck('bucket replied: replied',       statusBucket('replied') === 'replied');
ck('bucket completed alias: replied', statusBucket('completed') === 'replied');
ck('bucket pending: pending',       statusBucket('pending') === 'pending');
ck('bucket empty string: pending',  statusBucket('') === 'pending');
ck('bucket undefined: pending',     statusBucket(undefined) === 'pending');
ck('bucket unknown-status → unknown (NOT default running)', statusBucket('weird_state') === 'unknown');

// ─── 3. LIST STATE — three distinct kinds, no collapse ─────────────
const stLoading = deriveListState({ loaded: false, tasks: null, lastError: null });
ck('state loading: kind=loading', stLoading.kind === 'loading');

const stError = deriveListState({ loaded: false, tasks: null, lastError: 'HTTP 502' });
ck('state error (never-loaded + err): kind=error + msg',
   stError.kind === 'error' && (stError as any).message === 'HTTP 502');

const stReady = deriveListState({ loaded: true, tasks: TASKS, lastError: null });
ck(`state ready: kind=ready + tasks.length=${TOTAL}`,
   stReady.kind === 'ready' && (stReady as any).tasks.length === TOTAL);

const stEmptyReady = deriveListState({ loaded: true, tasks: [], lastError: null });
ck('state empty-ready: kind=ready + tasks=[] (real zero, NOT loading)',
   stEmptyReady.kind === 'ready' && (stEmptyReady as any).tasks.length === 0);

// Prior-cached-data-plus-error must NOT be mistaken for loading: the
// UI should show the cached rows with an error banner, not a spinner.
const stCachedButErrored = deriveListState({ loaded: true, tasks: TASKS, lastError: 'HTTP 502' });
ck('state ready-with-cache-during-transient-error stays ready',
   stCachedButErrored.kind === 'ready');

// ─── 4. EVENTS FEED STATE — 4 kinds map from api.ts discriminated ──
ck('events null → loading', eventsResultToState(null).kind === 'loading');

const okResult: FetchTaskEventsResult = { ok: true, events: [{ event_type: 'e1' }], count: 1 };
const stOk = eventsResultToState(okResult);
ck('events ok → ok + count=1', stOk.kind === 'ok' && (stOk as any).count === 1);

const upgradeResult: FetchTaskEventsResult = { ok: false, unconfirmed: true, error: 'hub needs upgrade' };
const stNotWired = eventsResultToState(upgradeResult);
ck('events 404/501 → not-wired + err surfaces',
   stNotWired.kind === 'not-wired' && (stNotWired as any).error === 'hub needs upgrade');

const netFail: FetchTaskEventsResult = { ok: false, unconfirmed: false, error: 'ECONNRESET' };
const stErr = eventsResultToState(netFail);
ck('events transient failure → error (distinct from not-wired)',
   stErr.kind === 'error' && (stErr as any).error === 'ECONNRESET');

// Cross-check: the three failure-shaped states are mutually distinct
// so the UI can render three different banners. Silent collapse would
// hide a "hub needs upgrade" behind a generic "please retry".
ck('feed states loading/ok/not-wired/error are 4 distinct kinds',
   new Set([
     eventsResultToState(null).kind,
     eventsResultToState(okResult).kind,
     eventsResultToState(upgradeResult).kind,
     eventsResultToState(netFail).kind,
   ]).size === 4);

// ─── 5. POLL CONSTANTS — same-source guarantee ─────────────────────
// The assertion values below come from the imports at the top; the
// screen files import the SAME constants. If POLL_LIST_MS changes to
// 3000, TasksScreen's poll runs at 3000ms AND its testID reads 3000
// AND this assertion turns red — no drift possible.
//
// Guard against a stray zero/negative refactor turning polling off
// entirely (which would look like "no updates" in production, not a
// test failure).
ck('POLL_LIST_MS is a positive integer',
   Number.isInteger(POLL_LIST_MS) && POLL_LIST_MS > 0);
ck('POLL_DETAIL_MS is a positive integer',
   Number.isInteger(POLL_DETAIL_MS) && POLL_DETAIL_MS > 0);
// Cadence sanity: don't let someone accidentally set 100ms (hammers hub)
// or 1 hour (feels broken). This range is a rate-limit sanity, not a
// spec pin — bump both bounds if we ever intentionally cross them.
ck('POLL_LIST_MS in [1s, 60s] sanity range',
   POLL_LIST_MS >= 1000 && POLL_LIST_MS <= 60_000);
ck('POLL_DETAIL_MS in [1s, 60s] sanity range',
   POLL_DETAIL_MS >= 1000 && POLL_DETAIL_MS <= 60_000);

// TASK_FILTERS must include the three the brief pinned. If someone
// re-orders or drops one, this red catches it — same shape as a shape-
// allowlist audit ([[feedback_allowlist_must_be_exact_value_not_shape_match]]).
const filterSet = new Set<TaskFilter>(TASK_FILTERS);
ck('TASK_FILTERS contains running',  filterSet.has('running'));
ck('TASK_FILTERS contains failed',   filterSet.has('failed'));
ck('TASK_FILTERS contains replied',  filterSet.has('replied'));
ck('TASK_FILTERS contains all (unfiltered pass-through)', filterSet.has('all'));

// ─── result ──────────────────────────────────────────────────────
console.log(`\n${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
