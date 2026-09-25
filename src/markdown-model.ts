// line / endLine:块在原文里的首行、末行(0 起、含末行;\r\n、\r、\n 都算一次换行)。
// itemLines / rowLines:列表每一项、表格每一行各自所在的原文行。规则文件阅读模式「双击跳到源码」用它们
// (2026-09-25 Vincent);聊天渲染不读这些字段。
type SourceSpan = { line?: number; endLine?: number };
export type MarkdownBlock = SourceSpan & (
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; ordered: boolean; items: string[]; itemLines?: number[] }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; language?: string; text: string }
  | { kind: 'table'; rows: string[][]; rowLines?: number[] }
);

const tableCells = (line: string) =>
  line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());

const isTableDivider = (line: string) => {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
};

export const parseMarkdownBlocks = (source: string): MarkdownBlock[] => {
  const lines = (source || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const start = i;
    const fence = line.match(/^\s*```\s*([^\s`]*)\s*$/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push({ kind: 'code', language: fence[1] || undefined, text: body.join('\n'), line: start, endLine: i - 1 });
      continue;
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim(), line: start, endLine: start });
      i++;
      continue;
    }

    if (i + 1 < lines.length && line.includes('|') && isTableDivider(lines[i + 1])) {
      const rows = [tableCells(line)];
      const rowLines = [i];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) { rowLines.push(i); rows.push(tableCells(lines[i++])); }
      blocks.push({ kind: 'table', rows, rowLines, line: start, endLine: i - 1 });
      continue;
    }

    const list = line.match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/);
    if (list) {
      const ordered = !!list[2];
      const items: string[] = [];
      const itemLines: number[] = [];
      while (i < lines.length) {
        const match = lines[i].match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/);
        if (!match || !!match[2] !== ordered) break;
        items.push(match[3]);
        itemLines.push(i);
        i++;
      }
      blocks.push({ kind: 'list', ordered, items, itemLines, line: start, endLine: i - 1 });
      continue;
    }

    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      const body: string[] = [];
      while (i < lines.length) {
        const match = lines[i].match(/^\s*>\s?(.*)$/);
        if (!match) break;
        body.push(match[1]);
        i++;
      }
      blocks.push({ kind: 'quote', text: body.join('\n'), line: start, endLine: i - 1 });
      continue;
    }

    const paragraph = [line];
    i++;
    while (
      i < lines.length && lines[i].trim() &&
      !/^\s*(?:```|#{1,6}\s|>|[-+*]\s|\d+\.\s)/.test(lines[i]) &&
      !(i + 1 < lines.length && lines[i].includes('|') && isTableDivider(lines[i + 1]))
    ) paragraph.push(lines[i++]);
    blocks.push({ kind: 'paragraph', text: paragraph.join('\n'), line: start, endLine: i - 1 });
  }
  return blocks;
};

export const isSafeMarkdownUrl = (url: string) => /^https?:\/\//i.test(url.trim());

// ── 行内解析 ────────────────────────────────────────────────────────────────────
// 0.2.100(Vincent 2026-09-25 安卓截图):聊天里一条裸 URL
//   https://…/desktop/0.2.99/Agent.Network_0.2.99_android-universal.apk
// 渲染成「Agent.Network0.2.99android-universal.apk」且 0.2.99 变斜体。两个根因:
//   1) 旧的行内正则 `_([^_\n]+)_` 不看左右是什么字符,词中间的 `_` 也当强调符 —— CommonMark 规定
//      左右都是字母数字的 `_` 既不能开也不能关强调(snake_case 必须原样);
//   2) 没有裸链接识别,URL 只是普通文字,里面的 `_`/`*` 照样被当记号吃掉,也点不开。
// 现在:先切出「原子段」(行内代码、[文字](链接)、<链接>、裸链接),原子段里一个记号都不解析;
// 再在原子段之间按 CommonMark 的侧翼规则配对 `*`/`_`/`**`/`__`。
export type InlineNode =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; children: InlineNode[] }
  | { kind: 'em'; children: InlineNode[] }
  | { kind: 'link'; text: string; url: string }
  | { kind: 'autolink'; text: string; url: string };

type Atom = { start: number; end: number; node: InlineNode };

const isAsciiAlnum = (ch: string | undefined) => !!ch && /[A-Za-z0-9]/.test(ch);
const isSpace = (ch: string | undefined) => ch === undefined || /\s/.test(ch);

// URL 在第一个 CJK 字符 / 全角标点处结束(GFM 没有这条,是我们加的:中文里 URL 后面常常直接跟字)。
// 覆盖:CJK 部首/符号/标点(。、「」)、平假名片假名、CJK 统一表意文字、谚文、兼容表意、竖排/小写变体、
// 全角 ASCII 与半角片假名(，）：！？),以及弯引号和省略号(“”‘’…)。
const CJK_STOP = /[‘-‟…⺀-鿿ꥠ-꥿가-퟿豈-﫿︐-︟︰-﹯＀-￯]/;
export const isCjkStop = (ch: string | undefined) => !!ch && CJK_STOP.test(ch);

// 「词字符」:决定 `_` 是否在词中间。ASCII 字母数字 + 非 ASCII 的非空白、非 CJK 标点字符
// (CommonMark 里汉字也是字母,所以 `中_文_字` 也不是强调)。不用 \p{L}:要照顾 Hermes。
const isWordChar = (ch: string | undefined) => {
  if (!ch) return false;
  if (isAsciiAlnum(ch)) return true;
  if (ch.charCodeAt(0) < 0x80 || /\s/.test(ch)) return false;
  return !/[‘-‟…　-〿︐-︟︰-﹯！-／：-＠［-｀｛-･]/.test(ch);
};

// GFM 扩展自动链接末尾不算进 URL 的标点(再加引号和分号)。`)`/`]` 只在不配对时剥掉。
const TRAILING_PUNCT = /[?!.,:*_~'";]/;
const countOf = (s: string, ch: string) => s.split(ch).length - 1;

/** 从 at 开始识别一个裸链接(http(s):// 或 www.),返回 URL 在原文里的结束位置;不是链接返回 -1。 */
export const matchBareUrl = (text: string, at: number): number => {
  const head = text.slice(at, at + 8).toLowerCase();
  const scheme = head.startsWith('https://') ? 8 : head.startsWith('http://') ? 7 : head.startsWith('www.') ? 4 : 0;
  if (!scheme) return -1;
  // 前面紧贴字母数字(如 `xhttps://`、`awww.`)不算链接开头;中文、标点、空白后面都可以。
  if (isAsciiAlnum(text[at - 1])) return -1;
  let end = at + scheme;
  while (end < text.length) {
    const ch = text[end];
    if (/\s/.test(ch) || ch === '<' || ch === '`' || isCjkStop(ch)) break;
    end++;
  }
  // 末尾剥标点 / 不配对的右括号,直到稳定
  for (;;) {
    const last = text[end - 1];
    const body = text.slice(at, end);
    if (TRAILING_PUNCT.test(last)) { end--; continue; }
    if (last === ')' && countOf(body, ')') > countOf(body, '(')) { end--; continue; }
    if (last === ']' && countOf(body, ']') > countOf(body, '[')) { end--; continue; }
    break;
  }
  // scheme 后面至少要有一个字母数字(`https://` 本身、`www.` 本身都不是链接)
  return isAsciiAlnum(text[at + scheme]) && end > at + scheme ? end : -1;
};

