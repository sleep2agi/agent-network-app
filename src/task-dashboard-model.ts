// 任务「仪表盘」视图的数据(纯函数,无 React / 网络)。界面在 TaskDashboard.tsx,读 Hub 在 requirements-hub.ts。
//
// Owner 2026-09-30:「任务模块,需要加一个视图,就是仪表盘,总览那种,1 天内完成了多少个任务,这种很唬人的效果,
// 拿去发社交媒体」,加一条「最近完成的任务是什么」(时间线是主角)。
//
// 两个数据来源,同一个输出形状 DashData:
//   · Hub(capability stats,#2168):GET /api/requirements/stats —— 完成时刻是真的(completed_at),
//     含归档的卡、按调用者可见范围算好;只有升级前完成的卡是近似值(done_approx)。
//   · 本机(旧 Hub):从读回来的卡片算(fromItems)。卡片带 completedAt(capability completed_at)就用它;
//     没有就拿 updatedAt 当完成时刻 —— 那是「最后一次改」,完成后再改一下就往后挪,所以整页标「近似」。
// 「哪一天」一律按本机时区(Hub 路径把 tz 传给 Hub)。
import type { Requirement } from './requirements-model';
import type { RequirementPersonRef } from './requirement-people';

export type DashPeriod = 'today' | 'week' | 'month' | 'all';
export const DASH_PERIODS: readonly DashPeriod[] = ['today', 'week', 'month', 'all'];
/** 每日曲线读多少天:53 周,够一整年的热力图(Hub 上限同为 371)。 */
export const DASH_DAYS = 371;
export const DASH_SPARK_DAYS = 14;
export const DASH_RECENT = 20;

export interface DashCompletion {
  id: string;
  seq: number | null;
  name: string;
  projectId: string | null;
  /** 完成时刻(ms)。 */
  at: number;
  /** 这一条的完成时刻 / 完成者是估出来的(updatedAt / 最后改的人 / 负责人)。 */
  approx: boolean;
  by: RequirementPersonRef | null;
  archived: boolean;
}

export interface DashLeader { kind: 'user' | 'node'; id: string; n: number; spark: number[] }

export interface DashData {
  source: 'hub' | 'client';
  /** 页面上有没有近似值(界面据此显示「近似」说明)。 */
  approx: boolean;
  /** 本机路径读到的不是整张表(旧 Hub 一次最多 500 张,归档的也可能不全):数字只是下界。 */
  partial: boolean;
  todayDone: number;
  yesterdayDone: number;
  weekDone: number;
  lastWeekDone: number;
  doing: number;
  /** 期内新建的卡里已完成的比例;期内没有新建 → null。 */
  rate: number | null;
  rateCreated: number;
  rateDone: number;
  /** 期内完成数(按项目、完成榜、最近完成都只看这个期)。 */
  periodDone: number;
  daily: { date: string; n: number }[];
  byProject: { projectId: string | null; n: number }[];
  leaders: DashLeader[];
  recent: DashCompletion[];
}

// ── 日期(本机时区) ──

const pad = (n: number) => String(n).padStart(2, '0');
/** 本机时区里的 YYYY-MM-DD。 */
export const ymd = (ms: number): string => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const startOfDay = (ms: number): number => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
/** 本机时区的一天开始往前 / 往后挪 n 天(按日历,不按 24h —— 夏令时那天不是 24h)。 */
const addDays = (dayStart: number, n: number): number => { const d = new Date(dayStart); d.setDate(d.getDate() + n); return d.getTime(); };

/** 期的开始时刻(本机时区)。周一开头(与日历视图一致);全部 = null。 */
export function periodStart(period: DashPeriod, now: number): number | null {
  const today = startOfDay(now);
  if (period === 'today') return today;
  if (period === 'week') return addDays(today, -((new Date(today).getDay() + 6) % 7));
  if (period === 'month') { const d = new Date(today); d.setDate(1); return d.getTime(); }
  return null;
}

/** 以 now 那天结尾、往前 n 天的日期(旧 → 新)。 */
export function dayList(now: number, n: number): string[] {
  const today = startOfDay(now);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(ymd(addDays(today, -i)));
  return out;
}

