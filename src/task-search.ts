// 任务页搜索的纯逻辑(不 import react-native —— task-search.test.ts 直接引)。
//
// Owner 2026-09-30(平板横屏截图):「这个任务是不是可以加一下搜索的功能啊?我有时候我想找那些任务,可能找不到」。
// 搜的是已经读到本机的行(Hub GET /api/requirements 最多 500 行,见 PR 说明),不另发请求;
// 归档的卡默认不在列表里,只有搜索里勾了「包含已归档」才另读一次 ?archived=true 混进来并标出。
//
//   · 搜:标题、描述、负责人 / 负责 Agent / 参与人的显示名、旧 Hub 的 assignee 文本、项目名、标签
//   · 大小写不敏感;全角字母数字按半角算(NFKC);中文按子串,不分词
//   · 空格隔开的几个词是「且」:每个词都要在上面某一个字段里出现(可以是不同字段)
//   · 和筛选叠加:先搜后筛、先筛后搜结果一样(两个都是逐行判断),各视图都用 visibleTasks 这一个入口
import { applyFilter, personName, type BoardFilter } from './task-board-model';
import type { Requirement, RequirementProject } from './requirements-model';
import { matchesTaskId } from './task-short-id';
import type { RequirementPerson } from './requirement-people';

export interface TaskSearch {
  /** 输入框里的原文(已经过去抖)。 */
  q: string;
  /** 「包含已归档」:只在有搜索词时生效。 */
  archived: boolean;
}

export const EMPTY_SEARCH: TaskSearch = { q: '', archived: false };

/** 输入去抖(毫秒):打字停下这么久才重新筛。 */
export const SEARCH_DEBOUNCE_MS = 120;

export interface SearchContext {
  people: readonly RequirementPerson[];
  projects: readonly RequirementProject[] | null;
}

/** 单个字符的归一:NFKC(全角 → 半角)再转小写。 */
const fold = (s: string): string => s.normalize('NFKC').toLocaleLowerCase();

/** 搜索词:归一后按空白切开,去重、去空。 */
export function searchTerms(q: string): string[] {
  return [...new Set(fold(q).split(/\s+/).filter(Boolean))];
}

export const searching = (search: Pick<TaskSearch, 'q'>): boolean => searchTerms(search.q).length > 0;

/** 描述是 markdown:图片 / 链接的地址不参与搜索(否则搜「api」会命中所有带截图的任务),链接文字保留。 */
export function descriptionText(md: string | undefined): string {
  if (!md) return '';
  return md
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ');
}

/** 一张卡能被搜到的所有文字。字段之间用换行隔开 —— 一个词不会跨两个字段拼出来。 */
export function searchFields(item: Requirement, ctx: SearchContext): string[] {
  const refs = [item.owner, item.agentOwner, ...(item.participants ?? [])].filter((r): r is NonNullable<typeof r> => !!r);
  const project = item.projectId ? ctx.projects?.find(p => p.id === item.projectId)?.name : undefined;
  return [
    item.name,
    descriptionText(item.description),
    ...refs.map(r => personName(r, ctx.people)),
    item.assignee,
    project ?? '',
    ...(item.tags ?? []),
  ].filter(Boolean);
}

export function matchesSearch(item: Requirement, terms: readonly string[], ctx: SearchContext): boolean {
  if (!terms.length) return true;
  const hay = fold(searchFields(item, ctx).join('\n'));
  return terms.every(t => hay.includes(t));
}

/**
 * 参与搜索的行:本机读到的 + (有搜索词且勾了「包含已归档」时)归档的那些。
 * 同一个 id 两边都有时用本机的(刚取消归档的卡)。
 */
export function searchPool(items: readonly Requirement[], archived: readonly Requirement[], search: TaskSearch): readonly Requirement[] {
  if (!search.archived || !searching(search) || !archived.length) return items;
  const have = new Set(items.map(i => i.id));
  return [...items, ...archived.filter(a => !have.has(a.id))];
}

/**
 * 只按搜索挑(还没筛):看板的列要在这上面再按筛选分组(boardColumns 自己会筛)。
 * serverHits = 服务端搜索(本机的表被截断时)找到的、本机没读到的更老的卡:服务端已经按同样的语义匹配过,直接并进来。
 */
