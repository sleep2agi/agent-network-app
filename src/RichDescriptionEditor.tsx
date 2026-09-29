// 任务描述的所见即所得编辑(桌面壳 / 网页,鼠标界面)。owner 09-30:「富文本的直接编辑,不需要点到 Markdown 里面去编辑,
// 但是它底层还是存的是 Markdown」—— 像 Typora / 飞书文档那样直接改标题、列表、加粗、链接、代码块、图片、复选框。
//
//   · 引擎:TipTap 3(ProseMirror)+ @tiptap/markdown。读写 Markdown 的扩展表、parse / serialize 都在 rich-markdown.ts,
//     和 rich-markdown.test.ts 的语料往返测试是同一份 —— 测到的就是这里保存时写的字节。
//   · 打开不改不写:只有用户真改了文档才回调;改完又改回去时交回打开时的原文(sameAsOpened)。
//   · Markdown 快捷输入:`## ` 标题、`- ` 列表、`1. ` 编号、`[ ] ` 复选框、`**粗**`、``` 代码块、`> ` 引用、
//     `[文字](网址)` 链接;选中文字再粘贴网址 = 加链接。工具条给不熟 Markdown 的人。
//   · 粘贴:截图 / 图片文件交给详情上传(同 #502 那条路);纯文字按 Markdown 读进来(agent 回的 Markdown 直接贴)。
//   · 图片:Hub 图片 `/api/files/<id>` 在桌面壳里带 Authorization 下载成 blob 显示(地址里不放 token);纯网页只显示名字。
//     双击看大图。
//   · 链接不点开(桌面壳里点一下会把整个 webview 导航走)。
//   · 只经 rich-support.web.tsx 懒加载(单独的包):TipTap / ProseMirror 不进主包,也不进原生包。
import { createElement, useEffect, useReducer, useRef, useState, type MutableRefObject } from 'react';
import { Editor, type JSONContent } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extensions';
import { colors, onThemeChange, radius, spacing } from './theme';
import { uiScale } from './ui-scale';
import { t } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-tasks';
import { appFetch } from './app-fetch';
import { downloadImageObjectUrl } from './web-image-download';
import { filesFromTransfer, transferHasFiles } from './desktop-file-intake';
import { RULES_READ_MAX_WIDTH } from './rules-fullscreen-layout';
import { richExtensions, richFromMarkdown, richToMarkdown, sameAsOpened } from './rich-markdown';
import type { RichDescriptionEditorProps } from './rich-editor-types';

const HUB_FILE = /^\/api\/files\/([A-Za-z0-9_-]{1,80})$/;

type ImageCtx = RichDescriptionEditorProps['images'] & { open: (fileId: string, objectUrl?: string) => void };

// Markdown 读写规则和 rich-markdown.ts 的 Image 一样,只换显示:Hub 图片带鉴权下载。
function authedImage(ctx: MutableRefObject<ImageCtx>) {
  return Image.extend({
    addNodeView() {
      return ({ node }) => {
        const doc = (globalThis as any).document as Document;
        const dom = doc.createElement('div');
        dom.className = 'rt-img';
        dom.contentEditable = 'false';
        const src = String(node.attrs.src || '');
        const alt = String(node.attrs.alt || '');
        const hub = HUB_FILE.exec(src);
        const c = ctx.current;
        let objectUrl: string | undefined;
        let live = true;
        const label = () => {
          const span = doc.createElement('span');
          span.className = 'rt-img-label';
          span.textContent = `[${t('tasks.copy.124')}] ${alt}`;
          dom.appendChild(span);
        };
        if (hub && !c.authed) label();
        else {
          const img = doc.createElement('img');
          img.alt = alt;
          img.draggable = false;
          dom.appendChild(img);
          if (hub) {
            downloadImageObjectUrl(appFetch, `${c.serverUrl}${src}`, c.token, alt || 'image')
              .then(url => { if (live) { objectUrl = url; img.src = url; } else URL.revokeObjectURL(url); })
              .catch(() => { img.remove(); label(); });
          } else img.src = src;
        }
        if (hub) dom.addEventListener('dblclick', () => ctx.current.open(hub[1], objectUrl));
        dom.setAttribute('data-testid', hub ? `req-description-rich-image-${hub[1]}` : 'req-description-rich-image');
        return {
          dom,
          ignoreMutation: () => true,
          destroy: () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); },
        };
      };
    },
  });
}

