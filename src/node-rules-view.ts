// 规则文件「阅读 / 编辑 / 全屏」的纯模型(2026-09-25,Vincent「这个规则文件也太少了」:
// 48 KB 的 AGENTS.md 挤在一个等宽编辑框里,读不动)。
// 默认阅读模式 = 用聊天同一个 MarkdownMessage 渲染;编辑模式 = 原来的等宽编辑框。
// 纯逻辑,不 import react-native。
import { parseMarkdownBlocks } from './markdown-model';

export type RulesViewMode = 'read' | 'edit';

/** 打开规则文件时默认的模式:读得多、改得少,先给能读的样子。 */
export const RULES_DEFAULT_MODE: RulesViewMode = 'read';

export interface RulesViewState {
  /** 阅读模式渲染哪份文字:永远是编辑中的草稿(没改过时草稿就等于节点上的原文)。 */
  readonly renderSource: string;
  /** 草稿和节点上的不一样时,阅读模式也要标「未保存」,免得以为看的是节点上的版本。 */
  readonly unsaved: boolean;
}

/**
 * 两种模式共用同一份草稿:切到阅读不丢改动,切回编辑接着改。
 * onNode 为 null = 还没读到(不算未保存);'' = 节点上文件不存在。
 */
export function rulesViewState(draft: string, onNode: string | null): RulesViewState {
  return { renderSource: draft, unsaved: onNode !== null && draft !== onNode };
}

export interface OutlineEntry {
  /** 在全文所有标题里的序号(0 起),与 MarkdownMessage 的 onHeadingLayout 序号一致。 */
  readonly index: number;
  readonly level: number;
  readonly text: string;
}

/** 目录只收 h1–h3,再深就不是目录是全文了。 */
export const OUTLINE_MAX_LEVEL = 3;

/** 目录里显示纯文字:去掉行内 markdown 记号(`代码`、**粗**、*斜*、[链接](url))。 */
export function outlineText(raw: string): string {
  return raw
    .replace(/\[([^\]\n]+)\]\([^\s)]+\)/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*|__([^_\n]+)__/g, (_m, a, b) => a ?? b)
    .replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 全屏左侧目录。复用渲染用的同一个解析器,所以代码块里的 `# 注释` 不会被当成标题,
 * 序号也和渲染出来的标题一一对应(点目录滚到的就是那一个)。
 */
export function buildRulesOutline(source: string): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  let index = 0;
  for (const block of parseMarkdownBlocks(source)) {
    if (block.kind !== 'heading') continue;
    if (block.level <= OUTLINE_MAX_LEVEL) out.push({ index, level: block.level, text: outlineText(block.text) });
    index++;
  }
  return out;
}

/**
 * 什么时候该**重新**向节点读规则文件。节点页每次刷新都会新造一个 target 对象(rulesFileTarget),
 * 以前读取挂在对象身份上 ⇒ 页面一刷新就重读一次、把编辑框里没保存的草稿冲掉。
 * 只在「读的是不是同一个文件」变了时才重读:同一台 hub、同一个网络、同一个节点。
 */
export function rulesReadKey(
  cfg: { serverUrl: string; networkId?: string; profileId?: string },
  node: { node_id?: string | null; alias: string },
): string {
  return JSON.stringify([cfg.serverUrl, cfg.networkId ?? null, cfg.profileId ?? null, node.node_id ?? null, node.alias]);
}

// ── 阅读模式「双击跳到源码」(2026-09-25 Vincent:「双击对应内容,跳转到对应的 Markdown 进行编辑」) ──
// 渲染出来的每个块带着它在原文里的行号(markdown-model 的 line/endLine/itemLines/rowLines);
// 双击 → 切到编辑 → 把这几行选中并滚到编辑框中间。行号换成字符偏移必须在**草稿**上算
// (阅读模式渲染的就是草稿),并且认 \r\n、\r、\n 三种换行 —— 解析器也是这么切行的。

export interface SourceLineRange {
  /** 首行,0 起。 */
  readonly start: number;
  /** 末行,0 起,含。 */
  readonly end: number;
}

/** 第 line 行(0 起)行首在 text 里的字符偏移;超出末行时返回 text.length。 */
export function lineStartOffset(text: string, line: number): number {
  if (line <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      seen++;
      if (seen === line) return i + 1;
    }
  }
  return text.length;
}

/** 第 line 行行尾(换行符之前)的偏移。 */
export function lineEndOffset(text: string, line: number): number {
  let i = lineStartOffset(text, line);
  while (i < text.length && text[i] !== '\r' && text[i] !== '\n') i++;
  return i;
}

