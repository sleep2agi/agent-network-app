// ck-style self-executing test (run by scripts/run-tests.mjs under bun). NOT bun:test.
// 执行记录:连续「上一次还没结束」跳过折成一行 + 在等哪一次 + 等了多久,以及屏幕接线。
import { readFileSync } from 'node:fs';
import type { HubScheduledRun } from './api';
import { setLanguagePreference } from './i18n';
import { clockOf, formatWait, groupScheduleRuns, skipGroupText, skipGroupTimes, skipGroupWait, type RunListItem } from './schedule-run-groups';

let passed = 0;
const ck = (label: string, ok: boolean, extra: unknown = '') => {
  if (!ok) { console.error(`FAIL: ${label} ${extra === '' ? '' : JSON.stringify(extra)}`); process.exit(1); }
  passed++;
};
const eq = (label: string, actual: unknown, expected: unknown) =>
  ck(label, JSON.stringify(actual) === JSON.stringify(expected), { actual, expected });

// 分钟 → Hub 的 SQLite UTC 时刻串("2026-09-29 08:MM:00");interval 计划每分钟一个 tick。
const at = (min: number) => `2026-09-29 ${String(8 + Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00`;
const iso = (min: number) => `${at(min).replace(' ', 'T')}.000Z`;
const skip = (min: number, code = 'previous_run_active'): HubScheduledRun => ({
  run_id: `srun_s${min}`, schedule_id: 'sched_1', scheduled_for: iso(min), task_id: null,
  status: 'skipped', error_code: code, error_message: null, created_at: at(min), completed_at: at(min),
});
const sent = (min: number, over: Partial<HubScheduledRun> = {}): HubScheduledRun => ({
  run_id: `srun_d${min}`, schedule_id: 'sched_1', scheduled_for: iso(min), task_id: `task_${min}`,
  status: 'delivered', error_code: null, error_message: null, created_at: at(min), completed_at: null, ...over,
});
/** 新 → 旧,和 GET /runs 的 ORDER BY created_at DESC 一样。 */
const desc = (...rows: HubScheduledRun[]) => rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
const shape = (items: RunListItem[]) => items.map(i => i.kind === 'run' ? i.run.run_id : `group(${i.runs.length})`);
const groupAt = (items: RunListItem[], n = 0) => items.filter((i): i is Extract<RunListItem, { kind: 'skipGroup' }> => i.kind === 'skipGroup')[n];

// ── 连续跳过折成一组 ──────────────────────────────────────────────────
{
  const runs = desc(sent(0), ...[1, 2, 3, 4, 5].map(m => skip(m)));
  const items = groupScheduleRuns(runs);
  eq('five consecutive skips → one group row + the blocker row', shape(items), ['group(5)', 'srun_d0']);
  const g = groupAt(items);
  eq('group keeps API order (newest first)', g.runs.map(r => r.run_id), ['srun_s5', 'srun_s4', 'srun_s3', 'srun_s2', 'srun_s1']);
  eq('blocker = nearest earlier run that was actually sent', g.blocker?.run_id, 'srun_d0');
  ck('group at the top is the newest', g.newest);
  eq('group key follows the newest skip', g.key, 'skipgroup:srun_s5');
}

// ── 中间夹一条正常执行 → 拆成两组 ─────────────────────────────────────
{
  const runs = desc(sent(0, { status: 'replied', completed_at: at(3) }), skip(1), skip(2), sent(4), skip(5), skip(6), skip(7));
  const items = groupScheduleRuns(runs);
  eq('a normal run in between splits the skips', shape(items), ['group(3)', 'srun_d4', 'group(2)', 'srun_d0']);
  eq('newer group waits on the run right below it', groupAt(items, 0).blocker?.run_id, 'srun_d4');
  eq('older group waits on its own earlier run', groupAt(items, 1).blocker?.run_id, 'srun_d0');
  ck('only the top group is newest', groupAt(items, 0).newest && !groupAt(items, 1).newest);
}

// ── 单独一条跳过:原样一行 ───────────────────────────────────────────
{
  const items = groupScheduleRuns(desc(sent(0), skip(1), sent(2)));
  eq('a single skip stays its own ordinary row', shape(items), ['srun_d2', 'srun_s1', 'srun_d0']);
  ck('no group at all', items.every(i => i.kind === 'run'));
}

// ── 不同跳过原因不合并 ───────────────────────────────────────────────
{
  const runs = desc(sent(0), skip(1), skip(2), skip(3, 'target_not_active'), skip(4, 'target_not_active'), skip(5), skip(6));
  const items = groupScheduleRuns(runs);
  eq('other skip reasons are never merged and they split the wait-skips', shape(items), ['group(2)', 'srun_s4', 'srun_s3', 'group(2)', 'srun_d0']);
  eq('blocker search skips over other-reason skips', groupAt(items, 0).blocker?.run_id, 'srun_d0');
  const failedNoTask: HubScheduledRun = { ...sent(0), run_id: 'srun_f', task_id: null, status: 'failed', error_code: 'target_node_not_found' };
  eq('a dispatch failure without a task is not what the Hub waits on', groupAt(groupScheduleRuns(desc(failedNoTask, skip(1), skip(2)))).blocker, null);
  eq('normal list passes through unchanged', shape(groupScheduleRuns(desc(sent(0), sent(1), sent(2)))), ['srun_d2', 'srun_d1', 'srun_d0']);
  eq('empty list', groupScheduleRuns([]), []);
}

