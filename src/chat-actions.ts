// 更像微信·round-2: 长按气泡动作的纯逻辑(可单测·无 RN 依赖)。

// 微信「引用」:把被引用内容压成单行、截断,包成引用块前缀,拼到输入框草稿前。
export const buildQuote = (content?: string, max = 40): string => {
  const t = (content || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const clip = t.length > max ? `${t.slice(0, max)}…` : t;
  return `「${clip}」\n`;
};

// 被引用文本拼进已有草稿:引用块在前,保留用户已输入的内容。
export const applyQuote = (draft: string, content?: string): string => buildQuote(content) + (draft || '');

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
  windowMs = 2 * 60 * 1000,
): string[] => local.filter(entry => fetched.some(item => {
  if ((item.content ?? '').trim() !== entry.content.trim()) return false;
  const remoteTime = messageTime(item.created_at);
  return Number.isFinite(remoteTime) && Math.abs(remoteTime - entry.createdAt) <= windowMs;
})).map(entry => entry.id);

// FlatList is inverted: newest must stay at index 0. Local retry echoes and
// Hub rows therefore need one shared chronological order, not "all locals first".
export const mergeMessagesNewestFirst = <T extends TimedMessage>(local: T[], fetched: T[]): T[] =>
  [...local.filter(item => item._localId), ...fetched]
    .map((item, index) => ({ item, index, time: messageTime(item.created_at) }))
    .sort((a, b) => (Number.isFinite(b.time) ? b.time : -Infinity) - (Number.isFinite(a.time) ? a.time : -Infinity) || a.index - b.index)
    .map(row => row.item);
