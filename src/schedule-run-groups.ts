// 定时任务「执行记录」:把连续的「上一次还没结束,这次跳过」折叠成一行(纯函数,schedule-run-groups.test.ts 直接测)。
//
// 一个每分钟跑的计划,只要节点有一次没回复,Hub 之后每个 tick 都写一条 skipped 行 —— 页面上就是
// 几十条一模一样的「上一次还没结束,这次跳过(previous_run_active) 已跳过」,看不出在等谁、等了多久。
//
// Hub(agent-network server/src/scheduled-tasks.ts, origin/main)那边的事实:
//   - overlap_policy='skip' 时,dispatchScheduledOccurrence 查「本计划最近一条任务还在
//     OPEN_TASK_STATUSES 里的 run」,有就把本次 run 标 status='skipped'、error_code='previous_run_active'。
//   - 🔴 被挡住的那条 run 的 task_id 并不写进 skipped 行:skipped 行的 task_id 为 NULL、error_message 为 NULL。
//     GET /api/scheduled-tasks/<id>/runs 只回 run_id/scheduled_for/task_id/status/error_code/
//     error_message/created_at/completed_at,按 created_at DESC,默认 50 条。
//   所以「在等哪一次」只能从列表里推:这一串跳过之前(列表里更靠后)最近一条真派出去了(有 task_id)
//   且不是 skipped 的 run。它可能已经不在这一页里了(跳过超过一页),那时就说「更早的一次」,不瞎猜。

import type { HubScheduledRun } from './api';
import { registerTranslations, t } from './i18n';
import { parseHubTime } from './time';

export const SKIP_GROUP_CODE = 'previous_run_active';

export type RunListItem =
  | { kind: 'run'; run: HubScheduledRun }
  | {
      kind: 'skipGroup';
      /** 最新那条跳过的 run_id 前缀一个标记 —— 展开状态用它,新 tick 进来 key 会变。 */
      key: string;
      /** 与接口顺序一致:新的在前。 */
      runs: HubScheduledRun[];
      /** 推出来的「在等的那一次」;不在这一页里为 null。 */
      blocker: HubScheduledRun | null;
      /** 这一串是整个列表最新的几条 —— 只有这时「还在等」才可能成立。 */
      newest: boolean;
    };

const isWaitSkip = (run: HubScheduledRun): boolean =>
  run.status === 'skipped' && run.error_code === SKIP_GROUP_CODE;

/**
 * runs 按接口顺序(created_at 新 → 旧)。连续 ≥2 条 previous_run_active 跳过折成一组;
 * 其它状态、其它跳过原因、单独一条跳过都原样一行 —— 与改动前逐条渲染的顺序完全相同。
 */
export function groupScheduleRuns(runs: readonly HubScheduledRun[]): RunListItem[] {
  const out: RunListItem[] = [];
  let i = 0;
  while (i < runs.length) {
    if (!isWaitSkip(runs[i])) { out.push({ kind: 'run', run: runs[i] }); i++; continue; }
    let j = i;
    while (j < runs.length && isWaitSkip(runs[j])) j++;
    const slice = runs.slice(i, j);
    if (slice.length === 1) out.push({ kind: 'run', run: slice[0] });
    else {
      const blocker = runs.slice(j).find(r => !!r.task_id && r.status !== 'skipped') ?? null;
      out.push({ kind: 'skipGroup', key: `skipgroup:${slice[0].run_id}`, runs: slice, blocker, newest: i === 0 });
    }
    i = j;
  }
  return out;
}

const ms = (raw?: string | null): number | null => parseHubTime(raw ?? undefined)?.getTime() ?? null;

export interface SkipWait {
  /** 还在等:这串跳过是列表最新的,而且被等的那次还没有完成时刻。 */
  ongoing: boolean;
  /** 从被等的那次派发(created_at)算起;推不出来为 null。 */
  waitedMs: number | null;
}

/**
 * 等了多久。起点 = 被等那次的派发时刻(created_at,与 runDurationMs 同一口径)。终点:
 *   - 那次已经有 completed_at → 就是它(等待已结束);
 *   - 否则这串是最新的 → now(还在等);
 *   - 否则 → 这串里最后一次跳过的时刻(之后被别的记录打断了,只能说「至少等了这么久」)。
 */
export function skipGroupWait(group: Extract<RunListItem, { kind: 'skipGroup' }>, nowMs: number): SkipWait {
  const blocker = group.blocker;
  const ongoing = group.newest && !blocker?.completed_at;
  const start = ms(blocker?.created_at);
  const end = blocker?.completed_at ? ms(blocker.completed_at) : ongoing ? nowMs : ms(group.runs[0].created_at);
  if (start === null || end === null || end < start) return { ongoing, waitedMs: null };
  return { ongoing, waitedMs: end - start };
}

