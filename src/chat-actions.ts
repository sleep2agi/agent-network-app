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
