// 日历视图(任务页第四个视图)的纯逻辑。不 import react-native —— task-calendar-model.test.ts 直接引。
//
// Owner 2026-09-30:「这里面再来个日历视图吧？就是任务里面再来个日历视图。」
// 任务按预计完成(due)落在那一天:全天的就是那天;带时刻的按查看者本地时区换算成哪一天,格子里写出本地时刻。
// 没有期限的不进日历,单独列在「未设期限」。周一开头(和期限选择器的月历 monthGrid 一致)。
import { isClosedColumn } from './requirement-columns';
import { addDays, dueToLocal, formatTime, monthGrid, shiftMonth, systemClock, type Clock } from './due-time';
import type { ReqPriority, Requirement } from './requirements-model';
import { dayDiff, shiftedDue } from './task-gantt-model';

export type CalendarMode = 'month' | 'week';

export interface CalendarEntry {
  item: Requirement;
  /** 本地日期 'YYYY-MM-DD'。 */
  date: string;
  /** 带时刻的期限:本地 'HH:MM';全天 = null。 */
  time: string | null;
}

/** 这张卡落在哪天、几点(本地);没有期限 = null。 */
export function calendarEntry(item: Requirement, clock: Clock = systemClock): CalendarEntry | null {
  const local = dueToLocal(item.due, clock);
  if (!local) return null;
  return { item, date: local.date, time: local.time ? formatTime(local.time) : null };
}

const PRIORITY_ORDER: Record<ReqPriority, number> = { high: 0, normal: 1, low: 2, lowest: 3 };

/**
 * 一天里的顺序:全天的在前(按优先级),再按时刻;同一时刻按优先级;完成的沉到最后。
 * 这样格子放不下时,被收进「+N」的是最不急的。
 */
export function byDayOrder(a: CalendarEntry, b: CalendarEntry): number {
  const doneA = isClosedColumn(a.item.column) ? 1 : 0, doneB = isClosedColumn(b.item.column) ? 1 : 0;
  if (doneA !== doneB) return doneA - doneB;
  if ((a.time === null) !== (b.time === null)) return a.time === null ? -1 : 1;
  if (a.time && b.time && a.time !== b.time) return a.time < b.time ? -1 : 1;
  return PRIORITY_ORDER[a.item.priority] - PRIORITY_ORDER[b.item.priority] || a.item.name.localeCompare(b.item.name, 'zh');
}

/** 按天分好、排好序;没有期限的单独给出(新建的在前)。 */
export function calendarBuckets(items: readonly Requirement[], clock: Clock = systemClock): { days: Map<string, CalendarEntry[]>; undated: Requirement[] } {
  const days = new Map<string, CalendarEntry[]>();
  const undated: Requirement[] = [];
  for (const item of items) {
    const e = calendarEntry(item, clock);
    if (!e) { undated.push(item); continue; }
    const list = days.get(e.date) ?? [];
    list.push(e);
    days.set(e.date, list);
  }
  for (const list of days.values()) list.sort(byDayOrder);
  undated.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return { days, undated };
}

/** 格子里显示几条、剩几条收进「+N」:放不下时留一行给「+N」。 */
export function cellOverflow(count: number, capacity: number): { shown: number; more: number } {
  const cap = Math.max(0, Math.floor(capacity));
  if (count <= cap) return { shown: count, more: 0 };
  const shown = Math.max(0, cap - 1);
  return { shown, more: count - shown };
}

/** 格子高 h 能放几行任务(扣掉日期那一行)。 */
export const cellCapacity = (cellHeight: number, headerHeight: number, rowHeight: number): number =>
  cellHeight > headerHeight && rowHeight > 0 ? Math.floor((cellHeight - headerHeight) / rowHeight) : 0;

const pad = (n: number) => String(n).padStart(2, '0');
export const mondayOfDate = (ymd: string): string => {
  const [y, m, d] = ymd.split('-').map(Number);
  return addDays(ymd, -((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7));
};

/** 要画的格子:月 = 6 行 × 7 列(前后用邻月补齐);周 = 锚点所在的那一周。 */
export function calendarCells(anchor: string, mode: CalendarMode): { date: string; inMonth: boolean }[] {
  if (mode === 'week') {
    const monday = mondayOfDate(anchor);
    const month = anchor.slice(0, 7);
    return Array.from({ length: 7 }, (_, i) => { const date = addDays(monday, i); return { date, inMonth: date.slice(0, 7) === month }; });
  }
  const [y, m] = anchor.split('-').map(Number);
  return monthGrid(y, m);
}

/** 上一页 / 下一页:月视图挪一个月(停在 1 日),周视图挪七天。 */
export function shiftAnchor(anchor: string, mode: CalendarMode, delta: number): string {
  if (mode === 'week') return addDays(anchor, delta * 7);
  const [y, m] = anchor.split('-').map(Number);
  const n = shiftMonth(y, m, delta);
  return `${n.y}-${pad(n.m)}-01`;
}

/** 手机上点了一天:这一天在别的月(格子前后补齐的那几天)就跟着翻过去。返回新的月锚点(当月 1 日)。 */
export const monthAnchorOf = (date: string): string => `${date.slice(0, 7)}-01`;

/** 手机月历格子下的小点:这天有没完成的任务 = 实心点;只有完成的 = 空心点;没有 = null。 */
export function dayDot(entries: readonly CalendarEntry[] | undefined): 'open' | 'done' | null {
  if (!entries?.length) return null;
  return entries.some(e => !isClosedColumn(e.item.column)) ? 'open' : 'done';
}

/** 手机横滑翻月:横向位移超过阈值、且比竖向位移明显(不是在竖着滚列表)才算。返回 -1 / 1 / 0。 */
export function swipeDelta(dx: number, dy: number, threshold = 50): number {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 0;
  if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}

/** 逾期:那天已经过了且没完成(时刻型的当天按天算,和甘特图一致)。 */
export const entryOverdue = (e: CalendarEntry, today: string): boolean => e.date < today && !isClosedColumn(e.item.column);

// ── 拖到另一天改期限(桌面,STEP 2) ──

/**
 * 拖到 target 那天后要存的期限:全天的还是全天;带时刻的保留查看者本地的时刻,只换日期(和甘特图拖动同一个 shiftedDue)。
 * 放回原来那天 / 没有目标 / 读不懂 = null(不发请求)。
 */
export function dropDue(entry: CalendarEntry, target: string | null, clock: Clock = systemClock): string | null {
  if (!target || target === entry.date) return null;
  return shiftedDue(entry.item.due, dayDiff(entry.date, target), clock);
}

/** 按下后挪了多远才算开始拖(之前的都是点击)。 */
export const DRAG_SLOP = 4;
export const dragStarted = (dx: number, dy: number): boolean => Math.hypot(dx, dy) >= DRAG_SLOP;
