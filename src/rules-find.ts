// 规则文件「查找 / 替换」的纯逻辑(Vincent 09-25:「规则文件，你不能 Ctrl+F 去搜索定位里面的内容…
// 方便我去改」)。Tauri 的 webview 自带的查找在阅读区和编辑框里都用不了,这里自己做。
//
// 这里只放不碰 DOM 的部分:找匹配(偏移)、上一个/下一个(绕回)、替换、把一处匹配切到跨多个文本节点、
// 阅读 ↔ 编辑切换时挑「对应的那一处」。DOM 高亮在 RulesFind.tsx。
//
// 约定:
// - 查找词按**字面**匹配(`.`、`*`、`(` 之类不是正则);
// - 默认不区分大小写;大小写折叠**逐字符、保持长度**,所以偏移永远对应原文(见 foldForFind);
// - 匹配互不重叠,从左往右扫,命中后跳过整段(和浏览器查找一样:在 "aaaa" 里找 "aa" 是 2 处);
// - 空查找词 ⇒ 0 处(不是「每个位置都命中」)。

export interface FindMatch {
  /** 起点偏移(含),UTF-16 下标,和 String#slice / setSelectionRange 同一套。 */
  readonly start: number;
  /** 终点偏移(不含)。 */
  readonly end: number;
}

export interface FindOptions {
  readonly caseSensitive?: boolean;
  /** 最多返回几处;超过的不再找(界面显示「N+」)。 */
  readonly limit?: number;
}

/** 一次最多标多少处。单个汉字在 48 KB 的规则文件里也就几千处,这个上限只防病态输入。 */
export const FIND_MATCH_LIMIT = 5000;

/**
 * 大小写折叠,但**每个字符折叠后长度不变**:toLowerCase 会改变长度的少数字符(如土耳其语 'İ' → 'i̇',
 * 两个码元)保持原样。这样折叠后的串和原文逐位对齐,匹配偏移可以直接用在原文上。
 * 汉字、假名、全角符号没有大小写,原样通过。
 */
export function foldForFind(text: string): string {
  let out = '';
  for (const ch of text) {
    const lower = ch.toLowerCase();
    out += lower.length === ch.length ? lower : ch;
  }
  return out;
}

/** 在 text 里找 query 的全部(不重叠)出现位置。 */
export function findMatches(text: string, query: string, opts: FindOptions = {}): FindMatch[] {
  if (!query || !text) return [];
  const limit = opts.limit ?? FIND_MATCH_LIMIT;
  const hay = opts.caseSensitive ? text : foldForFind(text);
  const needle = opts.caseSensitive ? query : foldForFind(query);
  const out: FindMatch[] = [];
  let from = 0;
  while (out.length < limit) {
    const at = hay.indexOf(needle, from);
    if (at < 0) break;
    out.push({ start: at, end: at + needle.length });
    from = at + needle.length;
  }
  return out;
}

/** 找满上限了吗(界面据此把「12」写成「5000+」)。 */
export function isTruncated(matches: { readonly length: number }, limit = FIND_MATCH_LIMIT): boolean {
  return matches.length >= limit;
}

/** 上一个 / 下一个,两头绕回。count 为 0 ⇒ -1;current 不在范围内(比如 -1)时,下一个从 0 起、上一个从末尾起。 */
export function stepMatch(current: number, count: number, dir: 1 | -1): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return dir === 1 ? 0 : count - 1;
  return (current + dir + count) % count;
}

/** 偏移 offset 处或之后的第一处匹配;后面没有了就绕回第一处。无匹配 ⇒ -1。 */
export function matchAtOrAfter(matches: readonly FindMatch[], offset: number): number {
  if (!matches.length) return -1;
  for (let i = 0; i < matches.length; i++) if (matches[i].start >= offset) return i;
  return 0;
}

/** 工具条上的计数:「3/12」「无结果」;没输入查找词时是空串。 */
export function findCountLabel(query: string, current: number, count: number, truncated = false): string {
  if (!query) return '';
  if (count <= 0) return '无结果';
  const total = truncated ? `${count}+` : String(count);
  return `${current >= 0 && current < count ? current + 1 : 0}/${total}`;
}