/** 本机时区名(给 Hub 的 tz=)。拿不到就 UTC —— 那时 Hub 按 UTC 分天,和本机差几个小时,但不会错成别的日子以外的东西。 */
export function localTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

// ── 本机算(旧 Hub / 没有 stats) ──

const msOf = (v: string | null | undefined): number | null => {
  if (!v) return null;
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v) ? `${v.replace(' ', 'T')}Z` : v);
  return Number.isFinite(ms) ? ms : null;
};

/** 一张完成的卡什么时候完成、谁完成的。不在「完成」列 → null。 */
export function completionOf(item: Requirement): DashCompletion | null {
  if (item.column !== 'done') return null;
  const real = msOf(item.completedAt);
  const at = real ?? msOf(item.updatedAt) ?? msOf(item.createdAt);
  if (at === null) return null;
  const exact = real !== null && !item.completedAtApprox;
  // 完成者:Hub 记的 → 最后改的人(完成后没再改过时就是移进完成的人)→ 负责 Agent → 负责人。
  const by = item.completedBy ?? (real !== null && item.completedAtApprox ? null : item.updatedBy ?? item.agentOwner ?? item.owner ?? null);
  return {
    id: item.id, seq: item.seq ?? null, name: item.name, projectId: item.projectId ?? null, at,
    approx: !exact || (!item.completedBy && !!by), by: by ? { kind: by.kind, id: by.id } : null, archived: !!item.archived,
  };
}

export function fromItems(items: readonly Requirement[], period: DashPeriod, now: number, partial = false): DashData {
  const days = dayList(now, DASH_DAYS);
  const first = days[0];
  const daily = new Map(days.map(d => [d, 0]));
  const sparkDays = days.slice(-DASH_SPARK_DAYS);
  const start = periodStart(period, now);
  const inPeriod = (ms: number) => ms <= now && (start === null || ms >= start);
  const today = startOfDay(now);
  const yesterday = addDays(today, -1);
  const week = periodStart('week', now)!;
  const lastWeek = addDays(week, -7);
  let todayDone = 0, yesterdayDone = 0, weekDone = 0, lastWeekDone = 0, doing = 0, created = 0, createdDone = 0, approx = false;
  const byProject = new Map<string | null, number>();
  const leaders = new Map<string, DashLeader>();
  const recent: DashCompletion[] = [];
  for (const item of items) {
    if (item.column === 'doing' && !item.archived) doing++;
    const c = completionOf(item);
    const createdMs = msOf(item.createdAt);
    if (createdMs !== null && inPeriod(createdMs)) { created++; if (c) createdDone++; }
    if (!c || c.at > now) continue;
    const day = ymd(c.at);
    if (day >= first && daily.has(day)) daily.set(day, daily.get(day)! + 1);
    if (c.at >= today) todayDone++;
    else if (c.at >= yesterday) yesterdayDone++;
    if (c.at >= week) weekDone++;
    // 上周同期:上周一到「上周的今天此刻」,和本周已过去的时间等长。
    else if (c.at >= lastWeek && c.at <= now - 7 * 86_400_000) lastWeekDone++;
    if (!inPeriod(c.at)) continue;
    if (c.approx) approx = true;
    recent.push(c);
    byProject.set(c.projectId, (byProject.get(c.projectId) ?? 0) + 1);
    if (!c.by) continue;
    const key = `${c.by.kind}:${c.by.id}`;
    let l = leaders.get(key);
    if (!l) leaders.set(key, l = { kind: c.by.kind, id: c.by.id, n: 0, spark: sparkDays.map(() => 0) });
    l.n++;
    const i = sparkDays.indexOf(day);
    if (i >= 0) l.spark[i]++;
  }
  recent.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
  return {
    source: 'client', approx, partial,
    todayDone, yesterdayDone, weekDone, lastWeekDone, doing,
    rate: created ? createdDone / created : null, rateCreated: created, rateDone: createdDone,
    periodDone: recent.length,
    daily: days.map(date => ({ date, n: daily.get(date) ?? 0 })),
    byProject: sortProjects(byProject),
    leaders: [...leaders.values()].sort((a, b) => b.n - a.n || `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`)).slice(0, 20),
    recent: recent.slice(0, DASH_RECENT),
  };
}

