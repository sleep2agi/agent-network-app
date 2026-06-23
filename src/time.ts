// Hub timestamps are SQLite UTC ("2026-06-11 01:23:45"); render them in
// device-local time, compact: relative within the hour, HH:MM today,
// MM-DD HH:MM otherwise.
export const formatTime = (raw?: string): string => {
  if (!raw) return '';
  // SQLite emits zoneless, space-separated UTC ("2026-06-11 01:23:45").
  // new Date() of that string parses as DEVICE-LOCAL → an 8h skew on a CN
  // phone (everything would read "8小时前"). Convert to ISO and append 'Z'
  // so it's parsed as UTC; the get* accessors below then render device-local.
  // Inputs that already carry 'T' are assumed ISO-with-zone and pass through.
  const d = new Date(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`);
  if (isNaN(d.getTime())) return '';
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
