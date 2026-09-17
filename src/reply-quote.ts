// 2026-09-17 Vincent:「Agent 节点回复人类也要这个引用啊」—— 回复气泡下面也挂一条微信式引用条,
// 写清它回的是哪条人类消息(「admin: 先修这个啊」),点一下滚到并高亮那条原文。
// 纯函数,不引 react-native;ChatScreen 只负责渲染 + 定位。
import type { HubTask } from './api';
import { compactQuoteText, msgKey, parseQuoted } from './chat-actions';
import { resolveSender } from './chat-sender';

export type ReplyQuoteItem = HubTask & {
  _localId?: string;
  _proactive?: boolean;
  from_node_id?: string | null;
  /** 主动消息(user_inbox 行)若是对某条任务的回应,hub 会带原任务 id。 */
  in_reply_to?: string | null;
};

export type ReplyQuote = { author?: string; text: string; targetKey: string };

export type TaskLookup = ReadonlyMap<string, ReplyQuoteItem> | ((taskId: string) => ReplyQuoteItem | undefined);

const lookup = (byTaskId: TaskLookup | undefined, id: string): ReplyQuoteItem | undefined => {
  if (!byTaskId) return undefined;
  return typeof byTaskId === 'function' ? byTaskId(id) : byTaskId.get(id);
};

/** 被引用的是请求正文本身;请求开头若已有「@x: …」引用行,剥掉它,只引用请求自己说的话。 */
const requestText = (task: ReplyQuoteItem, max: number): string => {
  const parsed = parseQuoted(task.content);
  return compactQuoteText(parsed.body || task.content, max);
};

/**
 * 给一条回复算它的引用条。
 * - 回复文本自己已经以「@作者: …」开头 → 返回 null(那一条由调用方按既有方式渲染,不重复挂两条)。
 * - 普通任务行(请求 + 回复):引用同一行的请求,作者 = resolveSender 判出的发送方,目标 = 本行。
 * - 主动消息(_proactive):按 in_reply_to 找已加载的任务;找到就引用它,找不到不挂。
 */
export function replyQuoteFor(
  item: ReplyQuoteItem,
  currentUsername: string,
  byTaskId?: TaskLookup,
  max = 40,
): ReplyQuote | null {
  const replyText = item.result ?? item.reply ?? '';
  if (!replyText) return null;
  if (parseQuoted(replyText).quote) return null;
  if (item._proactive) {
    const id = typeof item.in_reply_to === 'string' ? item.in_reply_to.trim() : '';
    if (!id) return null;
    const target = lookup(byTaskId, id);
    if (!target) return null;
    const text = requestText(target, max);
    if (!text) return null;
    return { author: resolveSender(target, currentUsername).alias, text, targetKey: msgKey(target) };
  }
  const text = requestText(item, max);
  if (!text) return null;
  return { author: resolveSender(item, currentUsername).alias, text, targetKey: msgKey(item) };
}