const atomAt = (text: string, i: number): Atom | null => {
  const ch = text[i];
  if (ch === '`') {
    const close = text.indexOf('`', i + 1);
    const nl = text.indexOf('\n', i + 1);
    if (close > i + 1 && (nl === -1 || close < nl)) return { start: i, end: close + 1, node: { kind: 'code', text: text.slice(i + 1, close) } };
    return null;
  }
  if (ch === '[') {
    const m = text.slice(i).match(/^\[([^\]\n]+)\]\(([^\s)]+)\)/);
    if (m) return { start: i, end: i + m[0].length, node: { kind: 'link', text: m[1], url: m[2] } };
    return null;
  }
  if (ch === '<') {
    const m = text.slice(i).match(/^<(https?:\/\/[^\s<>]+)>/i);
    if (m) return { start: i, end: i + m[0].length, node: { kind: 'autolink', text: m[1], url: m[1] } };
    return null;
  }
  if (ch === 'h' || ch === 'H' || ch === 'w' || ch === 'W') {
    const end = matchBareUrl(text, i);
    if (end > 0) {
      const url = text.slice(i, end);
      return { start: i, end, node: { kind: 'autolink', text: url, url: /^www\./i.test(url) ? `http://${url}` : url } };
    }
  }
  return null;
};

