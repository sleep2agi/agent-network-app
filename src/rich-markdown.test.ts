// 任务描述所见即所得的 Markdown 往返(rich-markdown.ts)。ck 风格自执行。
// 编辑器保存时写的就是 richToMarkdown(文档),打开时读的就是 richFromMarkdown(原文) —— 这里测的是同一条管道。
import { existsSync, readFileSync } from 'node:fs';
import { richFromMarkdown, richRoundTrip, richSafety, richToMarkdown, sameAsOpened, textSignature } from './rich-markdown';
import type { JSONContent } from '@tiptap/core';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}${extra ? ` (${extra})` : ''}`); };
const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');

// 真实形状的描述:三段式(原始反馈 / 需求 / 进展)、引用原话、Hub 图片、复选框、代码块、表格、链接。
const CANONICAL: Record<string, string> = {
  threeSection: [
    '## 原始反馈',
    '',
    '> Markdown…富文本的直接编辑，不需要点到 Markdown 里面去编辑',
    '> 但是它底层还是存的是 Markdown',
    '',
    '![截图 2026-09-30 10.12.03.png](/api/files/f_9c1d2e3f4a5b)',
    '',
    '## 需求',
    '',
    '- 标题、列表、**加粗** / *斜体*、链接',
    '- 代码块、图片、复选框',
    '- 底层仍存 Markdown,agent 读写不受影响',
    '',
    '## 进展',
    '',
    '- [x] #510 全屏 + 语音输入',
    '- [x] #502 粘贴 / 拖入图片',
    '- [ ] 所见即所得(本 PR)',
  ].join('\n'),
  quoteMultiPara: '## 原始反馈\n\n> 第一段原话\n>\n> 第二段原话,带 `代码` 和 **重点**\n\n![](/api/files/f_1)\n\n![图2.png](/api/files/f_2)',
  checklistNested: '- [ ] 桌面\n  - [x] 标题\n  - [ ] 列表\n- [ ] 手机',
  codeBlocks: '复现:\n\n```bash\ncd app && npm test\n# 注释 **不是粗体**\n```\n\n```json\n{"ok": true, "list": [1, 2]}\n```\n\n行内 `npm run typecheck` 也要过。',
  tablePadded: '| key | value |\n| --- | ----- |\n| a   | 1     |',
  links: '见 [PR #533](https://github.com/sleep2agi/agent-network-app/pull/533) 和 <https://example.com/docs>,邮件 <mailto:a@example.com>。',
  headings: '# 一级\n\n## 二级\n\n### 三级\n\n正文',
  ordered: '1. 打开详情\n2. 改描述\n3. 保存',
  softBreaks: '第一行\n第二行\n第三行',
  hardBreak: '行尾两个空格  \n换行',
  hr: '上面\n\n---\n\n下面',
  strike: '~~不做了~~ 改成这样',
  inlineImage: '文字 ![图](/api/files/f_1) 文字',
  mixedEmphasis: '***粗斜*** 和 **粗 *里面斜* 粗**',
  empty: '',
};

// 改过之后会发生的规范化:[输入, 规范化结果]。每条都必须幂等(规范化结果再往返一次不变)。
const NORMALIZED: Record<string, [string, string]> = {
  starBullets: ['* 一\n* 二', '- 一\n- 二'],
  plusBullets: ['+ 一\n+ 二', '- 一\n- 二'],
  underscoreEmphasis: ['_斜_ 和 __粗__', '*斜* 和 **粗**'],
  tildeFence: ['~~~\ncode\n~~~', '```\ncode\n```'],
  parenOrdered: ['1) a\n2) b', '1. a\n2. b'],
  setext: ['标题\n===', '# 标题'],
  // 列宽按字符数补(不是显示宽度),汉字表格看起来不齐,但固定、幂等。
  tableCjk: ['| 平台 | 结论 |\n| --- | --- |\n| 桌面 | 所见即所得 |\n| 手机 | 不变 |', '| 平台  | 结论    |\n| --- | ----- |\n| 桌面  | 所见即所得 |\n| 手机  | 不变    |'],
  tablePadding: ['| a | b |\n| --- | --- |\n| 1 | 2 |', '| a   | b   |\n| --- | --- |\n| 1   | 2   |'],
  tableMiddleNoExtraBlank: ['前\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n后', '前\n\n| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\n后'],
  bareUrl: ['看 https://example.com/a?b=1 这里', '看 <https://example.com/a?b=1> 这里'],
  bareUrlBeforeCjk: ['<https://example.com>中文', '<https://example.com>中文'],
  extraBlankLines: ['段一\n\n\n段二', '段一\n\n段二'],
  looseList: ['- a\n\n- b', '- a\n- b'],
  literalStars: ['5*3 = 15, a_b_c', '5\\*3 = 15, a\\_b\\_c'],
  trailingNewline: ['末尾\n', '末尾'],
  crlf: ['a\r\nb', 'a\nb'],
  quoteThenList: ['> 引用\n> - [ ] 项', '> 引用\n>\n> - [ ] 项'],
  codeBlockKeepsBlankLines: ['```\na\n\n\n\nb\n```', '```\na\n\n\n\nb\n```'],
};

