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

// ── 手机 / 触屏(2026-09-26,Vincent 小米折叠屏 0.2.99:「好像编辑不了那个规则文件」) ─────────────
// 原生端没有 DOM:阅读区的「双击跳源码」靠 data-md-line + dblclick 做不了。原生端改成:
// MarkdownMessage 逐块报 onLayout(块 id、父块 id、行号、y、高) → 这里拼成相对阅读内容顶部的矩形 →
// 双击时按手指的 y 找块。触摸点和阅读内容顶部都取 page 坐标(同一坐标系),不做任何换算。

/** 一个渲染块的布局回报。y 相对父级:顶层块相对 MarkdownMessage 根,列表项相对所在的列表。 */
export interface BlockLayout {
  readonly id: string;
  /** 列表项所在列表的 id;顶层块没有。 */
  readonly parent?: string;
  readonly start: number;
  readonly end: number;
  readonly y: number;
  readonly height: number;
}

export interface BlockRect {
  readonly start: number;
  readonly end: number;
  /** 相对 MarkdownMessage 根顶部。 */
  readonly top: number;
  readonly bottom: number;
  /** 0 = 顶层块,1 = 列表项。 */
  readonly depth: number;
}

/**
 * 回报 → 绝对矩形。子块的 y 加上父块的 top;父块没报上来(还没布局 / 旧文档残留)的子块丢掉,
 * 不猜它在哪。父子链有环也不会死循环(深度封顶)。
 */
export function resolveBlockRects(entries: Iterable<BlockLayout>): BlockRect[] {
  const byId = new Map<string, BlockLayout>();
  for (const e of entries) byId.set(e.id, e);
  const out: BlockRect[] = [];
  for (const e of byId.values()) {
    let top = e.y;
    let depth = 0;
    let parentId = e.parent;
    let ok = true;
    while (parentId != null) {
      const parent = byId.get(parentId);
      if (!parent || depth > 8) { ok = false; break; }
      top += parent.y;
      depth++;
      parentId = parent.parent;
    }
    if (!ok || !Number.isFinite(top) || !(e.height >= 0)) continue;
    out.push({ start: e.start, end: e.end, top, bottom: top + e.height, depth });
  }
  return out.sort((a, b) => a.top - b.top || b.depth - a.depth);
}

/**
 * 手指落在 y(相对 MarkdownMessage 根顶部)⇒ 跳哪几行。
 *  - 落在块里:最深的那个(列表里点的是哪一项就跳哪一项,不是整张列表)。
 *  - 落在两块之间的空隙:上面那一块(和编辑切回阅读时「光标所在块」同一个方向)。
 *  - 在第一块上面:第一块。没有任何块:null(不跳)。
 */
export function blockAtY(rects: readonly BlockRect[], y: number): SourceLineRange | null {
  if (!rects.length || !Number.isFinite(y)) return null;
  let hit: BlockRect | null = null;
  for (const r of rects) {
    if (y >= r.top && y < r.bottom && (!hit || r.depth > hit.depth || (r.depth === hit.depth && r.bottom - r.top < hit.bottom - hit.top))) hit = r;
  }
  if (!hit) {
    for (const r of rects) if (r.depth === 0 && r.top <= y && (!hit || r.top > hit.top)) hit = r;
  }
  if (!hit) hit = rects.reduce((a, b) => (b.top < a.top ? b : a));
  return { start: hit.start, end: hit.end };
}

/** 两次轻触相隔多久以内算双击(毫秒)。Android 系统的 double-tap timeout 就是 300。 */
export const DOUBLE_TAP_MS = 300;
/** 两次轻触落点相距多远以内算同一处(dp)。 */
export const DOUBLE_TAP_SLOP = 32;
/** 按下到抬起移动超过它 = 在滑动,不算一次轻触(dp)。 */
export const TAP_MOVE_SLOP = 10;

export interface Tap { readonly t: number; readonly x: number; readonly y: number }

/** 按下 → 抬起没怎么动,才是一次轻触(滚动阅读区的那一下不算)。 */
export function isTap(down: { x: number; y: number }, up: { x: number; y: number }): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) <= TAP_MOVE_SLOP;
}

/** 上一次轻触 prev 和这一次 cur 合起来是不是一次双击。 */
export function isDoubleTap(prev: Tap | null, cur: Tap): boolean {
  if (!prev) return false;
  const dt = cur.t - prev.t;
  return dt >= 0 && dt <= DOUBLE_TAP_MS && Math.hypot(cur.x - prev.x, cur.y - prev.y) <= DOUBLE_TAP_SLOP;
}

/**
 * 工具条在这个宽度以下是「窄」的(手机竖屏):状态句挪到按钮下面单独一行(否则它要么占 120 宽把按钮挤到第三行,
 * 要么被挤成一条缝、读取中 / 出错的说明看不见),双击提示不显示(ⓘ 里有)。
 */
export const RULES_TOOLBAR_NARROW_WIDTH = 560;

export function rulesToolbarLayout(width: number): { statusOwnLine: boolean; showHint: boolean } {
  // 还没量到(0)按宽算 = 以前的样子,不在桌面上先闪一下窄版。
  const narrow = width > 0 && width < RULES_TOOLBAR_NARROW_WIDTH;
  return { statusOwnLine: narrow, showHint: !narrow };
}

/** 全屏左侧目录要 260 宽:窗口窄于这个就不放目录(手机竖屏上目录会把正文挤成一条)。 */
export const RULES_OUTLINE_MIN_WINDOW = 720;

export function showRulesOutline(windowWidth: number, entries: number): boolean {
  return entries > 0 && windowWidth >= RULES_OUTLINE_MIN_WINDOW;
}