export function searchedTasks(items: readonly Requirement[], archived: readonly Requirement[], search: TaskSearch, ctx: SearchContext, serverHits: readonly Requirement[] = []): readonly Requirement[] {
  const terms = searchTerms(search.q);
  if (!terms.length) return items;
  // 任务 ID(#563):整句当一个 ID 去对(「#12」「12」对短号,完整 id / 8 位以上前缀对主键),和文字匹配「或」——
  // 「#12 portal」不把 ID 和文字拆开「且」。全角「＃１２」先归一成半角。
  const idQuery = taskIdQuery(search.q);
  const local = searchPool(items, archived, search).filter(item => (!!idQuery && matchesTaskId(item, idQuery)) || matchesSearch(item, terms, ctx));
  if (!serverHits.length) return local;
  const have = new Set(local.map(i => i.id));
  const known = new Set(items.map(i => i.id));
  // 本机表里有、但本机判定不匹配的卡(比如刚改过名还没同步到服务端)不从服务端结果里带回来。
  return [...local, ...serverHits.filter(h => !have.has(h.id) && !known.has(h.id))];
}

/** 喂给 matchesTaskId 的整句:去掉首尾空白,全角 ＃ / 数字 / 字母归一成半角(NFKC;ID 本身都是 ASCII)。 */
export const taskIdQuery = (q: string): string => q.trim().normalize('NFKC');

/** 要不要问服务端:Hub 支持搜索,且本机的表被截断(否则本机的结果就是全部)。 */
export const needsServerSearch = (capabilities: readonly string[], truncated: boolean, search: Pick<TaskSearch, 'q'>): boolean =>
  truncated && capabilities.includes('search') && searching(search);

/** 各视图(列表 / 看板 / 甘特图 / 日历)共用的入口:搜索 + 筛选。 */
export function visibleTasks(items: readonly Requirement[], archived: readonly Requirement[], filter: BoardFilter, search: TaskSearch, ctx: SearchContext, serverHits: readonly Requirement[] = []): Requirement[] {
  return applyFilter(searchedTasks(items, archived, search, ctx, serverHits), filter);
}

/**
 * 标题里要高亮的区间 [起, 止)(原文的 UTF-16 下标),按位置排好、重叠 / 相邻的合并。
 * 逐个码点归一再比,归一改变长度(全角、连字)时下标仍然落在原文上。
 */
export function highlightRanges(text: string, terms: readonly string[]): [number, number][] {
  if (!text || !terms.length) return [];
  let folded = '';
  const start: number[] = []; // folded 的每个 UTF-16 单元 → 原文里那个码点的起点
  const end: number[] = [];   // … → 原文里那个码点的终点
  for (let i = 0; i < text.length;) {
    const cp = text.codePointAt(i)!;
    const len = cp > 0xffff ? 2 : 1;
    const f = fold(String.fromCodePoint(cp));
    for (let k = 0; k < f.length; k++) { start.push(i); end.push(i + len); }
    folded += f;
    i += len;
  }
  const raw: [number, number][] = [];
  for (const t of terms) {
    for (let at = folded.indexOf(t); at >= 0; at = folded.indexOf(t, at + 1)) raw.push([start[at], end[at + t.length - 1]]);
  }
  raw.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: [number, number][] = [];
  for (const r of raw) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** 把标题切成「普通 / 命中」几段,依次画出来。 */
export function highlightSegments(text: string, terms: readonly string[]): { text: string; hit: boolean }[] {
  const ranges = highlightRanges(text, terms);
  if (!ranges.length) return [{ text, hit: false }];
  const out: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const [a, b] of ranges) {
    if (a > at) out.push({ text: text.slice(at, a), hit: false });
    out.push({ text: text.slice(a, b), hit: true });
    at = b;
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out;
}

/** 焦点在哪:普通位置 / 输入框(input、textarea)/ 富文本编辑器(contentEditable,描述编辑器里 Ctrl+K 是插入链接)。 */
export type FocusKind = 'none' | 'input' | 'rich';

/**
 * 键盘:「/」(不在输入框里时)或「搜索」快捷键(设置 → 快捷键的 nav.search,默认 ⌘/Ctrl+K;
 * 富文本编辑器里不接 —— 描述编辑器里 Ctrl+K 是插入链接)聚焦任务搜索框。
 */
export function isSearchShortcut(e: { key?: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }, focus: FocusKind, navSearchCombo: boolean): boolean {
  if (navSearchCombo) return focus !== 'rich';
  return e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && focus === 'none';
}

/** 键盘事件目标 → FocusKind(web DOM;原生上没有 document,不会走到这里)。 */
export function focusKindOf(target: { tagName?: string; isContentEditable?: boolean } | null | undefined): FocusKind {
  if (!target) return 'none';
  if (target.isContentEditable) return 'rich';
  const tag = (target.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ? 'input' : 'none';
}