// CommonMark 侧翼规则(简化):开符后面不能是空白,闭符前面不能是空白;
// `_` 另外要求开符前面、闭符后面不是词字符(词中间的 `_` 不开不关)。`*` 词中间照常可用。
const canOpen = (text: string, i: number, len: number, ch: string) =>
  !isSpace(text[i + len]) && (ch !== '_' || !isWordChar(text[i - 1]));
const canClose = (text: string, j: number, len: number, ch: string) =>
  !isSpace(text[j - 1]) && (ch !== '_' || !isWordChar(text[j + len]));

const runLength = (text: string, i: number, ch: string) => { let n = 0; while (text[i + n] === ch) n++; return n; };

/** 行内 Markdown → 节点树。原子段(代码/链接/裸链接)里不解析任何强调记号。 */
export const parseInline = (text: string): InlineNode[] => {
  const src = text || '';
  const atoms: Atom[] = [];
  for (let i = 0; i < src.length;) {
    const atom = atomAt(src, i);
    if (atom) { atoms.push(atom); i = atom.end; } else i++;
  }
  const atomStartingAt = new Map(atoms.map(a => [a.start, a]));

  const build = (from: number, to: number): InlineNode[] => {
    const out: InlineNode[] = [];
    let buf = '';
    const flush = () => { if (buf) { out.push({ kind: 'text', text: buf }); buf = ''; } };
    let i = from;
    while (i < to) {
      const atom = atomStartingAt.get(i);
      if (atom && atom.end <= to) { flush(); out.push(atom.node); i = atom.end; continue; }
      const ch = src[i];
      if (ch === '*' || ch === '_') {
        const run = runLength(src, i, ch);
        const len = run >= 2 ? 2 : 1;
        if (canOpen(src, i, len, ch)) {
          const delim = ch.repeat(len);
          let close = -1;
          for (let j = i + len; j + len <= to; j++) {
            if (src[j] === '\n') break;
            // 闭符不能落在原子段里:碰到原子段整段跳过(包括紧跟开符的那一段)
            const skip = atomStartingAt.get(j);
            if (skip) { j = skip.end - 1; continue; }
            if (j === i + len || !src.startsWith(delim, j)) continue;   // 内容不能为空
            // 单个记号的闭符不能是一串 `**` 的一部分(`*a **b** c*` 里的 `**` 不关外层斜体)
            if (len === 1 && (src[j + 1] === ch || src[j - 1] === ch)) continue;
            if (canClose(src, j, len, ch)) { close = j; break; }
          }
          if (close > 0) {
            flush();
            out.push({ kind: len === 2 ? 'strong' : 'em', children: build(i + len, close) });
            i = close + len;
            continue;
          }
        }
        // 配不上对:整串记号原样当文字(不把 `__` 拆成两个单 `_` 再试)
        buf += src.slice(i, i + run);
        i += run;
        continue;
      }
      buf += ch;
      i++;
    }
    flush();
    return out;
  };
  return build(0, src.length);
};

/** 节点树 → 纯文本(强调记号去掉,链接只留文字,裸链接留 URL 原样)。 */
export const inlinePlainText = (nodes: InlineNode[]): string =>
  nodes.map(n => (n.kind === 'strong' || n.kind === 'em' ? inlinePlainText(n.children) : n.text)).join('');
