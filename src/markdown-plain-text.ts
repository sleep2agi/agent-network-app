// Markdown → 气泡里「看得到的字」。只依赖 markdown-model(纯解析),不拉聊天模块 ——
// 列表预览(agent-row-model)也用它;放进 message-plain-text 会把 chat-actions → chat-echo
// 一整串带进来,通知测试的 api mock 就缺函数(#1707 评审)。
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
      case 'image': return `[图片] ${block.alt}`;
      default: return inline(block.text);
    }
  }).join('\n\n');

