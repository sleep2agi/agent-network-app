// 预计完成(due)的两种形状,纯逻辑(不 import react-native,due-time.test.ts 直接引):
//   'YYYY-MM-DD'            全天:查看者本地时区那一天结束(23:59:59)前都不算逾期
//   'YYYY-MM-DDTHH:MM:SSZ'  精确到秒的时刻,Hub 存成 UTC(#2076);界面按查看者本地时区显示
// 时区换算都经过 Clock:默认用系统时区,测试注入固定偏移,结果不随跑测试的机器变。
export interface LocalParts { y: number; m: number; d: number; hh: number; mm: number; ss: number }
export interface Clock {
  toLocal(ms: number): LocalParts;
  fromLocal(p: LocalParts): number;
}

export const systemClock: Clock = {
  toLocal(ms) {
    const t = new Date(ms);
    return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate(), hh: t.getHours(), mm: t.getMinutes(), ss: t.getSeconds() };
  },
  fromLocal(p) {
    return new Date(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss).getTime();
  },
};

/** 固定偏移的时钟(分钟,东八区 = 480)。测试用,也可以给「按某个时区显示」用。 */
export function fixedOffsetClock(offsetMinutes: number): Clock {
  const off = offsetMinutes * 60_000;
  return {
    toLocal(ms) {
      const t = new Date(ms + off);
      return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), hh: t.getUTCHours(), mm: t.getUTCMinutes(), ss: t.getUTCSeconds() };
    },
    fromLocal(p) {
      return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss) - off;
    },
  };
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function realDate(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export const isDateOnly = (due: string): boolean => {
  const m = DATE_ONLY.exec(due);
  return !!m && realDate(+m[1], +m[2], +m[3]);
};

export const isDateTime = (due: string): boolean => {
  const m = DATETIME.exec(due);
  return !!m && realDate(+m[1], +m[2], +m[3]) && +m[4] < 24 && +m[5] < 60 && +(m[6] ?? 0) < 60 && Number.isFinite(Date.parse(due));
};

/** 空、全天、带时区的时刻都合法。 */
export const dueValid = (due: string): boolean => !due || isDateOnly(due) || isDateTime(due);

/** 统一成 Hub 存的样子:时刻 → UTC 到秒;全天原样。不合法返回 null。 */
export function normalizeDue(due: string): string | null {
  const v = due.trim();
  if (!v) return '';
  if (isDateOnly(v)) return v;
  if (!isDateTime(v)) return null;
  return new Date(Math.floor(Date.parse(v) / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** 逾期 / 排序用的时刻(毫秒):全天 = 本地那天 23:59:59;时刻 = 本身。空或不合法 = null。 */
export function dueInstant(due: string, clock: Clock = systemClock): number | null {
  if (!due) return null;
  const m = DATE_ONLY.exec(due);
  if (m && realDate(+m[1], +m[2], +m[3])) return clock.fromLocal({ y: +m[1], m: +m[2], d: +m[3], hh: 23, mm: 59, ss: 59 });
  return isDateTime(due) ? Date.parse(due) : null;
}

/** 本地日期 'YYYY-MM-DD' + 可选时刻 → 要存的 due。allDay 时只存日期。 */
export function dueFromLocal(date: string, time: { hh: number; mm: number; ss: number } | null, clock: Clock = systemClock): string {
  if (!time) return date;
  const [y, m, d] = date.split('-').map(Number);
  const ms = clock.fromLocal({ y, m, d, hh: time.hh, mm: time.mm, ss: time.ss });
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** due → 本地的日期和(如果有)时刻,给选择器回填。 */
export function dueToLocal(due: string, clock: Clock = systemClock): { date: string; time: { hh: number; mm: number; ss: number } | null } | null {
  if (!due) return null;
  if (isDateOnly(due)) return { date: due, time: null };
  if (!isDateTime(due)) return null;
  const p = clock.toLocal(Date.parse(due));
  return { date: `${p.y}-${pad(p.m)}-${pad(p.d)}`, time: { hh: p.hh, mm: p.mm, ss: p.ss } };
}

export const localDateOf = (ms: number, clock: Clock = systemClock): string => {
  const p = clock.toLocal(ms);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
};

export const formatTime = (t: { hh: number; mm: number; ss?: number }, seconds = false): string =>
  seconds ? `${pad(t.hh)}:${pad(t.mm)}:${pad(t.ss ?? 0)}` : `${pad(t.hh)}:${pad(t.mm)}`;

/** 详情里的完整显示:'2026-10-01 18:30:45'(本地)或 '2026-10-01 全天'。 */
export function formatDueFull(due: string, clock: Clock = systemClock): string {
  const l = dueToLocal(due, clock);
  if (!l) return '';
  return l.time ? `${l.date} ${formatTime(l.time, true)}` : `${l.date} 全天`;
}

/** 解析 'HH:MM:SS' / 'HH:MM';越界或乱写返回 null。 */
export function parseTime(text: string): { hh: number; mm: number; ss: number } | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim());
  if (!m) return null;
  const t = { hh: +m[1], mm: +m[2], ss: +(m[3] ?? 0) };
  return t.hh < 24 && t.mm < 60 && t.ss < 60 ? t : null;
}

// ── 月历 ─────────────────────────────────────────────────────────────────

/** 一个月的格子:周一开头,6 行 × 7 列,前后用上 / 下个月的日子补齐。 */
export function monthGrid(year: number, month: number): { date: string; inMonth: boolean }[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // 周一 = 0
  const out: { date: string; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const t = new Date(Date.UTC(year, month - 1, 1 - lead + i));
    out.push({ date: `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`, inMonth: t.getUTCMonth() === month - 1 });
  }
  return out;
}

export const addDays = (date: string, days: number): string => {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};

export const shiftMonth = (y: number, m: number, delta: number): { y: number; m: number } => {
  const t = new Date(Date.UTC(y, m - 1 + delta, 1));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1 };
};

/** 月历里的键盘:←→ 一天、↑↓ 一周、PageUp/Down 一个月。返回新的聚焦日期,不认识的键返回 null。 */
export function calendarKey(date: string, key: string): string | null {
  switch (key) {
    case 'ArrowLeft': return addDays(date, -1);
    case 'ArrowRight': return addDays(date, 1);
    case 'ArrowUp': return addDays(date, -7);
    case 'ArrowDown': return addDays(date, 7);
    case 'PageUp': case 'PageDown': {
      const [y, m, d] = date.split('-').map(Number);
      const n = shiftMonth(y, m, key === 'PageUp' ? -1 : 1);
      const last = new Date(Date.UTC(n.y, n.m, 0)).getUTCDate();
      return `${n.y}-${pad(n.m)}-${pad(Math.min(d, last))}`;
    }
    default: return null;
  }
}

/** 期限的快捷项:今天 / 明天 / 下周一(都是全天)。today 是本地日期。 */
export function dueShortcuts(today: string): { key: string; label: string; value: string }[] {
  const [y, m, d] = today.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const toMonday = ((8 - weekday) % 7) || 7;
  return [
    { key: 'today', label: '今天', value: today },
    { key: 'tomorrow', label: '明天', value: addDays(today, 1) },
    { key: 'nextweek', label: '下周一', value: addDays(today, toMonday) },
  ];
}