const STYLE_ID = 'rich-description-editor-style';
// 编辑区的排版。颜色走 CSS 变量(由外框按当前主题写进去),主题切换不用重建样式表。
// 顶层块之间的间距(.rt-body.rt-body > * + *)把 .rt-body 写两遍抬高优先级,盖过各块自己的 margin: 0。
const CSS = `
.rt-body { outline: none; color: var(--rt-text); font-size: var(--rt-size); line-height: 1.55; overflow-wrap: anywhere; word-break: break-word; white-space: pre-wrap; }
.rt-full .rt-body { max-width: ${RULES_READ_MAX_WIDTH}px; margin: 0 auto; min-height: 100%; }
.rt-body p { margin: 0; }
.rt-body h1, .rt-body h2, .rt-body h3, .rt-body h4, .rt-body h5, .rt-body h6 { margin: 0.9em 0 0.2em; font-weight: 600; line-height: 1.3; }
.rt-body > :first-child { margin-top: 0; }
.rt-body h1 { font-size: 1.6em; } .rt-body h2 { font-size: 1.35em; } .rt-body h3 { font-size: 1.15em; } .rt-body h4, .rt-body h5, .rt-body h6 { font-size: 1em; }
.rt-body ul, .rt-body ol { margin: 0; padding-left: 1.5em; }
.rt-body li > p { margin: 0; }
.rt-body li + li { margin-top: 0.15em; }
.rt-body ul[data-type="taskList"] { list-style: none; padding-left: 0.2em; }
.rt-body ul[data-type="taskList"] ul[data-type="taskList"] { padding-left: 1.4em; }
.rt-body ul[data-type="taskList"] > li { display: flex; align-items: flex-start; gap: 0.5em; }
.rt-body ul[data-type="taskList"] > li > label { flex: 0 0 auto; user-select: none; margin-top: 0.2em; }
.rt-body ul[data-type="taskList"] > li > label input { width: 1em; height: 1em; margin: 0; accent-color: var(--rt-accent); cursor: pointer; }
.rt-body ul[data-type="taskList"] > li > div { flex: 1 1 auto; min-width: 0; }
.rt-body ul[data-type="taskList"] > li[data-checked="true"] > div { color: var(--rt-muted); text-decoration: line-through; }
.rt-body blockquote { margin: 0; padding-left: 0.9em; border-left: 3px solid var(--rt-muted); color: var(--rt-secondary); }
.rt-body code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.92em; color: var(--rt-accent); background: var(--rt-code-bg); border-radius: ${radius.mark}px; padding: 0.05em 0.3em; }
.rt-body pre { margin: 0; background: var(--rt-code-bg); border-radius: ${radius.item}px; padding: ${spacing.md}px; overflow-x: auto; white-space: pre; }
.rt-body pre code { color: var(--rt-text); background: none; padding: 0; font-size: 0.86em; line-height: 1.5; }
.rt-body a { color: var(--rt-accent); text-decoration: underline; cursor: text; }
.rt-body hr { border: none; border-top: 1px solid var(--rt-border); margin: 0.8em 0; }
.rt-body table { border-collapse: collapse; margin: 0; max-width: 100%; }
.rt-body th, .rt-body td { border: 1px solid var(--rt-border); padding: 4px 8px; vertical-align: top; min-width: 3em; }
.rt-body th { background: var(--rt-code-bg); font-weight: 600; text-align: left; }
.rt-body th p, .rt-body td p { margin: 0; }
.rt-body .selectedCell { background: var(--rt-select); }
.rt-body.rt-body > * + * { margin-top: 0.6em; }
.rt-body.rt-body > :is(h1, h2, h3, h4, h5, h6) + * { margin-top: 0.3em; }
.rt-body.rt-body > * + :is(h1, h2, h3, h4, h5, h6) { margin-top: 1em; }
.rt-body .rt-img { display: block; margin: 0.4em 0; }
.rt-body .rt-img img { display: block; max-width: min(100%, 480px); max-height: 360px; border-radius: ${radius.item}px; border: 1px solid var(--rt-border); cursor: zoom-in; }
.rt-body .rt-img-label { color: var(--rt-muted); }
.rt-body .ProseMirror-selectednode .rt-img img, .rt-body .rt-img.ProseMirror-selectednode img { outline: 2px solid var(--rt-accent); outline-offset: 1px; }
.rt-body p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: var(--rt-muted); float: left; height: 0; pointer-events: none; }
.rt-tool { height: 26px; min-width: 24px; padding: 0 5px; border: none; border-radius: ${radius.item}px; background: transparent; color: var(--rt-secondary); font: inherit; font-size: 12px; cursor: pointer; }
.rt-tool:hover { background: var(--rt-hover); }
.rt-tool[aria-pressed="true"] { background: var(--rt-select); color: var(--rt-text); }
.rt-tool:focus-visible { outline: 2px solid var(--rt-accent); outline-offset: 1px; }
`;

