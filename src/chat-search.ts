// app#166 —— 微信式「聊天记录搜索」的纯逻辑(无 RN 依赖,bun/node 直接跑测试)。
// 范围永远是**一个会话**:调用方传的就是当前会话已加载的列表(inverted:index 0 = 最新)。
// 会话隔离 / stale 拒收靠 conversation key:搜索开始时记下 key,结果回来时不等就丢。

export interface SearchableItem {
  key: string;
  text: string;
  sender?: string;
  createdAt?: string;
}

export interface SearchHit {
  key: string;
  /** 在传入列表里的下标(inverted 列表:越小越新)。定位就用它 scrollToIndex。 */
  index: number;
  snippet: string;
  sender?: string;
  createdAt?: string;
}

export const normalizeQuery = (q: string): string => q.replace(/\s+/g, ' ').trim().toLowerCase();

/** 命中片段:以第一处命中为中心截 radius 个字,两端加省略号;没命中就取开头。 */
export const makeSnippet = (text: string, query: string, radius = 24): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  const q = normalizeQuery(query);
  const at = q ? flat.toLowerCase().indexOf(q) : -1;
  if (at < 0) return flat.length > radius * 2 ? `${flat.slice(0, radius * 2)}…` : flat;
  const start = Math.max(0, at - radius);
  const end = Math.min(flat.length, at + q.length + radius);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`;
};

/** 大小写不敏感的子串搜索;多词(空格分隔)要全部命中。结果保持列表顺序(新→旧)。 */
export const searchItems = (items: SearchableItem[], query: string): SearchHit[] => {
  const q = normalizeQuery(query);
  if (!q) return [];
  const terms = q.split(' ');
  const hits: SearchHit[] = [];
  items.forEach((it, index) => {
    const hay = it.text.toLowerCase();
    if (terms.every(t => hay.includes(t))) {
      hits.push({ key: it.key, index, snippet: makeSnippet(it.text, terms[0]!), sender: it.sender, createdAt: it.createdAt });
    }
  });
  return hits;
};

/** 上一条 / 下一条,循环。列表是新→旧,「上一条(older)」= index+1。 */
export const stepHit = (current: number, total: number, dir: 'older' | 'newer'): number => {
  if (total <= 0) return -1;
  if (current < 0) return 0;
  return dir === 'older' ? (current + 1) % total : (current - 1 + total) % total;
};

export type ChatSearchState = 'idle' | 'loading' | 'results' | 'empty' | 'failed';

/** 五种状态(issue 的 Required states):空查询 / 搜更早历史中 / 有结果 / 无结果 / 失败可重试。 */
export const chatSearchState = (input: { query: string; loading: boolean; hits: number; failed: boolean }): ChatSearchState => {
  if (!normalizeQuery(input.query)) return 'idle';
  if (input.failed) return 'failed';
  if (input.loading) return 'loading';
  return input.hits > 0 ? 'results' : 'empty';
};

export const matchCountLabel = (current: number, total: number): string =>
  total === 0 ? '0 条' : `${current + 1}/${total}`;

/**
 * 「还要不要往更早翻」:没命中(或用户要求继续)且还有更早历史,且没翻到上限。
 * 上限防止一个从未出现过的词把整个历史拉完。
 */
export const shouldLoadOlderForSearch = (input: { hits: number; hasOlder: boolean; pagesLoaded: number; maxPages: number }): boolean =>
  input.hits === 0 && input.hasOlder && input.pagesLoaded < input.maxPages;

/** stale 拒收:搜索开始时的会话 key 与现在可见的不一致 → 结果作废。 */
export const isStaleSearch = (startedKey: string, visibleKey: string): boolean => startedKey !== visibleKey;

/** 定位后的临时高亮:同一条 key 才高亮,超过 ttl 就不再高亮。 */
export const isHighlighted = (key: string, highlight: { key: string; at: number } | null, now: number, ttlMs = 2000): boolean =>
  !!highlight && highlight.key === key && now - highlight.at < ttlMs;