console.log('# 规范写法:打开 → 不改 → 保存,一个字节都不变');
for (const [name, md] of Object.entries(CANONICAL)) {
  const out = richRoundTrip(md);
  ck(`${name}`, out === md, JSON.stringify(out));
}

console.log('# 规范化:只在改过时发生,结果固定且幂等,文字不丢');
for (const [name, [input, expected]] of Object.entries(NORMALIZED)) {
  const out = richRoundTrip(input);
  ck(`${name}: 结果`, out === expected, JSON.stringify(out));
  ck(`${name}: 幂等`, richRoundTrip(out) === out, JSON.stringify(richRoundTrip(out)));
  ck(`${name}: 可进富文本`, richSafety(input).ok && richSafety(out).ok);
}

console.log('# 富文本保不住的 → 只开源码(不冒丢内容的险)');
{
  const html = richSafety('<details><summary>折叠</summary>\n\n内容\n\n</details>');
  ck('块级 HTML', !html.ok && html.reason === 'html');
  const inline = richSafety('a <b>粗</b> c');
  ck('行内 HTML', !inline.ok && inline.reason === 'html');
  const ref = richSafety('[文档][1]\n\n[1]: https://example.com');
  ck('引用式链接定义(往返会变成行内链接,文字序列变了)', !ref.ok && ref.reason === 'lossy');
  ck('代码块 / 行内代码里的尖括号不算 HTML', richSafety('```\n<div>\n```\n\nx `<b>` y').ok);
  ck('空描述可以', richSafety('').ok && richSafety('  \n').ok);
  for (const [name, md] of Object.entries(CANONICAL)) ck(`语料 ${name} 可进富文本`, richSafety(md).ok);
}

console.log('# 文字签名');
ck('只看字母 / 数字 / 汉字', textSignature('## 标题 **a** `b` [c](http://d)') === '标题abchttpd');
ck('HTML 转义会被抓到(&lt; 多出 lt)', textSignature('&lt;b&gt;') !== textSignature('<b>'));

console.log('# 打开不改不写');
{
  const original = '* 一\n* 二';                       // 非规范写法
  const baseline = richRoundTrip(original);            // 编辑器打开时算出的规范化结果
  const opened = { original, baseline };
  ck('没改(或改了又改回去)= 交回原文', sameAsOpened(baseline, opened) === original);
  ck('真改了 = 新 Markdown', sameAsOpened('- 一\n- 二\n- 三', opened) === '- 一\n- 二\n- 三');
}

console.log('# 改一处只动一处(规范写法的描述)');
{
  const md = CANONICAL.threeSection;
  const doc = richFromMarkdown(md);
  // 勾上最后一个复选框:整篇只有那一行变。
  const lists = (doc.content ?? []).filter(n => n.type === 'taskList');
  const items = lists[lists.length - 1].content!;
  items[items.length - 1].attrs = { ...items[items.length - 1].attrs, checked: true };
  const out = richToMarkdown(doc);
  const before = md.split('\n');
  const after = out.split('\n');
  const changed = before.map((line, i) => (line === after[i] ? null : i)).filter(i => i !== null);
  ck('勾一个复选框:只有那一行变', before.length === after.length && changed.length === 1 && after[changed[0]!] === '- [x] 所见即所得(本 PR)', JSON.stringify(changed));
  // 在末尾加一段:前面原样,只多了一段。
  const doc2 = richFromMarkdown(md);
  doc2.content!.push({ type: 'paragraph', content: [{ type: 'text', text: '新加的一段' }] } as JSONContent);
  ck('末尾加一段:前面原样', richToMarkdown(doc2) === `${md}\n\n新加的一段`);
  // 加粗一段文字。
  const doc3 = richFromMarkdown('一段文字');
  doc3.content![0].content = [{ type: 'text', text: '一段' }, { type: 'text', text: '文字', marks: [{ type: 'bold' }] }];
  ck('加粗 → **…**', richToMarkdown(doc3) === '一段**文字**');
  // 链接文字就是地址 → <地址>;文字不同 → [文字](地址)。
  const link = (text: string, href: string): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }] }] });
  ck('链接:文字 = 地址 → <地址>', richToMarkdown(link('https://a.com/x', 'https://a.com/x')) === '<https://a.com/x>');
  ck('链接:文字 ≠ 地址 → [文字](地址)', richToMarkdown(link('文档', 'https://a.com/x')) === '[文档](https://a.com/x)');
  ck('图片节点 → ![名字](/api/files/<id>)', richToMarkdown({ type: 'doc', content: [{ type: 'image', attrs: { src: '/api/files/f_z', alt: '图.png' } }] }) === '![图.png](/api/files/f_z)');
}