/** 替换第 index 处。返回新文本,以及替换完之后应该从哪儿继续找(新文本里被替换那段的末尾)。 */
export function replaceMatch(text: string, matches: readonly FindMatch[], index: number, replacement: string): { text: string; resumeAt: number } | null {
  const m = matches[index];
  if (!m || m.end > text.length) return null;
  return { text: text.slice(0, m.start) + replacement + text.slice(m.end), resumeAt: m.start + replacement.length };
}

/** 全部替换(字面,不重叠,一次扫完 —— 替换成含查找词的串也不会死循环)。 */
export function replaceAll(text: string, query: string, replacement: string, opts: { caseSensitive?: boolean } = {}): { text: string; count: number } {
  const ms = findMatches(text, query, { caseSensitive: opts.caseSensitive, limit: Number.POSITIVE_INFINITY });
  if (!ms.length) return { text, count: 0 };
  let out = '';
  let cursor = 0;
  for (const m of ms) { out += text.slice(cursor, m.start) + replacement; cursor = m.end; }
  return { text: out + text.slice(cursor), count: ms.length };
}

// ── 阅读区:渲染出来的文字散在很多文本节点里 ─────────────────────────────────────────

export interface TextSegment {
  readonly text: string;
  /** 所在「段落」的标识:同一段里的相邻节点直接拼接(粗体、行内代码在段中间),不同段之间插一个分隔符。 */
  readonly group: unknown;
}

/** 段与段之间的分隔符。查找词来自单行输入框,永远不含它 ⇒ 匹配不会跨段(表格两格、两段话不会拼出假命中)。 */
export const SEGMENT_BREAK = '\u0000';

/** 把文本节点拼成一整串用来查找;starts[i] = 第 i 个节点在串里的起点。 */
export function joinSegments(segments: readonly TextSegment[]): { text: string; starts: number[] } {
  let text = '';
  const starts: number[] = [];
  for (let i = 0; i < segments.length; i++) {
    if (i > 0 && segments[i].group !== segments[i - 1].group) text += SEGMENT_BREAK;
    starts.push(text.length);
    text += segments[i].text;
  }
  return { text, starts };
}

export interface SegmentPiece {
  readonly segment: number;
  /** 在该文本节点内的起点(含)。 */
  readonly start: number;
  /** 在该文本节点内的终点(不含)。 */
  readonly end: number;
}

/**
 * 一处匹配落在哪几个文本节点的哪几段(「**粗**体」这种会跨节点)。
 * lengths[i] = 第 i 个节点的文字长度;starts 来自 joinSegments。长度为 0 的片段不返回。
 */
export function piecesForMatch(starts: readonly number[], lengths: readonly number[], match: FindMatch): SegmentPiece[] {
  const out: SegmentPiece[] = [];
  for (let i = 0; i < starts.length; i++) {
    const segStart = starts[i];
    const segEnd = segStart + lengths[i];
    if (segEnd <= match.start) continue;
    if (segStart >= match.end) break;
    const start = Math.max(match.start, segStart) - segStart;
    const end = Math.min(match.end, segEnd) - segStart;
    if (end > start) out.push({ segment: i, start, end });
  }
  return out;
}

// ── 阅读 ↔ 编辑切换:保持「当前是第几处」对应到另一边 ────────────────────────────────────

/**
 * 在另一边挑对应的匹配。keys[i] = 另一边第 i 处匹配所在的「块」(按原文行号表示,升序);
 * 要找块 key 里的第 ordinal 处(0 起):
 * - 那块里有 ≥ ordinal+1 处 ⇒ 正好那一处;
 * - 那块里有,但不够 ⇒ 那块的最后一处(渲染和原文的匹配数可能不同,比如 `**` 把词拆开);
 * - 那块里一处都没有 ⇒ 块号 ≥ key 的第一处(往后找);再没有 ⇒ 第 0 处。
 * 另一边没有匹配 ⇒ -1。
 */