function ensureStyle() {
  const doc = (globalThis as any).document as Document | undefined;
  if (!doc || doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  doc.head.appendChild(el);
}

type Tool = { key: string; label: string; a11y: string; run: (e: Editor) => void; active: (e: Editor) => boolean };

// 每次渲染现取(切换语言后提示跟着换)。
const tools = (): Tool[][] => [
  [1, 2, 3].map(level => ({
    key: `h${level}`, label: `H${level}`, a11y: t('taskDesc.richHeading', { level }),
    run: e => { e.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 }).run(); },
    active: e => e.isActive('heading', { level }),
  })),
  [
    { key: 'bold', label: 'B', a11y: t('taskDesc.richBold'), run: e => { e.chain().focus().toggleBold().run(); }, active: e => e.isActive('bold') },
    { key: 'italic', label: 'I', a11y: t('taskDesc.richItalic'), run: e => { e.chain().focus().toggleItalic().run(); }, active: e => e.isActive('italic') },
    { key: 'code', label: '`', a11y: t('taskDesc.richCode'), run: e => { e.chain().focus().toggleCode().run(); }, active: e => e.isActive('code') },
  ],
  [
    { key: 'bullet', label: '•', a11y: t('taskDesc.richBullet'), run: e => { e.chain().focus().toggleBulletList().run(); }, active: e => e.isActive('bulletList') },
    { key: 'ordered', label: '1.', a11y: t('taskDesc.richOrdered'), run: e => { e.chain().focus().toggleOrderedList().run(); }, active: e => e.isActive('orderedList') },
    { key: 'task', label: '☑', a11y: t('taskDesc.richTask'), run: e => { e.chain().focus().toggleTaskList().run(); }, active: e => e.isActive('taskList') },
    { key: 'quote', label: '❝', a11y: t('taskDesc.richQuote'), run: e => { e.chain().focus().toggleBlockquote().run(); }, active: e => e.isActive('blockquote') },
    { key: 'codeBlock', label: '{ }', a11y: t('taskDesc.richCodeBlock'), run: e => { e.chain().focus().toggleCodeBlock().run(); }, active: e => e.isActive('codeBlock') },
  ],
];

// 粘贴进来的纯文字按 Markdown 读:只有一段时插它的行内内容(不在光标处劈开段落)。
function pastedContent(text: string): JSONContent[] {
  const doc = richFromMarkdown(text.replace(/\r\n?/g, '\n'));
  const blocks = doc.content ?? [];
  if (blocks.length === 1 && blocks[0].type === 'paragraph') return blocks[0].content ?? [];
  return blocks;
}

