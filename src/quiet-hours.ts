// 0.2.76 免打扰时段(纯函数):"HH:MM" 起止,支持跨午夜(22:00 → 08:00)。
// 起止相同 = 全天免打扰;关闭时永远不静音。

export type QuietHours = { enabled: boolean; start: string; end: string };

export const DEFAULT_QUIET_HOURS: QuietHours = { enabled: false, start: '22:00', end: '08:00' };

export function parseClock(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** now 用本地时间的分钟数(0..1439);测试传数字。 */
export function inQuietHours(q: QuietHours, nowMinutes: number): boolean {
  if (!q.enabled) return false;
  const s = parseClock(q.start), e = parseClock(q.end);
  if (s === null || e === null) return false;
  if (s === e) return true;
  return s < e ? nowMinutes >= s && nowMinutes < e : nowMinutes >= s || nowMinutes < e;
}

export function localMinutes(now: Date = new Date()): number {
  return now.getHours() * 60 + now.getMinutes();
}