console.log('# 编辑器接线(源码)');
{
  const web = src('./RichDescriptionEditor.tsx');
  const stub = src('./rich-support.tsx');
  const lazyWeb = src('./rich-support.web.tsx');
  const editor = src('./TaskDescriptionEditor.tsx');
  ck('编辑器用 rich-markdown 的扩展表和读写(和本测试同一条管道)', web.includes("richExtensions({ image: authedImage(imageCtx)") && web.includes('content: richFromMarkdown(value)') && web.includes('sameAsOpened(richToMarkdown(editor.getJSON()), opened.current)'));
  ck('打开时的基线取自编辑器装载后的文档', web.includes("opened.current = { original: value, baseline: richToMarkdown(editor.getJSON()) };"));
  ck('只在用户改了文档时回调(update 事件),外面回传同一个值不重设内容', web.includes("editor.on('update'") && web.includes('value === emitted.current'));
  ck('图片的 Markdown 读写不改(只扩展 addNodeView)', /Image\.extend\(\{\n\s*addNodeView\(\)/.test(web) && !/Image\.extend\(\{[^]*?(renderMarkdown|parseMarkdown)/.test(web));
  ck('链接不点开(桌面壳里会导航走整个 webview)', src('./rich-markdown.ts').includes('openOnClick: false'));
  ck('原生入口:不可用、不渲染、不 import 任何 TipTap / rich-markdown(原生包里没有它)', stub.includes('RICH_EDITOR_AVAILABLE = false') && stub.includes('return null') && !/from '(@tiptap|\.\/rich-markdown|\.\/RichDescriptionEditor)/.test(stub));
  // 只有一个 import():两个 import() 共用 TipTap 时 Metro 把共用部分提到首屏就加载的 __common 包里。
  const lazyCode = lazyWeb.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  const dynamicImports = lazyCode.match(/(?<!typeof )import\('[^']+'\)/g) ?? [];
  ck('web 入口:编辑器和判据从同一个 import(\'./rich-bundle\') 按需加载(不进主包 / __common)', dynamicImports.length === 1 && dynamicImports[0] === "import('./rich-bundle')" && !/^import [^t].*from '(@tiptap|\.\/rich-markdown|\.\/RichDescriptionEditor|\.\/rich-bundle)'/m.test(lazyCode), JSON.stringify(dynamicImports));
  ck('原生 / web 入口同一个扩展名(否则 Metro 在 web 上先命中原生占位)', existsSync(new URL('./rich-support.tsx', import.meta.url)) && existsSync(new URL('./rich-support.web.tsx', import.meta.url)) && !existsSync(new URL('./rich-support.ts', import.meta.url)));
  ck('详情不直接 import 编辑器 / 判据 / TipTap(只经 rich-support)', !/from '(@tiptap[^']*|\.\/rich-markdown|\.\/RichDescriptionEditor)'/.test(editor) && editor.includes("from './rich-support'"));
  ck('富文本只在鼠标界面 + 能保真时', editor.includes('const richCapable = richText && pointer && RICH_EDITOR_AVAILABLE;') && editor.includes('richSafetyNow(value) === true'));
  ck('语音 / 图片在富文本时插到富文本编辑器', editor.includes('rich.insertText(text, refocusAfterInsert(source))') && editor.includes('rich.insertImage(`/api/files/${up.file_id}`, imageAlt(img.fileName))'));
}

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
