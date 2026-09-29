import { currentLanguage } from './i18n';
import { formatChatHeader, parseHubTime } from './time';

// Presentation only; keep timestamp parsing and grouping semantics unchanged.
export function localizedChatHeader(raw?: string, nowMs = Date.now()): string {
  if (currentLanguage() === 'zh') return formatChatHeader(raw, nowMs);
  const date = parseHubTime(raw);
  if (!date) return '';
  const now = new Date(nowMs);
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (date.toDateString() === now.toDateString()) return time;
  if (date.toDateString() === new Date(nowMs - 86400000).toDateString()) return `Yesterday ${time}`;
  return `${new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}) }).format(date)} ${time}`;
}