const sortProjects = (m: Map<string | null, number>) => [...m].map(([projectId, n]) => ({ projectId, n })).sort((a, b) => b.n - a.n || String(a.projectId).localeCompare(String(b.projectId)));

// ── Hub(GET /api/requirements/stats) ──

export interface HubStats {
  totals: { done: number; done_approx: number; created: number; created_done: number; completion_rate: number | null; doing: number; pool: number };
  daily: { date: string; n: number }[];
  by_project: { project_id: string | null; n: number }[];
  by_completer: { kind: 'user' | 'node'; id: string; n: number; spark: number[] }[];
  unattributed: number;
  recent?: { id: string; seq: number | null; name: string; project_id: string | null; completed_at: string; completed_at_approx: boolean; completed_by: RequirementPersonRef | null; archived: boolean }[];
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
const refOf = (v: unknown): RequirementPersonRef | null => {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  return (r.kind === 'user' || r.kind === 'node') && typeof r.id === 'string' && r.id ? { kind: r.kind, id: r.id } : null;
};

/** Hub 的响应 → HubStats。形状不对 → null(调用方退回本机算)。 */
export function parseHubStats(raw: unknown): HubStats | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const t = r.totals as Record<string, unknown> | undefined;
  if (!t || typeof t !== 'object' || !Array.isArray(r.daily)) return null;
  return {
    totals: {
      done: num(t.done), done_approx: num(t.done_approx), created: num(t.created), created_done: num(t.created_done),
      completion_rate: typeof t.completion_rate === 'number' ? t.completion_rate : null, doing: num(t.doing), pool: num(t.pool),
    },
    daily: r.daily.filter((d: any) => d && typeof d.date === 'string').map((d: any) => ({ date: d.date as string, n: num(d.n) })),
    by_project: Array.isArray(r.by_project) ? r.by_project.map((p: any) => ({ project_id: typeof p?.project_id === 'string' ? p.project_id : null, n: num(p?.n) })) : [],
    by_completer: Array.isArray(r.by_completer)
      ? r.by_completer.flatMap((c: any) => { const ref = refOf(c); return ref ? [{ ...ref, n: num(c.n), spark: Array.isArray(c.spark) ? c.spark.map(num) : [] }] : []; })
      : [],
    unattributed: num(r.unattributed),
    recent: Array.isArray(r.recent)
      ? r.recent.filter((x: any) => x && typeof x.id === 'string' && typeof x.completed_at === 'string').map((x: any) => ({
        id: x.id, seq: typeof x.seq === 'number' ? x.seq : null, name: typeof x.name === 'string' ? x.name : '', project_id: typeof x.project_id === 'string' ? x.project_id : null,
        completed_at: x.completed_at, completed_at_approx: x.completed_at_approx === true, completed_by: refOf(x.completed_by), archived: x.archived === true,
      }))
      : undefined,
  };
}

/** Hub 统计 → DashData。今天 / 昨天 / 本周 / 上周同期从每日曲线里取(Hub 已按本机时区分好天)。 */
export function fromHubStats(stats: HubStats, now: number): DashData {
  const byDate = new Map(stats.daily.map(d => [d.date, d.n]));
  const sum = (from: number, toExclusive: number) => {
    let n = 0;
    for (let d = from; d < toExclusive; d = addDays(d, 1)) n += byDate.get(ymd(d)) ?? 0;
    return n;
  };
  const today = startOfDay(now);
  const week = periodStart('week', now)!;
  // 上周同期按整天算(Hub 只给到天):本周过了几天,上周就取前几天。
  const elapsed = Math.round((today - week) / 86_400_000) + 1;
  return {
    source: 'hub',
    approx: stats.totals.done_approx > 0,
    partial: false,
    todayDone: byDate.get(ymd(today)) ?? 0,
    yesterdayDone: byDate.get(ymd(addDays(today, -1))) ?? 0,
    weekDone: sum(week, addDays(today, 1)),
    lastWeekDone: sum(addDays(week, -7), addDays(week, -7 + elapsed)),
    doing: stats.totals.doing,
    rate: stats.totals.completion_rate,
    rateCreated: stats.totals.created,
    rateDone: stats.totals.created_done,
    periodDone: stats.totals.done,
    daily: stats.daily,
    byProject: stats.by_project.map(p => ({ projectId: p.project_id, n: p.n })),
    leaders: stats.by_completer,
    recent: (stats.recent ?? []).map(x => ({
      id: x.id, seq: x.seq, name: x.name, projectId: x.project_id, at: Date.parse(x.completed_at), approx: x.completed_at_approx,
      by: x.completed_by, archived: x.archived,
    })).filter(x => Number.isFinite(x.at)),
  };
}