/** 行范围 → 编辑框要选中的字符区间 [start, end)。 */
export function sourceSelection(text: string, range: SourceLineRange): { start: number; end: number } {
  const start = lineStartOffset(text, range.start);
  const end = Math.max(start, lineEndOffset(text, Math.max(range.start, range.end)));
  return { start, end };
}

/** 偏移落在第几行(0 起)。编辑切回阅读时用光标所在行找回对应的块。 */
export function lineAtOffset(text: string, offset: number): number {
  const head = text.slice(0, Math.min(Math.max(0, offset), text.length));
  return (head.match(/\r\n|\r|\n/g) ?? []).length;
}

/** 渲染元素上的 data-md-line / data-md-end 读回行范围;缺失或不是非负整数 ⇒ null(不跳)。 */
export function sourceRangeFromDataset(ds: { mdLine?: string; mdEnd?: string } | null | undefined): SourceLineRange | null {
  if (!ds || ds.mdLine == null) return null;
  const isLine = (v: string) => /^\d+$/.test(v);
  if (!isLine(ds.mdLine)) return null;
  const start = Number(ds.mdLine);
  const end = ds.mdEnd != null && isLine(ds.mdEnd) ? Math.max(start, Number(ds.mdEnd)) : start;
  return { start, end };
}

/**
 * 从编辑切回阅读时,滚回哪一块:起始行 ≤ 光标行里最靠后的那一块(光标在块中间也算这块)。
 * starts 是阅读区里所有带行号元素的起始行(任意顺序);空 ⇒ null。
 */
export function blockLineForCaret(starts: readonly number[], caretLine: number): number | null {
  let best: number | null = null;
  for (const s of starts) if (s <= caretLine && (best === null || s > best)) best = s;
  return best;
}

/**
 * 在哪份文字上把行号换成偏移:编辑框里真实的文字(浏览器 textarea 会把 \r\n 规范成 \n,
 * 选区偏移按规范后的算);拿不到编辑框时退回草稿。永远不是节点上的原文。
 * 行号在两者上相同(解析器也把 \r\n 当一次换行),偏移不同 —— CRLF 文件每行差一个字符。
 */
export function jumpText(editorValue: unknown, draft: string): string {
  return typeof editorValue === 'string' ? editorValue : draft;
}

// ── 紧凑工具条(2026-09-25,Vincent「这个地方占的位置太大了」) ─────────────────
// 原来标题下面叠了 分区说明 + 卡片内说明(两段几乎同义) + 工具条 + 独占一行的状态句,内容要到 ~430px 才开始。
// 现在只剩一行工具条:说明收进 ⓘ,状态句内联在按钮左边,成功类提示过几秒自己消失。

/** 成功/普通提示在工具条里停留多久后自动消失(毫秒)。 */
export const RULES_STATUS_HIDE_MS = 3000;

export type RulesStatusTone = 'muted' | 'ok' | 'error';
export type RulesPhase = 'loading' | 'ready' | 'saving' | 'unavailable';

/**
 * 工具条里的状态句要不要自动消失,多久后消失。
 *  - 错误:一直留着,直到下一次操作换掉它(null)。
 *  - 读取中 / 保存中:进行中的说明要一直在(null)。
 *  - 不可用:那句话就是这一区唯一的内容(版本太旧、节点离线…),不能消失(null)。
 *  - 其余(已读取、已保存):RULES_STATUS_HIDE_MS 后消失。
 */
export function statusAutoHideMs(tone: RulesStatusTone, phase: RulesPhase): number | null {
  if (tone === 'error') return null;
  if (phase === 'loading' || phase === 'saving' || phase === 'unavailable') return null;
  return RULES_STATUS_HIDE_MS;
}

/** 保存按钮文案:干净时按钮置灰但仍叫「保存」(不再显示「已是最新」这种像状态的字)。 */
export function saveButtonLabel(phase: RulesPhase): string {
  return phase === 'saving' ? '保存中…' : '保存';
}

/** ⓘ 里的说明:原先分区说明和卡片说明两段合成一段;web 端再附一句双击提示。 */
export function rulesInfoText(fileName: string, web: boolean): string {
  const base = `这是节点工作目录里的 ${fileName}，节点每次开会话都会读它。保存会直接覆盖节点机器上的这个文件；文件名和位置由节点自己决定，这里改不了。`;
  return web ? `${base}阅读模式下双击任意内容，可跳到对应的源码行编辑。` : base;
}
