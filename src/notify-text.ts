// 0.2.81(Vincent 2026-09-20,截图里的系统通知正文):
//   [API-UAT-SGC-NETWORK-REPORT-20260920.md](/data/workspaces/agent…
// 通知里塞的是 Markdown 原文——链接语法和一长串绝对路径都被原样读出来,而 toast 只有两三行。
// 这里把它压成给人看的一行纯文本:链接只留标签、代码块只留语言名、表格/标题去掉记号。
//
// 🔴 块级结构复用 markdown-model 的 parseMarkdownBlocks(仓里唯一的 Markdown 解析器),
//    本模块只补一层**行内**记号的剥离——仓里此前没有行内剥离器(MarkdownMessage 是直接渲染,
//    不产出纯文本),所以这一层是新的,而不是第三份块解析。
import { parseMarkdownBlocks, type MarkdownBlock } from './markdown-model';

/** 行内记号 → 纯文本。顺序承重:图片要在链接之前,否则 `![x](y)` 的 `!` 会被留下。 */
export function stripInlineMarkdown(text: string): string {
  return (text || '')
    // 图片 ![alt](url) → alt(没有 alt 就整个丢掉,URL 不进通知)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    // 链接 [label](url) → label
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // 行内代码 `x` → x
    .replace(/`([^`]*)`/g, '$1')
    // 粗体/斜体/删除线的成对记号
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .trim();
}

/** 一个块压成一行。给通知用,所以宁可丢信息也不要长。 */
function blockToLine(block: MarkdownBlock): string {
  if (block.kind === 'code') return block.language ? `［${block.language} 代码］` : '［代码］';
  if (block.kind === 'list') return block.items.map(stripInlineMarkdown).filter(Boolean).join('；');
  if (block.kind === 'table') {
    const head = block.rows[0]?.map(stripInlineMarkdown).filter(Boolean) ?? [];
    return head.length ? `［表格：${head.join(' / ')}］` : '［表格］';
  }
  return stripInlineMarkdown(block.text);
}

/**
 * Markdown → 通知正文。
 *
 * 取前面几个块拼成一行(单块常常只是个标题,信息太少),压掉所有空白,超长截断加省略号。
 * max 是**字符数**(Array.from,别用 length——中文/emoji 会被算错)。
 */
export function plainTextForNotification(source: unknown, max = 80): string {
  const raw = typeof source === 'string' ? source : '';
  if (!raw.trim()) return '';
  const lines: string[] = [];
  for (const block of parseMarkdownBlocks(raw)) {
    const line = blockToLine(block).replace(/\s+/g, ' ').trim();
    if (line) lines.push(line);
    if (lines.join(' ').length > max * 2) break;   // 够截断了,不必解析完整篇
  }
  const joined = lines.join(' ').replace(/\s+/g, ' ').trim();
  if (!joined) return '';
  const chars = Array.from(joined);
  return chars.length > max ? chars.slice(0, max).join('') + '…' : joined;
}
