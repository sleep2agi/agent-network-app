/**
 * 聊天页超长消息折叠与 FlatList 渲染防抖工具（纯逻辑、可单测）。
 *
 * 背景（2026-11-23 真机排查「点进 微软测试鸽 特别卡」）：
 *   单条回复可达 96–98 KB（满屏表格/代码块/链接），首屏 10 条即可达 780+ KB。
 *   在聊天列表里直接同步全量解析并挂载几十万字符的 Markdown，会把 JS 主线程打满；
 *   且每 5 秒轮询都会生成新数组引用，若无变更仍触发整列重绘。
 *   这里提供三道纯函数防线：
 *     1) `foldLongMessage`: 超过 LONG_MESSAGE_CHARS 的聊天气泡默认只解析前一段，点「展开全文」再渲染完整正文；
 *     2) `CHAT_LIST_PERF`: 收紧 inverted FlatList 的初始渲染批与离屏窗口（默认 windowSize=21 会同时挂载 21 屏）；
 *     3) `sameChatMessages`: 5 秒轮询结果字段未变时复用旧数组引用，跳过无意义的整表重绘。
 */

export const LONG_MESSAGE_CHARS = 4000;

export interface LongMessageFold {
  readonly shown: string;
  readonly truncated: boolean;
  readonly hiddenChars: number;
  readonly totalChars: number;
}

/**
 * 截断超长 Markdown 正文，尽量落在换行处，并补齐被截断的围栏代码块闭合行，
 * 避免折叠预览把后续内容错解析成代码块。
 */
export function foldLongMessage(text: string, expanded: boolean, limit = LONG_MESSAGE_CHARS): LongMessageFold {
  const src = typeof text === 'string' ? text : '';
  const totalChars = src.length;
  if (expanded || totalChars <= limit) {
    return { shown: src, truncated: false, hiddenChars: 0, totalChars };
  }
  const minBreak = Math.floor(limit * 0.7);
  const nl = src.lastIndexOf('\n', limit);
  const cut = nl >= minBreak ? nl : limit;
  let shown = src.slice(0, cut).trimEnd();
  // 如果截断前刚好打开了未闭合的围栏（``` 或 ~~~），顺手补上对应的闭合行。
  let openFence: '```' | '~~~' | null = null;
  for (const line of shown.split('\n')) {
    const trimmed = line.trimStart();
    if (!openFence) {
      if (trimmed.startsWith('```')) openFence = '```';
      else if (trimmed.startsWith('~~~')) openFence = '~~~';
    } else if (trimmed.startsWith(openFence)) {
      openFence = null;
    }
  }
  if (openFence) shown = `${shown}\n${openFence}`;
  return {
    shown,
    truncated: true,
    hiddenChars: Math.max(0, totalChars - cut),
    totalChars,
  };
}

export function longMessageFoldLabel(fold: LongMessageFold, expanded: boolean, limit = LONG_MESSAGE_CHARS): string | null {
  if (fold.totalChars <= limit) return null;
  if (expanded) return `收起长消息（共 ${fold.totalChars} 字）`;
  const approxKb = fold.hiddenChars >= 2000 ? `约 ${Math.max(1, Math.round(fold.hiddenChars / 1000))}k 字` : `${fold.hiddenChars} 字`;
  return `展开全文（还有 ${approxKb}）`;
}

/** 聊天主 FlatList 的虚拟化参数：减小首屏同步挂载量与离屏窗口，保留丝滑滚动。 */
export const CHAT_LIST_PERF = {
  initialNumToRender: 8,
  maxToRenderPerBatch: 6,
  windowSize: 7,
  updateCellsBatchingPeriod: 50,
} as const;

export interface ComparableChatRow {
  task_id?: string;
  _localId?: string;
  _proactive?: boolean;
  _pending?: boolean;
  _failed?: boolean;
  _failReason?: string;
  _restoredNoImage?: boolean;
  status?: string;
  content?: string;
  result?: string | null;
  reply?: string | null;
  created_at?: string;
  completed_at?: string | null;
  from_name?: string;
  to_name?: string;
  late?: boolean;
}

/** 5 秒轮询结果与当前列表完全一致时返回 true，让 setMessages 复用 prev 引用、避免整列重绘。 */
export function sameChatMessages(prev: readonly ComparableChatRow[], next: readonly ComparableChatRow[]): boolean {
  if (prev === next) return true;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i++) {
    const a = prev[i];
    const b = next[i];
    if (a === b) continue;
    if (
      a.task_id !== b.task_id
      || a._localId !== b._localId
      || a._proactive !== b._proactive
      || a._pending !== b._pending
      || a._failed !== b._failed
      || a._failReason !== b._failReason
      || a._restoredNoImage !== b._restoredNoImage
      || a.status !== b.status
      || a.content !== b.content
      || a.result !== b.result
      || a.reply !== b.reply
      || a.created_at !== b.created_at
      || a.completed_at !== b.completed_at
      || a.from_name !== b.from_name
      || a.to_name !== b.to_name
      || a.late !== b.late
    ) {
      return false;
    }
  }
  return true;
}