registerTranslations({
  'schedule.skipGroup.status': ['已跳过', 'Skipped'],
  'schedule.skipGroup.summary': ['已跳过 {n} 次（{from}–{to}）', 'Skipped {n} times ({from}–{to})'],
  // 「在等谁」和「等了多久」分成两段:屏幕把等待时长单独放一个不换行的 Text,窄屏整段挪到下一行,
  // 不会把「分钟」拆成「分」/「钟」。
  'schedule.skipGroup.waitingWho': ['在等 {alias} 回复 {at} 那次', 'Waiting for {alias} to answer the {at} run'],
  'schedule.skipGroup.waitedWho': ['当时在等 {alias} 回复 {at} 那次', 'Was waiting for {alias} to answer the {at} run'],
  'schedule.skipGroup.waitingFor': ['已等 {wait}', '{wait} so far'],
  'schedule.skipGroup.waitedFor': ['等了 {wait}', 'waited {wait}'],
  'schedule.skipGroup.sep': ['，', ' · '],
  'schedule.skipGroup.earlier': ['在等 {alias} 回复更早的一次（不在最近这页记录里）', 'Waiting for {alias} to answer an earlier run (not on this page)'],
  'schedule.skipGroup.why': ['上一次还没结束，这几次都跳过了', 'The previous run had not finished, so these were skipped'],
  'schedule.skipGroup.times': ['跳过的时间', 'Skipped at'],
  'schedule.skipGroup.open': ['查看 {at} 那次', 'View the {at} run'],
  'schedule.skipGroup.a11y': ['{summary}，{detail}', '{summary}, {detail}'],
  'schedule.wait.underMinute': ['不到 1 分钟', 'under a minute'],
  'schedule.wait.minutes': ['{m} 分钟', '{m} min'],
  'schedule.wait.hours': ['{h} 小时', '{h} h'],
  'schedule.wait.hoursMinutes': ['{h} 小时 {m} 分钟', '{h} h {m} min'],
  'schedule.wait.days': ['{d} 天', '{d} d'],
  'schedule.wait.daysHours': ['{d} 天 {h} 小时', '{d} d {h} h'],
});

export function formatWait(msValue: number): string {
  const m = Math.floor(msValue / 60000);
  if (m < 1) return t('schedule.wait.underMinute');
  if (m < 60) return t('schedule.wait.minutes', { m });
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? t('schedule.wait.hoursMinutes', { h, m: m % 60 }) : t('schedule.wait.hours', { h });
  const d = Math.floor(h / 24);
  return h % 24 ? t('schedule.wait.daysHours', { d, h: h % 24 }) : t('schedule.wait.days', { d });
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 设备本地「HH:MM」;跨天/非今天由调用方决定要不要带日期。解析不了原样返回。 */
export function clockOf(raw?: string | null): string {
  const d = parseHubTime(raw ?? undefined);
  return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : (raw ?? '');
}

/**
 * 展开后的逐次时间:时刻用「HH:MM」挤在一段里(一分钟一次的计划能有几十条,一行一条太长),
 * 只在每换一天的第一条前带上日期 —— 跨夜的一串也不会把日子搞混。输入新 → 旧,输出同序。
 */
export function skipGroupTimes(runs: readonly Pick<HubScheduledRun, 'scheduled_for'>[], dateOf: (raw: string) => string): string[] {
  let lastDay = '';
  return runs.map(r => {
    const d = parseHubTime(r.scheduled_for);
    if (!d) return r.scheduled_for;
    const day = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const clock = clockOf(r.scheduled_for);
    if (day === lastDay) return clock;
    lastDay = day;
    return dateOf(r.scheduled_for) || clock;
  });
}

export interface SkipGroupText {
  summary: string;
  /** 「在等谁、哪一次」。 */
  who: string;
  /** 「已等 36 分钟」;推不出时长为 ''。屏幕把它当一个不可拆的整体渲染。 */
  wait: string;
  /** who + 分隔 + wait,读屏和测试用。 */
  detail: string;
  /** 被等那次的时刻(与它自己那行显示的 scheduled_for 一致),没有为 ''。 */
  blockerAt: string;
}

/** 折叠行的文案。alias 是计划的执行节点(skipped 行本身不带节点)。 */
export function skipGroupText(group: Extract<RunListItem, { kind: 'skipGroup' }>, alias: string, nowMs: number): SkipGroupText {
  const oldest = group.runs[group.runs.length - 1];
  const latest = group.runs[0];
  const summary = t('schedule.skipGroup.summary', { n: group.runs.length, from: clockOf(oldest.scheduled_for), to: clockOf(latest.scheduled_for) });
  if (!group.blocker) {
    const who = t('schedule.skipGroup.earlier', { alias });
    return { summary, who, wait: '', detail: who, blockerAt: '' };
  }
  const at = clockOf(group.blocker.scheduled_for);
  const { ongoing, waitedMs } = skipGroupWait(group, nowMs);
  const who = t(ongoing ? 'schedule.skipGroup.waitingWho' : 'schedule.skipGroup.waitedWho', { alias, at });
  const wait = waitedMs === null ? '' : t(ongoing ? 'schedule.skipGroup.waitingFor' : 'schedule.skipGroup.waitedFor', { wait: formatWait(waitedMs) });
  const detail = wait ? `${who}${t('schedule.skipGroup.sep')}${wait}` : who;
  return { summary, who, wait, detail, blockerAt: at };
}