// ── 派生:连续天数、最忙的一天、变化百分比、相对时间 ──

export function streaks(daily: readonly { date: string; n: number }[]): { current: number; longest: number } {
  let longest = 0, run = 0;
  for (const d of daily) { run = d.n > 0 ? run + 1 : 0; if (run > longest) longest = run; }
  // 当前连续:今天还没完成任何一张不算断(一天还没过完)—— 从昨天往前数。
  let current = 0;
  for (let i = daily.length - 1; i >= 0; i--) {
    if (daily[i].n > 0) current++;
    else if (i === daily.length - 1) continue;
    else break;
  }
  return { current, longest };
}

export function busiestDay(daily: readonly { date: string; n: number }[]): { date: string; n: number } | null {
  let best: { date: string; n: number } | null = null;
  for (const d of daily) if (d.n > 0 && (!best || d.n >= best.n)) best = d;
  return best;
}

/** 较上一期的变化(百分数,整数);上一期为 0 → null(不画「+∞%」)。 */
export function deltaPct(cur: number, prev: number): number | null {
  if (prev <= 0) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

/** Agent 完成占比(完成榜里节点的份额);没人上榜 → null。 */
export function agentShare(leaders: readonly DashLeader[]): number | null {
  const total = leaders.reduce((a, l) => a + l.n, 0);
  if (!total) return null;
  return leaders.filter(l => l.kind === 'node').reduce((a, l) => a + l.n, 0) / total;
}

/** 相对时间的键与参数(界面用 i18n 拼):刚刚 / N 分钟前 / N 小时前 / 昨天 / M月D日。 */
export function relativeTime(at: number, now: number): { key: 'now' | 'min' | 'hour' | 'yesterday' | 'date'; n?: number; m?: number; d?: number } {
  const diff = Math.max(0, now - at);
  if (diff < 60_000) return { key: 'now' };
  if (diff < 3_600_000) return { key: 'min', n: Math.floor(diff / 60_000) };
  if (at >= startOfDay(now)) return { key: 'hour', n: Math.floor(diff / 3_600_000) };
  if (at >= addDays(startOfDay(now), -1)) return { key: 'yesterday' };
  const d = new Date(at);
  return { key: 'date', m: d.getMonth() + 1, d: d.getDate() };
}

/** 热力图的格子:按周排(周一开头),最后一列到 now 那天为止。level 0–4。 */
export function heatCells(daily: readonly { date: string; n: number }[], weeks: number): { date: string; n: number; level: number; row: number; col: number }[] {
  if (!daily.length) return [];
  const lastDate = daily[daily.length - 1].date;
  const [y, m, d] = lastDate.split('-').map(Number);
  const lastRow = (new Date(y, m - 1, d).getDay() + 6) % 7;
  const count = (weeks - 1) * 7 + lastRow + 1;
  const tail = daily.slice(-count);
  const max = Math.max(1, ...tail.map(x => x.n));
  const offset = count - tail.length; // 数据不够 weeks 周时,前面空着
  return tail.map((x, i) => {
    const k = i + offset;
    const level = x.n === 0 ? 0 : Math.min(4, 1 + Math.floor((x.n / max) * 3.999));
    return { ...x, level, row: k % 7, col: Math.floor(k / 7) };
  });
}

/** 新出现的最近完成(上一轮没有的 id):时间线把它们滑进来。第一轮不算「新」。 */
export function newlyCompleted(prev: readonly string[] | null, next: readonly DashCompletion[]): string[] {
  if (prev === null) return [];
  const seen = new Set(prev);
  return next.filter(x => !seen.has(x.id)).map(x => x.id);
}
