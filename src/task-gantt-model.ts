// 甘特图(任务页第三个视图)的纯逻辑。不 import react-native —— task-gantt-model.test.ts 直接引。
//
// Owner 2026-09-30:「支持个甘特图显示，优先级 低」。时间条从开始画到预计完成(due),按项目或负责 Agent 分组,
// 竖线标今天。
//
// 开始时间:Hub 有可选的开始字段(capabilities 含 start_date)且这张卡设了,就用它;
// 否则(旧 Hub,或没设)退回创建时间(createdAt),界面上写明。
//
// 日期一律是查看者本地的 'YYYY-MM-DD';天数差用 UTC 日历算(不受夏令时影响)。
import { dueFromLocal, dueToLocal, localDateOf, normalizeDue, systemClock, type Clock } from './due-time';
import type { Requirement, RequirementProject } from './requirements-model';
import type { RequirementPersonRef } from './requirement-people';

export type GanttGroupBy = 'project' | 'agent';
export type GanttScale = 'day' | 'week';

/** 没设开始(或 Hub 没有开始字段)时,开始从哪里来(界面上照着它写说明)。 */
export const GANTT_START_SOURCE = 'createdAt' as const;

/** 每天多宽(px):日刻度能写下日期数字,周刻度一屏大约三个月。 */
export const GANTT_DAY_PX: Record<GanttScale, number> = { day: 32, week: 10 };
/** 最多往回画多少天:几个月前建的卡不把整张图拉成一条长尾,条从左边界「截断」开始。 */
export const GANTT_MAX_BACK_DAYS = 120;
/** 今天之后至少留多少天(没有很远的期限时右边也有地方看)。 */
export const GANTT_MIN_AHEAD_DAYS = 21;

export const NO_PROJECT_GROUP = '__no_project__';
export const NO_AGENT_GROUP = '__no_agent__';