export function pickCorresponding(keys: readonly number[], key: number, ordinal: number): number {
  if (!keys.length) return -1;
  let seen = 0;
  let last = -1;
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] !== key) continue;
    if (seen === Math.max(0, ordinal)) return i;
    seen++;
    last = i;
  }
  if (last >= 0) return last;
  for (let i = 0; i < keys.length; i++) if (keys[i] >= key) return i;
  return 0;
}

/** 当前这处在它所在块里是第几处(0 起):数一下它前面有几处 key 相同。 */
export function ordinalInGroup(keys: readonly number[], index: number): number {
  if (index < 0 || index >= keys.length) return 0;
  let n = 0;
  for (let i = 0; i < index; i++) if (keys[i] === keys[index]) n++;
  return n;
}

/**
 * 原文匹配的「块键」:落在 [range.start, range.end] 行内的匹配都归到 range.start,其余用自己的行号。
 * 这样 pickCorresponding(keys, range.start, k) 就能挑出那一块里的第 k 处。
 */
export function sourceKeysForBlock(lines: readonly number[], range: { start: number; end: number }): number[] {
  return lines.map((l) => (l >= range.start && l <= range.end ? range.start : l));
}

/** 每处匹配的起点在第几行(0 起;\r\n、\r、\n 都算一次换行,和 node-rules-view lineAtOffset 一致)。一遍扫完,不是每处从头数。 */
export function matchLines(text: string, matches: readonly FindMatch[]): number[] {
  const out: number[] = [];
  let line = 0;
  let pos = 0;
  for (const m of matches) {
    while (pos < m.start && pos < text.length) {
      const ch = text[pos];
      if (ch === '\n') line++;
      else if (ch === '\r') { line++; if (text[pos + 1] === '\n') pos++; }
      pos++;
    }
    out.push(line);
  }
  return out;
}

// ── 快捷键 ────────────────────────────────────────────────────────────────────

export interface KeyLike {
  readonly key?: string;
  readonly code?: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
}

/**
 * 是不是「打开查找」:macOS 上 ⌘F,其余平台 Ctrl+F。不带 Alt/Shift(⌘⇧F、Ctrl+Alt+F 留给别人)。
 * macOS 上的 Ctrl+F 是 emacs 式「光标右移一格」,不拦。认 key 也认 code(非 QWERTY 布局、输入法下 key 可能不是 f)。
 */
export function isFindShortcut(e: KeyLike, isMac: boolean): boolean {
  const isF = e.key === 'f' || e.key === 'F' || e.code === 'KeyF';
  if (!isF || e.altKey || e.shiftKey) return false;
  return isMac ? !!e.metaKey && !e.ctrlKey : !!e.ctrlKey && !e.metaKey;
}

/** 按 userAgent / platform 判断是不是 macOS(iPadOS 桌面模式也报 Mac,同样用 ⌘)。 */
export function isMacPlatform(platform: string | undefined, userAgent: string | undefined): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(platform || '') || /Mac OS X|Macintosh/i.test(userAgent || '');
}

/** 查找框里的按键 → 动作。IME 组字中(输入中文时按回车选词)一律不算。 */
export type FindKeyAction = 'next' | 'prev' | 'close' | null;
export function findKeyAction(e: KeyLike & { isComposing?: boolean; keyCode?: number }): FindKeyAction {
  if (e.isComposing || e.keyCode === 229) return null;
  if (e.key === 'Escape') return 'close';
  if (e.key === 'Enter') return e.shiftKey ? 'prev' : 'next';
  if (e.key === 'ArrowDown') return 'next';
  if (e.key === 'ArrowUp') return 'prev';
  return null;
}

/** 短哈希(内容变了就换 key 让阅读区重新挂载,把 <mark> 退路留下的 DOM 改动整块丢掉)。 */
export function contentKey(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${text.length}:${(h >>> 0).toString(36)}`;
}
