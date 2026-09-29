// 任务描述「所见即所得」编辑的 Markdown 往返:纯逻辑(不 import react-native / DOM,rich-markdown.test.ts 直接引)。
// 编辑器(RichDescriptionEditor.web.tsx)和测试用同一份扩展表、同一个 parse / serialize ——
// 测试量到的就是编辑器保存时会写的字节。
//
// 底层仍然存 Markdown(agent 读写的就是它)。往返的约定:
//   1. 打开不改 → 一个字节都不写:编辑器只在用户真改了文档时回调,且「改完又改回去」时交回原文(sameAsOpened)。
//   2. 真改了 → 整篇按下面这套规范重写。规范化只在「改过」时发生,并且幂等(再开再存不再变)。
//      已知的规范化(测试逐条钉住):
//        * / + 列表 → -        _斜体_ / __粗__ → *斜体* / **粗**      ~~~ 围栏 → ```
//        1) → 1.               Setext 标题 → # 标题                    表格按列宽补空格
//        裸网址 / <网址> → <网址>                                        连续空行 → 一个空行
//        字面的 * _ 会加反斜杠(5\*3、a\_b)                              首尾空行去掉、\r\n → \n
//   3. 富文本表示不了的内容(原样 HTML、引用式链接定义……)→ 不进所见即所得,只开源码(richSafety)。
//      判据:marked 词法里有 html 词元,或往返后「文字」(字母 / 数字 / 汉字)序列变了 —— 文字变了就是丢了东西。
import { getSchema, type AnyExtension, type JSONContent } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { MarkdownManager } from '@tiptap/markdown';

/**
 * 序列化之后的两处整理(围栏代码块里一律不动):
 *   · 文字就是地址的链接 `[地址](地址)` → `<地址>`。默认写法把地址写两遍;裸网址后面紧跟汉字时也不安全
 *     (GFM 会把汉字吞进网址)—— 尖括号两种都避开,再读回来还是同一个链接。
 *     (链接是 mark,序列化器只拿开 / 合标记、看不到文字,没法在扩展里改,只能在这里改。)
 *   · 表格前后会多出空行:三个以上的换行收成一个空行。
 */
function tidy(markdown: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  let blank = 0;
  for (const line of markdown.split('\n')) {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      out.push(line);
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !line.trim().slice(m[1].length).trim()) fence = null;
      continue;
    }
    if (m) fence = m[1];
    if (!line.trim()) { if (++blank > 1) continue; } else blank = 0;
    out.push(fence ? line : line.replace(/(?<!\\)\[((?:https?:\/\/|mailto:)[^\s<>\[\]()]+)\]\(\1\)/gi, '<$1>'));
  }
  return out.join('\n');
}

/**
 * 编辑器和测试共用的扩展表。image 可以换成带「鉴权下载」节点视图的版本(编辑器里),
 * 但 Markdown 的读写规则必须和这里的 Image 一样(只扩展 addNodeView)。
 */
export function richExtensions(opts: { image?: AnyExtension; extra?: AnyExtension[]; checkboxLabel?: (text: string, checked: boolean) => string } = {}): AnyExtension[] {
  return [
    // 链接不点开:桌面壳里点一下会把整个 webview 导航走。
    StarterKit.configure({ link: false }),
    Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, markdownLinks: true }),
    TaskList,
    TaskItem.configure({ nested: true, ...(opts.checkboxLabel ? { a11y: { checkboxLabel: (node, checked) => opts.checkboxLabel!(node.textContent, checked) } } : {}) }),
    opts.image ?? Image,
    TableKit,
    ...(opts.extra ?? []),
  ];
}

const shared = (() => {
  let cache: { manager: MarkdownManager; schema: ReturnType<typeof getSchema> } | null = null;
  return () => {
    if (!cache) {
      const extensions = richExtensions();
      cache = { manager: new MarkdownManager({ extensions }), schema: getSchema(extensions) };
    }
    return cache;
  };
})();

/** 文档的 JSON → 存盘的 Markdown(首尾空行去掉;空文档是空串)。 */
export function richToMarkdown(doc: JSONContent, manager: MarkdownManager = shared().manager): string {
  return tidy(manager.serialize(doc).replace(/\r\n?/g, '\n')).replace(/^\n+/, '').replace(/\n+$/, '');
}

/** Markdown → 编辑器文档的 JSON(过一遍 schema,和编辑器装载时一样:schema 放不下的会在这里被丢掉 / 改形)。 */
export function richFromMarkdown(markdown: string): JSONContent {
  const { manager, schema } = shared();
  return PMNode.fromJSON(schema, manager.parse(markdown)).toJSON();
}

/** 打开 → 什么都不改 → 保存 会写出的 Markdown(= 规范化后的样子)。 */
export function richRoundTrip(markdown: string): string {
  return richToMarkdown(richFromMarkdown(markdown));
}

/** 只留「文字」:字母、数字、汉字等。标点、空白、Markdown 记号都不算 —— 规范化只动这些。 */
export function textSignature(markdown: string): string {
  return (markdown.match(/[\p{L}\p{N}]+/gu) ?? []).join('');
}

function hasHtml(markdown: string): boolean {
  const walk = (tokens: any[] | undefined): boolean => (tokens ?? []).some(tok =>
    tok.type === 'html' || walk(tok.tokens) || walk(tok.items) || (tok.rows ?? []).some((r: any[]) => r.some(c => walk(c.tokens))) || (tok.header ?? []).some((c: any) => walk(c.tokens)));
  return walk(shared().manager.instance.lexer(markdown) as any[]);
}

export type RichSafety = { ok: true } | { ok: false; reason: 'html' | 'lossy' };

/** 这段 Markdown 能不能进所见即所得(进不了就只开源码,不冒丢内容的险)。 */
export function richSafety(markdown: string): RichSafety {
  if (!markdown.trim()) return { ok: true };
  try {
    if (hasHtml(markdown)) return { ok: false, reason: 'html' };
    if (textSignature(richRoundTrip(markdown)) !== textSignature(markdown)) return { ok: false, reason: 'lossy' };
  } catch {
    return { ok: false, reason: 'lossy' };
  }
  return { ok: true };
}

/**
 * 编辑器每次文档变化后决定交给详情的值:规范化结果等于「刚打开时的规范化结果」(没改,或改了又改回去)
 * → 交回打开时的原文,一个字节都不变,详情也就不会认为有修改;否则交新的 Markdown。
 */
export function sameAsOpened(serialized: string, opened: { original: string; baseline: string }): string {
  return serialized === opened.baseline ? opened.original : serialized;
}