// ── 日期运算 ──
const pad = (n: number) => String(n).padStart(2, '0');
const utc = (ymd: string): number => { const [y, m, d] = ymd.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const ymdOf = (ms: number): string => { const t = new Date(ms); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
export const dayDiff = (from: string, to: string): number => Math.round((utc(to) - utc(from)) / 86_400_000);
export const plusDays = (ymd: string, n: number): string => ymdOf(utc(ymd) + n * 86_400_000);
/** 0 = 周一 … 6 = 周日。 */
export const weekdayOf = (ymd: string): number => (new Date(utc(ymd)).getUTCDay() + 6) % 7;
export const mondayOf = (ymd: string): string => plusDays(ymd, -weekdayOf(ymd));

/** 开始(本地日期):设了开始就用它,否则取创建时间。都读不出来 = null。 */
export function ganttStart(item: Requirement, clock: Clock = systemClock): string | null {
  const own = item.start ? dueToLocal(item.start, clock)?.date : null;
  if (own) return own;
  const ms = Date.parse(item.createdAt || '');
  return Number.isFinite(ms) ? localDateOf(ms, clock) : null;
}

/** 结束 = 预计完成那天(本地);没有期限 = null。 */
export function ganttEnd(item: Requirement, clock: Clock = systemClock): string | null {
  return dueToLocal(item.due, clock)?.date ?? null;
}

export interface GanttBar {
  item: Requirement;
  start: string;
  end: string;
  /** 开始晚于期限(期限改到了创建之前)或没有创建时间:只画期限那一天。 */
  collapsed: boolean;
}

export function ganttBar(item: Requirement, clock: Clock = systemClock): GanttBar | null {
  const end = ganttEnd(item, clock);
  if (!end) return null;
  const start = ganttStart(item, clock);
  if (!start || start > end) return { item, start: end, end, collapsed: true };
  return { item, start, end, collapsed: false };
}

/** 负责 Agent:分两个角色的 Hub 上是 agentOwner;旧 Hub 上负责人是节点时就是它。 */
export function agentOf(item: Requirement): RequirementPersonRef | null {
  if (item.agentOwner) return item.agentOwner;
  return item.owner && item.owner.kind === 'node' ? item.owner : null;
}

export interface GanttGroup {
  key: string;
  kind: 'project' | 'agent' | 'none';
  /** kind=project 时的项目(已删除的项目 = undefined);kind=agent 时的节点。 */
  project?: RequirementProject;
  agent?: RequirementPersonRef;
  bars: GanttBar[];
}

const byTime = (a: GanttBar, b: GanttBar) =>
  (a.start < b.start ? -1 : a.start > b.start ? 1 : 0) || (a.end < b.end ? -1 : a.end > b.end ? 1 : 0) || a.item.name.localeCompare(b.item.name, 'zh');

/**
 * 有期限的卡按项目 / 负责 Agent 分组,组内按开始 → 结束 → 标题;没有期限的单独放进 undated(按创建时间新的在前)。
 * 项目组按项目自己的排序,「无项目」最后;Agent 组按名字(nameOf),「无负责 Agent」最后。
 */
export function ganttGroups(
  items: readonly Requirement[],
  opts: { groupBy: GanttGroupBy; projects: readonly RequirementProject[] | null; nameOf?: (ref: RequirementPersonRef) => string; clock?: Clock },
): { groups: GanttGroup[]; undated: Requirement[] } {
  const clock = opts.clock ?? systemClock;
  const groups = new Map<string, GanttGroup>();
  const undated: Requirement[] = [];
  const projectById = new Map((opts.projects ?? []).map(p => [p.id, p]));
  for (const item of items) {
    const bar = ganttBar(item, clock);
    if (!bar) { undated.push(item); continue; }
    let key: string; let group: Omit<GanttGroup, 'bars'>;
    if (opts.groupBy === 'project' && opts.projects) {
      const pid = item.projectId || null;
      key = pid ?? NO_PROJECT_GROUP;
      group = pid ? { key, kind: 'project', project: projectById.get(pid) } : { key, kind: 'none' };
    } else if (opts.groupBy === 'agent') {
      const ref = agentOf(item);
      key = ref ? `node:${ref.id}` : NO_AGENT_GROUP;
      group = ref ? { key, kind: 'agent', agent: ref } : { key, kind: 'none' };
    } else {
      // 旧 Hub 没有项目:按项目分组退化成一整组。
      key = NO_PROJECT_GROUP; group = { key, kind: 'none' };
    }
    const g = groups.get(key) ?? { ...group, bars: [] };
    g.bars.push(bar);
    groups.set(key, g);
  }
  const list = [...groups.values()];
  for (const g of list) g.bars.sort(byTime);
  const projectOrder = new Map((opts.projects ?? []).map((p, i) => [p.id, [p.sort, i] as const]));
  const name = (g: GanttGroup) => (g.agent ? (opts.nameOf?.(g.agent) ?? g.agent.id) : '');
  list.sort((a, b) => {
    if (a.kind === 'none' || b.kind === 'none') return a.kind === b.kind ? 0 : a.kind === 'none' ? 1 : -1;
    if (a.kind === 'project') {
      const pa = projectOrder.get(a.key), pb = projectOrder.get(b.key);
      if (!pa || !pb) return pa ? -1 : pb ? 1 : a.key.localeCompare(b.key);
      return pa[0] - pb[0] || pa[1] - pb[1];
    }
    return name(a).localeCompare(name(b), 'zh') || a.key.localeCompare(b.key);
  });
  undated.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return { groups: list, undated };
}

export interface GanttRange { start: string; days: number }

/**
 * 画多长:最早的开始(最多往回 GANTT_MAX_BACK_DAYS 天)到最晚的期限,包含今天,前后留白,
 * 对齐到整周(周一开始、周日结束)——周刻度的刻度线落在周一上。
 */
export function ganttRange(bars: readonly GanttBar[], today: string): GanttRange {
  let lo = plusDays(today, -7);
  let hi = plusDays(today, GANTT_MIN_AHEAD_DAYS);
  for (const b of bars) {
    if (b.start < lo) lo = b.start;
    if (b.end > hi) hi = b.end;
  }
  const floor = plusDays(today, -GANTT_MAX_BACK_DAYS);
  if (lo < floor) lo = floor;
  const start = mondayOf(plusDays(lo, -3));
  const end = plusDays(mondayOf(plusDays(hi, 7)), 6);
  return { start, days: dayDiff(start, end) + 1 };
}

/** 一条在时间轴上的位置(px)。开始早于左边界的从边界画起,clippedLeft 让界面画一个「更早」的缺口。 */
export function barGeometry(bar: GanttBar, range: GanttRange, dayPx: number): { x: number; w: number; clippedLeft: boolean } {
  const from = Math.max(0, dayDiff(range.start, bar.start));
  const to = Math.min(range.days - 1, dayDiff(range.start, bar.end));
  return { x: from * dayPx, w: Math.max(1, to - from + 1) * dayPx, clippedLeft: dayDiff(range.start, bar.start) < 0 };
}

/** 今天那一天的中线(px)。今天不在范围里 = null。 */
export function todayX(range: GanttRange, today: string, dayPx: number): number | null {
  const i = dayDiff(range.start, today);
  return i < 0 || i >= range.days ? null : i * dayPx + dayPx / 2;
}

export interface GanttTick { date: string; x: number; day: number; month: number; year: number; weekend: boolean; monthStart: boolean }

/** 日刻度:每天一格;周刻度:每个周一一格。第一格总是算作「月份开始」,好在最左边写上月份。 */
export function ganttTicks(range: GanttRange, scale: GanttScale): GanttTick[] {
  const px = GANTT_DAY_PX[scale];
  const out: GanttTick[] = [];
  for (let i = 0; i < range.days; i++) {
    const date = plusDays(range.start, i);
    const wd = weekdayOf(date);
    if (scale === 'week' && wd !== 0) continue;
    const [year, month, day] = date.split('-').map(Number);
    const monthStart = out.length === 0 || (scale === 'day' ? day === 1 : out[out.length - 1].month !== month);
    out.push({ date, x: i * px, day, month, year, weekend: wd >= 5, monthStart });
  }
  return out;
}

// ── 手机:按周分组的列表 ──

export interface GanttWeek {
  monday: string;
  /** 相对今天所在的周:0 = 本周,-1 = 上周,1 = 下周。 */
  offset: number;
  bars: GanttBar[];
}

/** 按期限所在的周分组,按时间先后。 */
export function ganttWeeks(items: readonly Requirement[], today: string, clock: Clock = systemClock): { weeks: GanttWeek[]; undated: Requirement[] } {
  const thisMonday = mondayOf(today);
  const weeks = new Map<string, GanttWeek>();
  const undated: Requirement[] = [];
  for (const item of items) {
    const bar = ganttBar(item, clock);
    if (!bar) { undated.push(item); continue; }
    const monday = mondayOf(bar.end);
    const w = weeks.get(monday) ?? { monday, offset: Math.round(dayDiff(thisMonday, monday) / 7), bars: [] };
    w.bars.push(bar);
    weeks.set(monday, w);
  }
  const list = [...weeks.values()].sort((a, b) => (a.monday < b.monday ? -1 : 1));
  for (const w of list) w.bars.sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : 0) || byTime(a, b));
  undated.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return { weeks: list, undated };
}

