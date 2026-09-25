/**
 * 「选择文本」视图用的纯文本(Vincent 2026-09-26,安卓折叠屏:「我复制消息的时候,现在只能复制整个的消息…
 * 我想可以划选择部分段落或者部分句子,然后去复制」)。
 *
 * 为什么要单独一份纯文本:原生端 `<Text selectable>` 的选区只能落在**一个** Text 节点里,而 Markdown 渲染出来
 * 是一串分开的 Text/View(段落、列表项、代码块、表格格子),选区跨不过块边界。微信的做法是长按 →「选择文本」→
 * 打开一个只读的原生文本框,系统选区手柄可以拖过任意段落。这里产出那个文本框里的内容。
 *
 * 取「渲染后的纯文本」而不是 Markdown 原文:用户要复制的是他在气泡里**看到**的句子,不是 `**`、`[..](..)`、
 * `#` 这些记号。例外:
 *   - 代码块逐字保留(缩进、空格、`_`、`*` 一个不改),不加围栏 —— 复制代码时围栏是噪音;
 *   - 链接写成「文字 (URL)」—— 气泡里 URL 藏在文字后面,纯文本里不留就再也拿不到;文字就是 URL 时只写一次;
 *   - 列表保留「•」/「1.」—— 气泡里看得到,且决定了复制出去的结构。
 * 选择视图另有「Markdown 原文」开关给需要原文的人。
 */
import { parseQuoted } from './chat-actions';
import { cleanAttachmentDebugText } from './attachment-display';
import { parseInline, parseMarkdownBlocks, type InlineNode } from './markdown-model';

/** 行内节点 → 可见文字;[文字](链接) 带上 URL,裸链接原样。 */
export const inlineSelectText = (nodes: InlineNode[]): string =>
  nodes.map((n) => {
    if (n.kind === 'strong' || n.kind === 'em') return inlineSelectText(n.children);
    if (n.kind === 'link') return n.text.trim() === n.url.trim() ? n.url : `${n.text} (${n.url})`;
    return n.text;
  }).join('');

const inline = (text: string) => inlineSelectText(parseInline(text));

/** Markdown → 选择视图里的纯文本。块之间空一行,和气泡里的视觉间距一致。 */
export const markdownToPlainText = (source: string): string =>
  parseMarkdownBlocks(source).map((block) => {
    switch (block.kind) {
      case 'code': return block.text;
      case 'heading': return inline(block.text);
      case 'list': return block.items.map((item, i) => `${block.ordered ? `${i + 1}.` : '•'} ${inline(item)}`).join('\n');
      case 'quote': return inline(block.text);
      case 'table': return block.rows.map((row) => row.map(inline).join(' | ')).join('\n');
      default: return inline(block.text);
    }
  }).join('\n\n');

export type SelectTextMode = 'plain' | 'markdown';

/**
 * 一条消息在选择视图里显示的文字。和气泡同一条管线:去掉开头的「@作者: …」引用行、去掉附件调试行;
 * 只有引用没有正文时退回引用本身(与 copyTextOf 一致,别给用户一个空框)。
 */
export const selectableTextOf = (content: string | undefined, mode: SelectTextMode = 'plain'): string => {
  const { quote, body } = parseQuoted(content);
  const cleaned = cleanAttachmentDebugText(body);
  if (!cleaned.trim()) return quote ? (quote.author ? `${quote.author}: ${quote.text}` : quote.text) : '';
  return mode === 'markdown' ? cleaned : markdownToPlainText(cleaned);
};

/**
 * 选择视图用哪种原生控件承载文字(2026-09-26 查过 RN 0.85 源码,不是猜的):
 *   - android → 一个 `<Text selectable>`:ReactTextViewManager.setSelectable → TextView.setTextIsSelectable,
 *     系统选区手柄 + 「复制/全选」浮条,整段文字是**一个**节点所以能跨段落。
 *     🔴 不能用 `<TextInput editable={false}>`:ReactTextInputManager.setEditable 做的是 `view.isEnabled = editable`,
 *     被禁用的 EditText 根本不能选中。
 *   - ios → `<TextInput editable={false} multiline>`:UITextView editable=NO 仍可选区。
 *     🔴 不能用 `<Text selectable>`:RCTParagraphComponentView 的 copy: 拷的是整段 attributedText,没有区间手柄。
 *   - web(桌面壳/手机浏览器)→ TextInput(只读 textarea),鼠标拖选、触屏长按选词都是浏览器原生的。
 */
export type SelectTextSurface = 'selectable-text' | 'readonly-input';
export const selectTextSurface = (os: string): SelectTextSurface => (os === 'android' ? 'selectable-text' : 'readonly-input');

type DomNodeLike = unknown;
type SelectionLike = { isCollapsed?: boolean; anchorNode?: DomNodeLike; focusNode?: DomNodeLike; toString(): string } | null | undefined;
type ContainerLike = { contains?: (node: DomNodeLike) => boolean } | null | undefined;

/**
 * 桌面端右键时:选区的两端都落在这个气泡里才算「这条消息的选中内容」。一端在气泡外(拖到了别的消息上)
 * 就不给「复制选中内容」—— 否则会把两条消息拼在一起当成这一条复制出去。
 */
export const selectedTextWithin = (container: ContainerLike, selection: SelectionLike): string => {
  if (!container?.contains || !selection || selection.isCollapsed) return '';
  if (!selection.anchorNode || !selection.focusNode) return '';
  if (!container.contains(selection.anchorNode) || !container.contains(selection.focusNode)) return '';
  const text = selection.toString();
  return text.trim() ? text : '';
};
