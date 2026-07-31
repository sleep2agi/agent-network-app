// 纯逻辑单测(bun/node 可跑·无 RN 依赖)。run: bun src/logs-buffer.test.ts
//
// Ring buffer + connection state + type bucket. Assertions pull LOGS_MAX
// / RECONNECT_* / AUTOSCROLL_PAUSE_THRESHOLD_PX from the module — no
// rewritten literals; a bump to the constant moves both the code and
// the assertion together.

import {
  pushLog,
  pushLogBatch,
  typeBucket,
  deriveLogsState,
  shouldPauseAutoscroll,
  nextBackoffMs,
  formatEventTime,
  LOGS_MAX,
  RECONNECT_MIN_MS,
  RECONNECT_MAX_MS,
  AUTOSCROLL_PAUSE_THRESHOLD_PX,
  type LogEvent,
  type ConnState,
  type LogsListState,
} from './logs-buffer';

let p = 0, t = 0;
const ck = (name: string, cond: boolean) => {
  t++;
  if (cond) { p++; console.log('✅', name); }
  else console.log('❌', name);
};

// ─── Fixture builders ───────────────────────────────────────────
const mkEvent = (i: number, type: string): LogEvent => ({
  type,
  task_id: `t-${i}`,
  from: 'a', to: 'b',
  _at: 1_600_000_000_000 + i,
});

const FILL_10 = Array.from({ length: 10 }, (_, i) => mkEvent(i, 'new_task'));

// ─── 1. RING BUFFER — max cap, dropped counter, order preserved ────
{
  const start: LogEvent[] = [];
  const { entries, dropped } = pushLog(start, mkEvent(0, 'new_task'), 5);
  ck(`push into empty (max=5): len=1, dropped=0`,
     entries.length === 1 && dropped === 0);
}

{
  // Fill exactly to cap
  let buf: LogEvent[] = [];
  for (let i = 0; i < 5; i++) buf = pushLog(buf, mkEvent(i, 'new_task'), 5).entries;
  ck(`filled to cap (5/5): len=5`, buf.length === 5);

  // Overflow by 1 → oldest dropped, newest kept
  const { entries, dropped } = pushLog(buf, mkEvent(99, 'new_task'), 5);
  ck(`overflow by 1: len=5, dropped=1`, entries.length === 5 && dropped === 1);
  ck(`overflow drops OLDEST (task_id t-0 gone)`,
     !entries.some(e => e.task_id === 't-0'));
  ck(`overflow keeps NEWEST (task_id t-99 present + at tail)`,
     entries[entries.length - 1].task_id === 't-99');
}

{
  // Batch push overflow — same guarantee in one shot
  const { entries, dropped } = pushLogBatch(FILL_10, FILL_10, 12);
  ck(`batch overflow (20 into cap=12): len=12, dropped=8`,
     entries.length === 12 && dropped === 8);
}

// ─── 2. LOGS_MAX + RECONNECT + AUTOSCROLL constants — same-source ──
ck('LOGS_MAX is a positive integer', Number.isInteger(LOGS_MAX) && LOGS_MAX > 0);
// Sanity range: 500 default; a runaway 5_000_000 would exhaust phone RAM
// (~2KB/event × N ≈ 10 GB), a 0 would silently disable log memory.
ck('LOGS_MAX in [50, 10_000] sanity range', LOGS_MAX >= 50 && LOGS_MAX <= 10_000);

ck('RECONNECT_MIN_MS is a positive integer',
   Number.isInteger(RECONNECT_MIN_MS) && RECONNECT_MIN_MS > 0);
ck('RECONNECT_MAX_MS >= RECONNECT_MIN_MS',
   RECONNECT_MAX_MS >= RECONNECT_MIN_MS);
ck('RECONNECT_MIN in [500ms, 10s] sanity',
   RECONNECT_MIN_MS >= 500 && RECONNECT_MIN_MS <= 10_000);
ck('RECONNECT_MAX in [10s, 5min] sanity',
   RECONNECT_MAX_MS >= 10_000 && RECONNECT_MAX_MS <= 5 * 60_000);

ck('AUTOSCROLL_PAUSE_THRESHOLD_PX positive',
   AUTOSCROLL_PAUSE_THRESHOLD_PX > 0);

