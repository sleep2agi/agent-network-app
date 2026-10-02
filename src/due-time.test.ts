// 预计完成的日期 / 时刻:时区换算、旧的全天值、逾期、月历。ck 风格自执行。
// 所有换算都走注入的固定偏移时钟(东八区 / 纽约夏令时),结果不随跑测试的机器时区变。
import {
  addDays, calendarKey, dueFromLocal, dueInstant, dueShortcuts, dueToLocal, dueValid, fixedOffsetClock, formatDueFull,
  isDateOnly, isDateTime, localDateOf, monthGrid, normalizeDue, parseTime, shiftMonth,
} from './due-time';
import { dueCmp, dueInfo } from './task-board-model';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}${extra ? ` (${extra})` : ''}`); };
const SH = fixedOffsetClock(480);   // 东八区
const NY = fixedOffsetClock(-240);  // 纽约夏令时

console.log('# 形状');
ck('全天合法、2 月 30 日不合法', isDateOnly('2026-10-01') && !isDateOnly('2026-02-30'));
ck('带时区的时刻合法;不带时区不合法', isDateTime('2026-10-01T10:30:45Z') && isDateTime('2026-10-01T18:30:45+08:00') && !isDateTime('2026-10-01T18:30:45'));
ck('越界的时分秒不合法', !isDateTime('2026-10-01T24:00:00Z') && !isDateTime('2026-10-01T10:60:00Z') && !isDateTime('2026-10-01T10:00:60Z'));
ck('空也合法(没有期限)', dueValid('') && !dueValid('明天'));
ck('规范化:+08:00 → UTC 到秒', normalizeDue('2026-10-01T18:30:45+08:00') === '2026-10-01T10:30:45Z');
ck('规范化:毫秒截掉、全天原样、乱写 null', normalizeDue('2026-10-01T10:30:45.987Z') === '2026-10-01T10:30:45Z' && normalizeDue('2026-10-01') === '2026-10-01' && normalizeDue('x') === null);

console.log('# 时区往返');
{
  const due = dueFromLocal('2026-10-01', { hh: 18, mm: 30, ss: 45 }, SH);
  ck('东八区 18:30:45 存成 UTC 10:30:45', due === '2026-10-01T10:30:45Z', due);
  const back = dueToLocal(due, SH)!;
  ck('读回东八区还是 10-01 18:30:45', back.date === '2026-10-01' && back.time!.hh === 18 && back.time!.mm === 30 && back.time!.ss === 45);
  const ny = dueToLocal(due, NY)!;
  ck('纽约看是 10-01 06:30:45', ny.date === '2026-10-01' && ny.time!.hh === 6 && ny.time!.ss === 45);
  const cross = dueFromLocal('2026-10-01', { hh: 0, mm: 30, ss: 0 }, SH);
  ck('东八区凌晨跨到 UTC 前一天', cross === '2026-09-30T16:30:00Z', cross);
  ck('全天不带时刻', dueFromLocal('2026-10-01', null, SH) === '2026-10-01' && dueToLocal('2026-10-01', SH)!.time === null);
  ck('完整显示:到秒 / 全天', formatDueFull('2026-10-01T10:30:45Z', SH) === '2026-10-01 18:30:45' && formatDueFull('2026-10-01', SH) === '2026-10-01 全天');
  ck('本地日期', localDateOf(Date.parse('2026-09-30T16:30:00Z'), SH) === '2026-10-01' && localDateOf(Date.parse('2026-09-30T16:30:00Z'), NY) === '2026-09-30');
}

console.log('# 逾期 / 排序');
{
  const now = Date.parse('2026-10-01T10:00:00Z'); // 东八区 18:00
  const today = localDateOf(now, SH);
  const soon = dueInfo('2026-10-01T10:30:00Z', today, 'pool', now, SH);
  ck('今天 18:30(还没到):今天 + 时刻', soon.label === '今天 18:30 到期' && soon.tone === 'today', soon.label);
  const late = dueInfo('2026-10-01T09:15:00Z', today, 'pool', now, SH);
  ck('过了 45 分钟:逾期 45 分钟(按精确时刻)', late.label === '已逾期 45 分钟' && late.tone === 'overdue', late.label);
  ck('过了几小时 / 几天', dueInfo('2026-10-01T06:00:00Z', today, 'pool', now, SH).label === '已逾期 4 小时' && dueInfo('2026-09-28T10:00:00Z', today, 'pool', now, SH).label === '已逾期 3 天');
  ck('全天的今天不算逾期(当天结束前)', dueInfo('2026-10-01', today, 'pool', now, SH).tone === 'today');
  ck('明天带时刻 / 以后显示「10-05 09:00」', dueInfo('2026-10-02T01:00:00Z', today, 'pool', now, SH).label === '明天 09:00 到期' && dueInfo('2026-10-02T01:00:00Z', today, 'pool', now, SH).tone === 'tomorrow' && dueInfo('2026-10-05T01:00:00Z', today, 'pool', now, SH).label === '10-05 09:00');
  ck('已完成不算逾期', dueInfo('2026-09-28T10:00:00Z', today, 'done', now, SH).tone === 'normal');
  ck('悬停提示是到秒的本地时刻', soon.full === '2026-10-01 18:30:00');
  ck('全天 = 本地那天 23:59:59', dueInstant('2026-10-01', SH) === Date.parse('2026-10-01T15:59:59Z'));
  ck('排序:全天排在同一天的具体时刻后面', dueCmp('2026-10-01', '2026-10-01T12:00:00Z', SH) > 0 && dueCmp('2026-10-01T12:00:00Z', '2026-10-02', SH) < 0);
  ck('排序:空的在最后', dueCmp('', '2026-10-01', SH) > 0);
}

console.log('# 月历 / 时刻输入');
{
  const g = monthGrid(2026, 10);
  ck('6 行 × 7 列', g.length === 42);
  ck('周一开头:2026-10-01 是周四 → 前面补 3 天', g[0].date === '2026-09-28' && g[3].date === '2026-10-01' && !g[0].inMonth && g[3].inMonth);
  ck('跨年换月', JSON.stringify(shiftMonth(2026, 12, 1)) === '{"y":2027,"m":1}' && JSON.stringify(shiftMonth(2026, 1, -1)) === '{"y":2025,"m":12}');
  ck('键盘:← → ↑ ↓', calendarKey('2026-10-01', 'ArrowLeft') === '2026-09-30' && calendarKey('2026-10-01', 'ArrowDown') === '2026-10-08' && calendarKey('2026-10-01', 'ArrowUp') === '2026-09-24');
  ck('键盘:PageDown 月底夹住', calendarKey('2026-01-31', 'PageDown') === '2026-02-28' && calendarKey('2026-10-01', 'x') === null);
  ck('时刻输入 HH:MM:SS / HH:MM,越界拒绝', JSON.stringify(parseTime('18:30:45')) === '{"hh":18,"mm":30,"ss":45}' && parseTime('9:05')!.ss === 0 && parseTime('24:00') === null && parseTime('12:60') === null);
  const sc = dueShortcuts('2026-10-01');
  ck('快捷项:今天 / 明天 / 下周一(全天)', sc.map(x => x.value).join() === '2026-10-01,2026-10-02,2026-10-05');
  ck('addDays 跨月', addDays('2026-10-31', 1) === '2026-11-01');
}

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
