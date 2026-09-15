// 更像微信·round-2: 长按气泡动作的纯逻辑(可单测·无 RN 依赖)。

// 微信「引用」:把被引用内容压成单行、截断,包成引用块前缀,拼到正文前。
// 2026-09-15(Vincent:抄微信的引用设计):带作者时写成「@作者: 文本」,客户端把这一行从气泡里
// 拆出来,渲染成气泡下方的灰色引用条;agent 收到的仍是纯文本,上下文不丢。不带作者的旧格式照旧。
export const compactQuoteText = (content?: string, max = 40): string => {
  const t = (content || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > max ? `${t.slice(0, max)}…` : t;
};

export const buildQuote = (content?: string, max = 40, author?: string): string => {
  const clip = compactQuoteText(content, max);
  if (!clip) return '';
  const who = (author || '').replace(/[\s「」:：]+/g, ' ').trim();
  return who ? `「@${who}: ${clip}」\n` : `「${clip}」\n`;
};

// 被引用文本拼进已有草稿:引用块在前,保留用户已输入的内容。
export const applyQuote = (draft: string, content?: string, author?: string): string => buildQuote(content, 40, author) + (draft || '');

export type QuoteRef = { author?: string; text: string };

// 把「@作者: 文本」/「文本」前缀从消息正文里拆出来。只认**开头第一行**是引用块的形状;
// 正文里别处的「」不动。返回 body 是去掉引用块后的正文(可能为空串)。
export const parseQuoted = (content?: string): { quote: QuoteRef | null; body: string } => {
  const raw = content || '';
  const m = /^「([^\n」]{1,200})」[ \t]*\n?/.exec(raw);
  if (!m) return { quote: null, body: raw };
  const inner = m[1];
  const withAuthor = /^@([^:：]{1,64})[:：]\s?(.*)$/.exec(inner);
  const quote: QuoteRef = withAuthor ? { author: withAuthor[1].trim(), text: withAuthor[2] } : { text: inner };
  if (!quote.text.trim()) return { quote: null, body: raw };
  return { quote, body: raw.slice(m[0].length) };
};

// 引用条文案:微信是「作者: 内容」一行;旧格式没作者就只显示内容。
export const quoteLabel = (q: QuoteRef): string => (q.author ? `${q.author}: ${q.text}` : q.text);

// 稳定标识(本地乐观消息用 _localId,已入库用 task_id)——删除/去重都靠它。
export const msgKey = (m: { _localId?: string; task_id?: string }): string =>
  m._localId ?? m.task_id ?? '';

// 从列表中删除某条(按稳定标识),不误伤其它。
export const removeMessage = <T extends { _localId?: string; task_id?: string }>(list: T[], target: T): T[] => {
  const k = msgKey(target);
  return k ? list.filter((m) => msgKey(m) !== k) : list.filter((m) => m !== target);
};

// 更像微信·round-3: 滚动到底「回到最新」pill 的纯逻辑。
// inverted 列表:offsetY=0 在底部(最新)。滚离底部超过阈值 → 显示 pill。
export const shouldShowJumpPill = (offsetY: number, threshold = 200): boolean =>
  offsetY > threshold;

// 停在底部附近时的未读计数应清零;否则保留(供 pill 显示 "N 条新消息")。
export const nextUnread = (current: number, atBottom: boolean, incoming = 0): number =>
  atBottom ? 0 : current + incoming;

// pill 文案:有未读显条数,否则纯「回到最新」。
export const jumpPillLabel = (unread: number): string =>
  unread > 0 ? `${unread} 条新消息` : '回到最新';

// 更像微信·round-4: 发送键可用态(纯逻辑)。有非空草稿或附件、且不在发送中 → 可发。
export const canSend = (draft: string, hasAttachment: boolean, sending: boolean): boolean =>
  !sending && ((draft || '').trim().length > 0 || hasAttachment);

// 更像微信·round-5: 会话列表头像的在线态圆点。offline → 灰点(暗);其余(working/idle)→ 亮点。
export const isAgentOnline = (status?: string): boolean => !!status && status !== 'offline';

// Keep raw runtime states out of the desktop UI. The conversation row and
// chat header must describe the same agent with the same user-facing word.
export const agentStatusLabel = (status?: string): string => {
  if (status === 'working' || status === 'running') return '工作中';
  if (status === 'offline' || !status) return '离线';
  return '在线';
};

// WeChat-style desktop composer contract: bare Enter sends, while a modifier
// plus Enter inserts a newline. Composition must win so confirming
// Chinese/Japanese input never sends early.
export const shouldSendOnEnter = (event: {
  key?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  which?: number;
}): boolean => event.key === 'Enter'
  && !event.ctrlKey
  && !event.metaKey
  && !event.shiftKey
  && !event.isComposing
  && event.keyCode !== 229
  && event.which !== 229;

type TimedMessage = { content?: string; created_at?: string; _localId?: string };
type TimedOutbox = { id: string; content: string; createdAt: number };

const messageTime = (value?: string): number => {
  if (!value) return Number.NaN;
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  return Date.parse(normalized);
};

// A write may reach the Hub while its HTTP acknowledgement is lost. When the
// next poll sees the authoritative row, retire the matching local retry echo
// instead of showing both "delivered" and "未送达" forever. The short time
// window prevents an older repeated message with identical text from matching.
export const confirmedOutboxIds = (
  local: TimedOutbox[],
  fetched: TimedMessage[],
  // Slightly wider than CommHub's five-minute duplicate-send window.
  windowMs = 6 * 60 * 1000,
): string[] => local.filter(entry => fetched.some(item => {
  if ((item.content ?? '').trim() !== entry.content.trim()) return false;
  const remoteTime = messageTime(item.created_at);
  return Number.isFinite(remoteTime) && Math.abs(remoteTime - entry.createdAt) <= windowMs;
})).map(entry => entry.id);

// FlatList is inverted: newest must stay at index 0. Local retry echoes and
// Hub rows therefore need one shared chronological order, not "all locals first".
//
// 🔴 Deduplicated by `_localId` (issue #178). Concatenating was correct only
// while `fetched` came straight from the Hub, which never carries a
// `_localId`. ChatScreen also calls this with the *conversation cache* as
// `fetched`, and that cache was written by an earlier merge — so it already
// holds the same local echoes. Every A→B→A return stacked another copy, and
// the user saw one undelivered message four times. The standalone chat window
// opens once against a cold cache, which is exactly why it never reproduced
// there.
//
// The first occurrence wins, and `local` is passed first, so the entry that
// survives is the one carrying the current `_pending` / `_failed` state rather
// than whatever the cache froze a poll ago.
export const mergeMessagesNewestFirst = <T extends TimedMessage>(local: T[], fetched: T[]): T[] => {
  const seenLocalIds = new Set<string>();
  return [...local.filter(item => item._localId), ...fetched]
    .filter(item => {
      const id = item._localId;
      // Hub rows have no `_localId`; they are never deduplicated here. Their
      // own identity is `task_id`, and collapsing on it would hide genuinely
      // repeated sends the user made on purpose.
      if (!id) return true;
      if (seenLocalIds.has(id)) return false;
      seenLocalIds.add(id);
      return true;
    })
    .map((item, index) => ({ item, index, time: messageTime(item.created_at) }))
    .sort((a, b) => (Number.isFinite(b.time) ? b.time : -Infinity) - (Number.isFinite(a.time) ? a.time : -Infinity) || a.index - b.index)
    .map(row => row.item);
};

// 2026-09-16(Vincent:「需要支持一下复制消息的按钮」):复制的是气泡里显示的正文 —— 去掉开头的
// 「@作者: 内容」引用块(那是被引用的别人的话),保留正文的换行;空正文时退回引用文本本身。
export const copyTextOf = (content?: string): string => {
  const { quote, body } = parseQuoted(content);
  const text = body.trim();
  if (text) return text;
  return quote ? quoteLabel(quote) : '';
};

// 「已复制」提示只停 1.4s,和微信一致的短反馈;传入 now 便于测试。
export const COPIED_TOAST_MS = 1400;
export const copiedToastVisible = (copiedAt: number | null, now: number): boolean =>
  copiedAt !== null && now - copiedAt < COPIED_TOAST_MS;