// ── 等待时长 ─────────────────────────────────────────────────────────
{
  const MIN = 60_000;
  const now = Date.parse(iso(60));
  // 还在等:最新一组,被等的那次(08:00 派发)没有完成时刻 → now − 派发
  const live = groupAt(groupScheduleRuns(desc(sent(0), ...[14, 15, 16].map(m => skip(m)))));
  eq('ongoing wait = now − blocker dispatched', skipGroupWait(live, now), { ongoing: true, waitedMs: 60 * MIN });
  // 已结束:被等的那次有 completed_at → completed − 派发(与 now 无关)
  const done = groupAt(groupScheduleRuns(desc(sent(0, { status: 'replied', completed_at: at(36) }), ...[14, 15, 16].map(m => skip(m)))));
  eq('finished wait = blocker completed − dispatched', skipGroupWait(done, now), { ongoing: false, waitedMs: 36 * MIN });
  // 被更新的记录打断、那次又没完成时刻 → 至少等到这串最后一次跳过
  const cut = groupAt(groupScheduleRuns(desc(sent(0), skip(20), skip(21), sent(40))));
  eq('interrupted group: wait up to its last skip', skipGroupWait(cut, now), { ongoing: false, waitedMs: 21 * MIN });
  // 时间倒挂 / 解析不了 → null,不编数
  const bad = groupAt(groupScheduleRuns(desc(sent(30, { completed_at: at(10) }), skip(31), skip(32))));
  eq('completed before dispatched → no number', skipGroupWait({ ...bad, newest: false }, now).waitedMs, null);
  const off = groupAt(groupScheduleRuns(desc(skip(1), skip(2))));
  eq('blocker off the page → no number', skipGroupWait(off, now), { ongoing: true, waitedMs: null });

  setLanguagePreference('zh');
  eq('under a minute', formatWait(59_000), '不到 1 分钟');
  eq('minutes', formatWait(36 * MIN), '36 分钟');
  eq('hours', formatWait(120 * MIN), '2 小时');
  eq('hours + minutes', formatWait(125 * MIN), '2 小时 5 分钟');
  eq('59 min stays minutes, 60 min switches to hours', [formatWait(59 * MIN), formatWait(61 * MIN)], ['59 分钟', '1 小时 1 分钟']);
  eq('days + hours', formatWait((49 * 60 + 10) * MIN), '2 天 1 小时');

  const text = skipGroupText(live, '通信狗', now);
  eq('zh summary: count and range', text.summary, `已跳过 3 次（${clockOf(iso(14))}–${clockOf(iso(16))}）`);
  eq('zh wait is its own unbreakable piece', [text.who, text.wait], [`在等 通信狗 回复 ${clockOf(iso(0))} 那次`, '已等 1 小时']);
  eq('zh detail: who, which run, how long', text.detail, `在等 通信狗 回复 ${clockOf(iso(0))} 那次，已等 1 小时`);
  eq('zh detail when it already finished', skipGroupText(done, '通信狗', now).detail, `当时在等 通信狗 回复 ${clockOf(iso(0))} 那次，等了 36 分钟`);
  eq('zh detail when the run is off the page', skipGroupText(off, '通信狗', now).detail, '在等 通信狗 回复更早的一次（不在最近这页记录里）');
  setLanguagePreference('en');
  eq('en summary', skipGroupText(live, 'dog', now).summary, `Skipped 3 times (${clockOf(iso(14))}–${clockOf(iso(16))})`);
  eq('en detail', skipGroupText(live, 'dog', now).detail, `Waiting for dog to answer the ${clockOf(iso(0))} run · 1 h so far`);
  setLanguagePreference('system');
}

// ── 展开后的逐次时间:每换一天才带日期 ─────────────────────────────────
{
  const dateOf = (raw: string) => `D(${clockOf(raw)})`;
  const sameDay = skipGroupTimes([skip(12), skip(11), skip(10)], dateOf);
  eq('one day: date once, then bare clocks', sameDay, [`D(${clockOf(iso(12))})`, clockOf(iso(11)), clockOf(iso(10))]);
  const justAfterMidnight = new Date(2026, 8, 29, 0, 1).getTime(); // 本地 00:01 —— 往前两分钟就跨到前一天
  const local = (t: number): HubScheduledRun => ({ ...skip(0), scheduled_for: new Date(t).toISOString() });
  const overnight = skipGroupTimes([local(justAfterMidnight), local(justAfterMidnight - 60_000), local(justAfterMidnight - 120_000)], dateOf);
  eq('overnight: the new day gets its date again', overnight.map(x => x.startsWith('D(')), [true, false, true]);
}

// ── 屏幕接线:执行记录走分组,折叠行复用普通行的几何样式 ───────────────
{
  const src = readFileSync(new URL('./ScheduledTasksScreen.tsx', import.meta.url), 'utf8');
  ck('screen renders the grouped list', /groupScheduleRuns\(runs\.runs\)/.test(src));
  const groupRow = src.slice(src.indexOf('schedule-skip-group-'), src.indexOf('schedule-skip-group-toggle-'));
  ck('collapsed row reuses runRow/runHead (same padding as normal rows)', groupRow.includes('s.runRow') && src.includes('style={s.runHead}'));
  ck('wait clause renders in its own one-line, non-shrinking Text', /numberOfLines=\{1\} testID=\{`schedule-skip-group-wait-/.test(src) && /skipWait: \{ flexShrink: 0 \}/.test(src));
  ck('collapsed row links to the waited-on run', /onToggleRun\(blocker\)/.test(src));
}

console.log(`schedule-run-groups: ${passed} passed`);