/** 那一周七天里,这条占了哪几天(手机行里的七格小条)。 */
export function weekStrip(bar: GanttBar, monday: string): boolean[] {
  return Array.from({ length: 7 }, (_, i) => { const d = plusDays(monday, i); return d >= bar.start && d <= bar.end; });
}

/** 列表打开时先滚到哪一周:本周或之后的第一组;都在过去就停在最后一组。 */
export function firstCurrentWeek(weeks: readonly GanttWeek[]): number {
  const i = weeks.findIndex(w => w.offset >= 0);
  return i >= 0 ? i : Math.max(0, weeks.length - 1);
}

/** 逾期:期限那天已经过了,而且还没完成。 */
export const barOverdue = (bar: GanttBar, today: string): boolean => bar.end < today && bar.item.column !== 'done';

// ── 拖动改期限(桌面) ──

/** 横向拖了 dx 像素 = 挪几天(四舍五入)。 */
export const dragDays = (dx: number, dayPx: number): number => (dayPx > 0 && Number.isFinite(dx) ? Math.round(dx / dayPx) : 0);

/** 拖右端:期限挪几天,但不早于开始那天(没有真实开始的「只画一天」的条不限)。 */
export function clampDragDays(bar: GanttBar, days: number): number {
  if (bar.collapsed) return days;
  return Math.max(days, -dayDiff(bar.start, bar.end));
}

/**
 * 期限挪 days 天之后要存的值:全天的还是全天;带时刻的保留查看者本地的时刻,只换日期
 * (输出和 Hub 的规范形状一致,保存后的核对 patchApplied 才对得上)。挪 0 天或读不懂 = null(不发请求)。
 */
export function shiftedDue(due: string, days: number, clock: Clock = systemClock): string | null {
  if (!days) return null;
  const local = dueToLocal(due, clock);
  if (!local) return null;
  const date = plusDays(local.date, days);
  return normalizeDue(dueFromLocal(date, local.time, clock));
}
