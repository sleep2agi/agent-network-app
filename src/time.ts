// Hub timestamps are SQLite UTC ("2026-06-11 01:23:45"); render them in
// device-local time, compact: relative within the hour, HH:MM today,
// MM-DD HH:MM otherwise.

// SQLite emits zoneless, space-separated UTC ("2026-06-11 01:23:45"). new Date()
// of that string parses as DEVICE-LOCAL → an 8h skew on a CN phone. Convert to
// ISO + 'Z' so it's parsed as UTC; the get* accessors then render device-local.
// Inputs that already carry 'T' are assumed ISO-with-zone and pass through.
export const parseHubTime = (raw?: string): Date | null => {
  if (!raw) return null;
  const d = new Date(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`);
  return isNaN(d.getTime()) ? null : d;
};

export const formatTime = (raw?: string): string => {
  const d = parseHubTime(raw);
  if (!d) return '';
  const now = Date.now();
  const diffMin = Math.floor((now - d.getTime()) / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;
  const pad = (n: number) => String(n).padStart(2, '0');
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const today = new Date(now);
  if (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  ) {
    return hm;
  }
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
};

// ── WeChat-style time cluster headers (round-1: 更像微信 时间分组) ──
// 微信 doesn't stamp every bubble; it shows a centered time header only where a
// gap opens between message clusters. These helpers are pure so they unit-test
// without a device.

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// Header shown above a cluster: today → "HH:MM"; yesterday → "昨天 HH:MM";
// same year → "M月D日 HH:MM"; else → "YYYY年M月D日 HH:MM".
export const formatChatHeader = (raw?: string, nowMs: number = Date.now()): string => {
  const d = parseHubTime(raw);
  if (!d) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const now = new Date(nowMs);
  if (sameDay(d, now)) return hm;
  const yesterday = new Date(nowMs - 86400000);
  if (sameDay(d, yesterday)) return `昨天 ${hm}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
};

// Grouping decision: show a header above `cur` when it starts a new time cluster —
// i.e. it's the oldest visible message (`older` absent) or the gap to the older
// neighbour exceeds `gapMs` (default 5 min, matching 微信). Pure + timezone-safe.
export const CHAT_TIME_GAP_MS = 5 * 60 * 1000;
export const shouldShowTimeHeader = (
  curRaw?: string,
  olderRaw?: string,
  gapMs: number = CHAT_TIME_GAP_MS,
): boolean => {
  const cur = parseHubTime(curRaw);
  if (!cur) return false;
  const older = parseHubTime(olderRaw);
  if (!older) return true; // oldest visible message → anchor the first header
  return cur.getTime() - older.getTime() > gapMs;
};