export default function RichDescriptionEditor({ value, onChange, placeholder, handleRef, onFiles, onOpenImage, images, variant, testID }: RichDescriptionEditorProps) {
  useTranslation();
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const [focused, setFocused] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const cb = useRef({ onChange, onFiles });
  cb.current = { onChange, onFiles };
  const imageCtx = useRef<ImageCtx>({ ...images, open: onOpenImage });
  imageCtx.current = { ...images, open: onOpenImage };
  // 打开时的原文和它的规范化结果;编辑器交出去的最后一个值(父组件回传同一个值时不重设内容)。
  const opened = useRef({ original: value, baseline: '' });
  const emitted = useRef(value);

  useEffect(() => onThemeChange(() => rerender()), []);

  useEffect(() => {
    ensureStyle();
    const host = hostRef.current;
    if (!host) return;
    const editor = new Editor({
      element: host,
      extensions: richExtensions({ image: authedImage(imageCtx), extra: [Placeholder.configure({ placeholder })], checkboxLabel: text => t('taskDesc.richCheckbox', { text }) }),
      content: richFromMarkdown(value),
      editorProps: {
        attributes: { class: 'rt-body', 'data-testid': `${testID}-content`, role: 'textbox', 'aria-multiline': 'true', 'aria-label': t('tasks.copy.131') },
        handlePaste: (view, event) => {
          const files = filesFromTransfer(event.clipboardData as any);
          if (files.length) { event.preventDefault(); cb.current.onFiles(files); return true; }
          const dt = event.clipboardData;
          if (!dt || dt.types.includes('text/html') || view.state.selection.$from.parent.type.spec.code) return false;
          const text = dt.getData('text/plain');
          if (!text) return false;
          event.preventDefault();
          editor.chain().focus().insertContent(pastedContent(text)).run();
          return true;
        },
        handleDrop: (view, event) => {
          const files = filesFromTransfer((event as DragEvent).dataTransfer as any);
          setDragOver(false);
          if (!files.length) return false;
          event.preventDefault();
          const at = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY });
          if (at) editor.commands.setTextSelection(at.pos);
          cb.current.onFiles(files);
          return true;
        },
        handleDOMEvents: {
          dragover: (_view, event) => { if (transferHasFiles((event as DragEvent).dataTransfer as any)) setDragOver(true); return false; },
          dragleave: () => { setDragOver(false); return false; },
        },
      },
    });
    editorRef.current = editor;
    opened.current = { original: value, baseline: richToMarkdown(editor.getJSON()) };
    emitted.current = value;
    editor.on('update', () => {
      const md = sameAsOpened(richToMarkdown(editor.getJSON()), opened.current);
      emitted.current = md;
      cb.current.onChange(md);
    });
    editor.on('transaction', () => rerender());
    editor.on('focus', () => setFocused(true));
    editor.on('blur', () => setFocused(false));
    handleRef.current = {
      insertText: (text, focus) => {
        const chain = editor.chain();
        (focus ? chain.focus() : chain).insertContent(text).run();
      },
      insertImage: (src, alt) => { editor.chain().insertContent({ type: 'image', attrs: { src, alt } }).run(); },
      focus: () => { editor.commands.focus(); },
    };
    return () => {
      handleRef.current = null;
      editorRef.current = null;
      editor.destroy();
    };
    // 编辑器只建一次;之后外面的值变了走下面那个 effect。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外面换了值(不是编辑器自己交出去的那个):重设内容,并把它当成新的「打开时的原文」。
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || value === emitted.current) return;
    editor.commands.setContent(richFromMarkdown(value), { emitUpdate: false });
    opened.current = { original: value, baseline: richToMarkdown(editor.getJSON()) };
    emitted.current = value;
  }, [value]);

  const editor = editorRef.current;
  const full = variant === 'full';
  const vars = {
    '--rt-text': colors.text, '--rt-secondary': colors.textSecondary, '--rt-muted': colors.textMuted, '--rt-accent': colors.accent,
    '--rt-border': colors.border, '--rt-code-bg': full ? colors.inputBg : colors.bg, '--rt-hover': colors.rowHover, '--rt-select': colors.accent + '26',
    '--rt-size': `${Math.round(14 * uiScale().fontMultiplier * 10) / 10}px`,
  } as Record<string, string>;
  const frame = {
    ...vars,
    display: 'flex', flexDirection: 'column', minWidth: 0, boxSizing: 'border-box',
    borderWidth: 1, borderStyle: 'solid', borderColor: dragOver || focused ? colors.accent : colors.border,
    borderRadius: radius.control,
    backgroundColor: dragOver ? colors.accent + '10' : full ? colors.bg : colors.inputBg,
    ...(full ? { flex: 1, minHeight: 0, overflow: 'hidden' } : { minHeight: 140 }),
  };
  const toolbar = createElement('div', {
    role: 'toolbar', 'aria-label': t('taskDesc.richToolbar'), 'data-testid': `${testID}-toolbar`,
    // 全屏:工具条和居中的正文左边对齐。
    style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, padding: `${spacing.xs}px ${spacing.sm}px`, ...(full ? { paddingLeft: `max(${spacing.sm}px, calc((100% - ${RULES_READ_MAX_WIDTH}px) / 2 - 5px))` } : null), borderBottom: `1px solid ${colors.border}` },
  }, tools().map((group, gi) => [
    gi ? createElement('span', { key: `sep${gi}`, 'aria-hidden': true, style: { width: 1, height: 16, margin: '0 3px', background: colors.border } }) : null,
    ...group.map(tool => createElement('button', {
      key: tool.key, type: 'button', className: 'rt-tool', title: tool.a11y, 'aria-label': tool.a11y,
      'aria-pressed': editor ? String(tool.active(editor)) : 'false', 'data-testid': `${testID}-tool-${tool.key}`,
      style: tool.key === 'bold' ? { fontWeight: 700 } : tool.key === 'italic' ? { fontStyle: 'italic' } : undefined,
      // 按下不抢焦点:选区留在编辑器里,命令作用在选中的文字上。
      onMouseDown: (e: any) => e.preventDefault(),
      onClick: () => { if (editorRef.current) tool.run(editorRef.current); },
    }, tool.label)),
  ]));
  const body = createElement('div', {
    ref: hostRef,
    className: full ? 'rt-full' : undefined,
    onClick: (e: any) => { if (e.target === e.currentTarget) editorRef.current?.commands.focus('end'); },
    style: full
      ? { flex: 1, minHeight: 0, overflowY: 'auto', padding: spacing.lg, cursor: 'text' }
      : { flex: 1, padding: `${spacing.sm}px ${spacing.md}px`, cursor: 'text' },
  });
  return createElement('div', { 'data-testid': testID, style: frame }, toolbar, body);
}