// ─── 3. TYPE BUCKET — allowlist, unknown → 'unknown' (NOT default) ──
ck('bucket new_task → task', typeBucket('new_task') === 'task');
ck('bucket task_status_transition → task', typeBucket('task_status_transition') === 'task');
ck('bucket task_replied → task', typeBucket('task_replied') === 'task');
ck('bucket broadcast → broadcast', typeBucket('broadcast') === 'broadcast');
ck('bucket node_deleted → lifecycle', typeBucket('node_deleted') === 'lifecycle');
ck('bucket node_renamed → lifecycle', typeBucket('node_renamed') === 'lifecycle');
ck('bucket node_added → lifecycle', typeBucket('node_added') === 'lifecycle');
ck('bucket UNKNOWN string → unknown (NOT default to any bucket)',
   typeBucket('some_new_hub_type_2027') === 'unknown');
ck('bucket empty string → unknown', typeBucket('') === 'unknown');
ck('bucket undefined → unknown', typeBucket(undefined) === 'unknown');
ck('bucket non-string (number 5) → unknown', typeBucket(5 as unknown) === 'unknown');
ck('bucket case-insensitive: NEW_TASK → task', typeBucket('NEW_TASK') === 'task');

// ─── 4. LIST STATE — four kinds, distinct testID-worthy branches ────
const stConn: LogsListState = deriveLogsState({ conn: 'connecting', events: [] });
ck('state connecting (before first frame): kind=connecting',
   stConn.kind === 'connecting');

const stEmpty: LogsListState = deriveLogsState({ conn: 'connected', events: [] });
ck('state empty-connected (connected + 0 events): kind=empty-connected',
   stEmpty.kind === 'empty-connected');

const stReady: LogsListState = deriveLogsState({ conn: 'connected', events: FILL_10 });
ck(`state ready: kind=ready + events.length=10`,
   stReady.kind === 'ready' && (stReady as any).events.length === 10);

const stDisc: LogsListState = deriveLogsState({ conn: 'disconnected', events: FILL_10, error: 'ECONNRESET' });
ck('state disconnected + prior events: kind=disconnected + entriesShown=10',
   stDisc.kind === 'disconnected' && (stDisc as any).entriesShown === 10);

const stDiscEmpty: LogsListState = deriveLogsState({ conn: 'disconnected', events: [], error: 'HTTP 401' });
ck('state disconnected + zero events: kind=disconnected + entriesShown=0 + err',
   stDiscEmpty.kind === 'disconnected'
   && (stDiscEmpty as any).entriesShown === 0
   && (stDiscEmpty as any).error === 'HTTP 401');

// Four kinds are mutually distinct — UI can render four different banners
ck('four state kinds are distinct',
   new Set([stConn.kind, stEmpty.kind, stReady.kind, stDisc.kind]).size === 4);

// ─── 5. AUTOSCROLL PAUSE — threshold gate ───────────────────────────
ck('autoscroll pause: near bottom (10px) → no pause',
   shouldPauseAutoscroll(10) === false);
ck('autoscroll pause: exactly threshold → NO pause (strict >)',
   shouldPauseAutoscroll(AUTOSCROLL_PAUSE_THRESHOLD_PX) === false);
ck('autoscroll pause: past threshold → pause',
   shouldPauseAutoscroll(AUTOSCROLL_PAUSE_THRESHOLD_PX + 1) === true);
ck('autoscroll pause: far away → pause',
   shouldPauseAutoscroll(9999) === true);

// ─── 6. RECONNECT BACKOFF — doubles, caps at MAX ────────────────────
ck(`backoff from 0 → MIN=${RECONNECT_MIN_MS}`,
   nextBackoffMs(0) === RECONNECT_MIN_MS * 2);   // 0 → doubled(MIN)
{
  let cur = RECONNECT_MIN_MS;
  const seen = new Set<number>();
  for (let i = 0; i < 15; i++) {
    cur = nextBackoffMs(cur);
    seen.add(cur);
  }
  const hitCeiling = [...seen].some(v => v === RECONNECT_MAX_MS);
  ck(`backoff eventually caps at RECONNECT_MAX_MS (${RECONNECT_MAX_MS})`, hitCeiling);
  const overshoots = [...seen].filter(v => v > RECONNECT_MAX_MS);
  ck('backoff never exceeds RECONNECT_MAX_MS', overshoots.length === 0);
}

// ─── 7. TIME LABEL — "刚刚" vs HH:MM:SS ─────────────────────────────
{
  const now = 1_700_000_000_000;
  ck('time: within 60s → "刚刚"', formatEventTime(now - 5_000, now) === '刚刚');
  ck('time: > 60s → HH:MM:SS format',
     /^\d{2}:\d{2}:\d{2}$/.test(formatEventTime(now - 3_600_000, now)));
}

// ─── result ─────────────────────────────────────────────────────────
console.log(`\n${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
