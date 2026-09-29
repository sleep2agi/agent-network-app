import { t } from './i18n';
import { parseHubTime } from './time';
import './i18n-task-fields';
export const taskTimestamp = (raw?: string | null): number | null => parseHubTime(raw ?? undefined)?.getTime() ?? null;
const pad = (n: number) => String(n).padStart(2, '0');
export function exactTaskTime(raw?: string | null): string {
  const ms = taskTimestamp(raw); if (ms === null) return '—';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
export function relativeTaskTime(raw?: string | null, now = Date.now()): string {
  const ms = taskTimestamp(raw); if (ms === null) return '—';
  const d = new Date(ms), today = new Date(now), yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate()-1);
  const min = Math.floor((now-ms)/60000);
  if (min >= 0 && min < 1) return t('fields.time.now');
  if (min >= 1 && min < 60) return t('fields.time.minutes', { count: min });
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === yesterday.toDateString()) return t('fields.time.yesterday', { time: hm });
  if (d.toDateString() === today.toDateString()) return min >= 60 ? t('fields.time.hours', { count: Math.floor(min/60) }) : hm;
  return `${d.getFullYear() === today.getFullYear() ? '' : `${d.getFullYear()}-`}${pad(d.getMonth()+1)}-${pad(d.getDate())} ${hm}`;
}
