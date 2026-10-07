// 卡片 / 列表行上的到期提示(#491 / #493):「今天到期」「明天到期」「已逾期 N 天」,以及「已逾期」快捷筛选的判据。
// 纯逻辑(不 import react-native),due-marker.test.ts 直接引;task-board-model.ts 的 dueInfo 和筛选都走这里,
// 所以红色的「已逾期」胶囊和「已逾期」筛选出来的卡永远是同一批。
//
// 日期按查看者本地时区的日历日算:
//   全天 'YYYY-MM-DD'  —— 就是那一天(不经过 Date.parse:new Date('2026-10-01') 是 UTC 零点,
//                       在 UTC 以西会变成前一天 —— 那正是要避开的错)。当天结束前都不算逾期。
//   时刻 '…Z'          —— 换成本地时刻再取日期;逾期按真实时刻(过了就算),不足一天显示小时 / 分钟。
// 已完成、已归档的卡不提示,也不算逾期(做完 / 收起了就不再催)。
import { dueInstant, dueToLocal, isDateOnly, isDateTime, localDateOf, systemClock, type Clock } from './due-time';

export type DueMarkerKind = 'none' | 'today' | 'tomorrow' | 'overdue';
export type OverdueUnit = 'day' | 'hour' | 'minute';

export interface DueMarker {
  kind: DueMarkerKind;
  /** 逾期多少(只在 kind = overdue 时有意义)。 */
  n: number;
  unit: OverdueUnit;
}

export interface DueSubject {
  due: string;
  column: string;
  archived?: boolean;
}

export interface DueAt {
  /** 现在(毫秒)。默认 Date.now()。 */
  now?: number;
  clock?: Clock;
  /** 本地的「今天」'YYYY-MM-DD'。默认由 now + clock 算。 */
  today?: string;
}

const NONE: DueMarker = { kind: 'none', n: 0, unit: 'day' };

/** 'YYYY-MM-DD' → 日序号(只做日历差,不涉及时区)。 */
const dayNumber = (ymd: string): number => {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};

/** 这个期限落在本地哪一天('YYYY-MM-DD');空或不合法 = null。 */
export function dueLocalDate(due: string, clock: Clock = systemClock): string | null {
  if (!due) return null;
  if (isDateOnly(due)) return due;
  if (!isDateTime(due)) return null;
  return dueToLocal(due, clock)?.date ?? null;
}

/** 期限所在本地日 − 今天(天)。今天 = 0,明天 = 1,昨天 = −1;空或不合法 = null。 */
export function dueDayDiff(due: string, today: string, clock: Clock = systemClock): number | null {
  const d = dueLocalDate(due, clock);
  return d === null ? null : dayNumber(d) - dayNumber(today);
}

/** 不算逾期 / 不提示的卡:已完成、已归档。 */
export const dueSettled = (item: Pick<DueSubject, 'column' | 'archived'>): boolean => item.column === 'done' || item.column === 'abandoned' || item.archived === true;

export function dueMarker(item: DueSubject, at: DueAt = {}): DueMarker {
  const clock = at.clock ?? systemClock;
  const now = at.now ?? Date.now();
  const today = at.today ?? localDateOf(now, clock);
  if (dueSettled(item)) return NONE;
  const diff = dueDayDiff(item.due, today, clock);
  if (diff === null) return NONE;
  if (isDateOnly(item.due)) {
    if (diff < 0) return { kind: 'overdue', n: -diff, unit: 'day' };
  } else {
    const late = now - (dueInstant(item.due, clock) as number);
    if (late > 0) {
      const mins = Math.floor(late / 60_000);
      return mins >= 1440 ? { kind: 'overdue', n: Math.floor(mins / 1440), unit: 'day' }
        : mins >= 60 ? { kind: 'overdue', n: Math.floor(mins / 60), unit: 'hour' }
          : { kind: 'overdue', n: Math.max(1, mins), unit: 'minute' };
    }
  }
  if (diff === 0) return { kind: 'today', n: 0, unit: 'day' };
  if (diff === 1) return { kind: 'tomorrow', n: 0, unit: 'day' };
  return NONE;
}

/** 「已逾期」快捷筛选的判据(与红色胶囊同源)。 */
export const isOverdue = (item: DueSubject, at: DueAt = {}): boolean => dueMarker(item, at).kind === 'overdue';

/**
 * 中文文字(界面经 i18n-task-presentation 的 dueText 换成英文)。
 * hm:带时刻的期限在今天 / 明天时附上本地时刻 ——「今天 18:30 到期」。
 */
export function dueMarkerLabel(m: DueMarker, hm = ''): string {
  switch (m.kind) {
    case 'overdue': return `已逾期 ${m.n} ${m.unit === 'day' ? '天' : m.unit === 'hour' ? '小时' : '分钟'}`;
    case 'today': return hm ? `今天 ${hm} 到期` : '今天到期';
    case 'tomorrow': return hm ? `明天 ${hm} 到期` : '明天到期';
    default: return '';
  }
}
