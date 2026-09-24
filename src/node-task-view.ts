// 节点页「任务」区的展示层纯函数(2026-09-25 Vincent「任务的展示也非常难看」)。
// 截图里的四个问题,各对应这里一个函数:
//   1. 预览原样露出 **加粗**、`代码`、⭐ → stripInlineMarkdown(
//   2. 每条开头的「【A → B】」和下面的「来自 A」重复 → stripRouteHeader(
//   3. 签收 4–7 天、早没人管的件也算「正在运行」→ splitStale( 按最后一次动静分出「可能卡住」
//   4. 优先级只是一行灰字 → priorityPill(:只有 high/urgent/low 才出标签,normal 什么都不显示
// 不 import react-native。
import type { NodeTaskRow } from './node-tasks';

/** 签收后超过这么久没有任何动静(送达/开始/提交给运行时),就不再算「进行中」。 */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** 预览最多这么多字(两行 clamp 之外再兜一层,免得超长单行把布局算慢)。 */
export const PREVIEW_MAX = 160;

/** 把行内 markdown 语法去掉只留文字:标题井号、列表/引用前缀、加粗斜体、行内代码、链接、图片、装饰性星标。 */
export function stripInlineMarkdown(text: string): string {
  return (text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/\*\*|__/g, '')
    .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1$2')
    .replace(/`+([^`]*)`+/g, '$1')
    .replace(/`/g, '')
    .replace(/[⭐🌟✨]️?/gu, '');
}

export interface RouteHeader {
  from: string;
  to: string;
  /** 「｜」后面的补充说明,比如「admin 指派:评估…」;没有则为 ''。 */
  extra: string;
  /** 抬头之后的正文。 */
  rest: string;
}

/** 解析开头的「【A → B】」或「【A → B｜补充】」;不是这个形状返回 null。 */
export function parseRouteHeader(text: string): RouteHeader | null {
  const m = /^\s*【([^【】]*?)\s*(?:→|->)\s*([^【】｜|]*?)\s*(?:[｜|]\s*([^【】]*?))?\s*】\s*/.exec(text ?? '');
  if (!m) return null;
  return { from: m[1].trim(), to: m[2].trim(), extra: (m[3] ?? '').trim(), rest: text.slice(m[0].length) };
}

/**
 * 发件人与「来自 X」一致时,抬头是重复信息 → 去掉;有「｜补充」时只留补充。
 * 抬头的发件人和实际发件人不一致(转发、代发)时整段保留 —— 那一格有信息量。
 */
export function stripRouteHeader(text: string, sender: string): string {
  const h = parseRouteHeader(text);
  if (!h) return text ?? '';
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  if (!sender || !same(h.from, sender)) return text;
  return h.extra ? `${h.extra} ${h.rest}` : h.rest;
}

/** 列表里那两行:去抬头 → 去 markdown → 合并空白 → 截断。 */
export function taskPreview(content: string | undefined, sender: string, max = PREVIEW_MAX): string {
  const plain = stripInlineMarkdown(stripRouteHeader(content ?? '', sender)).replace(/\s+/g, ' ').trim();
  if (!plain) return '(空任务)';
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

/** hub 的 UTC `YYYY-MM-DD HH:MM:SS` 或 ISO → 毫秒;拿不到返回 NaN。 */
export function parseHubTime(v?: string): number {
  if (!v) return NaN;
  const iso = v.includes('T') ? v : `${v.replace(' ', 'T')}Z`;
  return new Date(iso).getTime();
}

/** 「刚刚」「12 分钟前」「3 小时前」「5 天前」;拿不到或在未来 → ''。 */
export function relativeTime(v: string | undefined, now: Date = new Date()): string {
  const ms = now.getTime() - parseHubTime(v);
  if (!Number.isFinite(ms) || ms < 0) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

/**
 * 把「运行中」拆成真正在跑的和「可能卡住」的:最后一次动静(row.lastActivity ?? row.since)
 * 早于 STALE_AFTER_MS 的算卡住。拿不到时间的行留在「进行中」—— 宁可多显示,也不藏起一条活件。
 */
export function splitStale(rows: readonly NodeTaskRow[], now: Date = new Date(), staleAfterMs = STALE_AFTER_MS): { active: NodeTaskRow[]; stale: NodeTaskRow[] } {
  const active: NodeTaskRow[] = [];
  const stale: NodeTaskRow[] = [];
  for (const r of rows) {
    const t = parseHubTime(r.lastActivity ?? r.since);
    if (Number.isFinite(t) && now.getTime() - t > staleAfterMs) stale.push(r);
    else active.push(r);
  }
  return { active, stale };
}

export type PillTone = 'danger' | 'warn' | 'muted';

/** 只有偏离常态的优先级才值得一个标签;normal/空 → null。 */
export function priorityPill(priority?: string): { label: string; tone: PillTone } | null {
  switch ((priority ?? '').trim().toLowerCase()) {
    case 'urgent': return { label: '紧急', tone: 'danger' };
    case 'high': return { label: '高优先', tone: 'warn' };
    case 'low': return { label: '低优先', tone: 'muted' };
    default: return null;
  }
}
