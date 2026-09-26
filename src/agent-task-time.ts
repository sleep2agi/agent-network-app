// When did the row's *task text* happen? (agent list right-column time, second source)
// Pure + an injected fetcher: no React / react-native, so agent-task-time.test.ts runs it directly.
//
// Vincent on 0.2.113: rows whose second line is the agent's current task (all the TM rows) had
// no time, because the row time came only from the last user↔agent message. The preview line
// falls back to `session.task`, so the time has to come from the same place the text came from.
//
// Where `session.task` comes from on the hub (agent-network server/src, origin/main):
//   - send_task (MCP tools.ts / REST POST /api/task in server.ts) and a scheduled run
//     (scheduled-tasks.ts) INSERT a `tasks` row and, in the same transaction, set
//     `sessions.task = content.slice(0, 200)`. That task row's `created_at` is exactly when the
//     text became the row's preview.
//   - report_status (tools.ts upsert) may overwrite `task` with the agent's own words. There is
//     no timestamp for that: `updated_at` / `last_seen_at` move on every heartbeat.
//
// 🔴 So the rule is: the task time is the `created_at` of the agent's LATEST task row, and only
//    when that row's content is the text the row shows. Anything else (report_status text, a
//    task row the hub no longer keeps) gets no time — a time next to text it does not describe
//    is worse than no time. `session.updated_at` is never read here: it is heartbeat noise.

import type { HubTask } from './api';
import { hubTimeMs } from './agent-unread-counts';

/** Same shape as the hub's light `/api/status` task (whitespace collapsed, `…` when cut at 160). */
export function normTaskText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().replace(/…$/, '').trim();
}

/**
 * Is this task row the one whose content the session shows?
 * The session holds `content.slice(0, 200)`, and the light status trims that again to 160 + `…`,
 * so the comparison is "the task content starts with the shown text".
 */
export function taskMatchesText(task: Pick<HubTask, 'content'> | null | undefined, shown: unknown): boolean {
  const want = normTaskText(shown);
  if (!want || typeof task?.content !== 'string') return false;
  return normTaskText(task.content.slice(0, 200)).startsWith(want);
}

/** The time of the task the row's text came from, or 0 when no task row describes that text. */
export function taskTimeForText(latestTasks: readonly HubTask[] | null | undefined, shown: unknown): number {
  const latest = latestTasks?.[0];
  return latest && taskMatchesText(latest, shown) ? hubTimeMs(latest.created_at) : 0;
}

type Entry = { text: string; at: number; checkedAt: number };

export interface TaskTimeWant {
  alias: string;
  /** The task text the row shows (session.task). */
  text: string;
  online: boolean;
}

/**
 * Per-alias cache of "the time of the task text this row shows".
 *
 * Cost (the desktop reaches the hub through a ~13 KB/s relay): one `to_name=<alias>&limit=1`
 * read per alias, only for rows whose preview IS the task text, and then only again when
 *   - the text changes (a new dispatch or a report_status), or
 *   - the row is online and the answer is older than `refreshMs` — a probe re-sent with the
 *     same text every hour changes nothing the status list shows, so only a re-read finds it.
 * A heartbeat changes neither, so it never triggers a read and never moves the time.
 */
export class TaskTimeResolver {
  private entries = new Map<string, Entry>();
  private inFlight = new Set<string>();
  private queue: TaskTimeWant[] = [];
  private listeners = new Set<() => void>();
  private active = 0;

  constructor(
    private fetchLatest: (alias: string) => Promise<HubTask[]>,
    private opts: { now?: () => number; refreshMs?: number; concurrency?: number } = {},
  ) {}

  private now() { return this.opts.now?.() ?? Date.now(); }

  /** Time (ms) for this alias + text; 0 when unknown or when the text has no task row. */
  timeFor(alias: string, text: unknown): number {
    const e = this.entries.get(alias);
    return e && e.text === normTaskText(text) ? e.at : 0;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** Whether `want` needs a (re)read right now. */
  needsLookup(want: TaskTimeWant): boolean {
    const text = normTaskText(want.text);
    if (!text) return false;
    const e = this.entries.get(want.alias);
    if (!e || e.text !== text) return true;
    return want.online && this.now() - e.checkedAt >= (this.opts.refreshMs ?? 10 * 60_000);
  }

  /** Queue lookups for the rows that need one. Resolves when this batch has drained. */
  request(wants: readonly TaskTimeWant[]): Promise<void> {
    for (const w of wants) {
      if (this.inFlight.has(w.alias) || !this.needsLookup(w)) continue;
      this.inFlight.add(w.alias);
      this.queue.push(w);
    }
    return this.pump();
  }

  private async pump(): Promise<void> {
    const limit = this.opts.concurrency ?? 3;
    const workers: Promise<void>[] = [];
    while (this.active < limit && this.queue.length) {
      this.active++;
      workers.push(this.work());
    }
    await Promise.all(workers);
  }

  private async work(): Promise<void> {
    try {
      for (let w = this.queue.shift(); w; w = this.queue.shift()) {
        const text = normTaskText(w.text);
        try {
          const rows = await this.fetchLatest(w.alias);
          const prev = this.entries.get(w.alias);
          const at = taskTimeForText(rows, text);
          this.entries.set(w.alias, { text, at, checkedAt: this.now() });
          if (!prev || prev.text !== text || prev.at !== at) this.listeners.forEach(fn => fn());
        } catch {
          /* hub unreachable / old hub: leave the entry as it was and retry on a later poll */
        } finally {
          this.inFlight.delete(w.alias);
        }
      }
    } finally {
      this.active--;
    }
  }
}
