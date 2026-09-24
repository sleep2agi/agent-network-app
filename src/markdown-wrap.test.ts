// 2026-09-24 Vincent 截图:聊天气泡里行内代码长 hash / 长 URL 撑出气泡右边。
// 根因:文本样式没有断行点 + 列表行的文字列是 flex 子项却没有 minWidth 0(min-width:auto 按内容宽度撑开)。
// 本测试钉住 MarkdownMessage.tsx 里的修复形状;真实渲染的越界像素见 PR 里的 Playwright 测量(0 px)。
import * as fs from 'node:fs';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}`); };
const src = fs.readFileSync('src/MarkdownMessage.tsx', 'utf8').replace(/\r\n?/g, '\n');
const styleLine = (name: string) => (src.match(new RegExp(`^\\s*${name}: \\{[^\\n]*$`, 'm')) || [''])[0];

ck('WRAP_ANYWHERE defined for web with overflowWrap anywhere + wordBreak break-word',
  /WRAP_ANYWHERE\s*=\s*Platform\.OS === 'web'\s*\?\s*\(\{\s*overflowWrap:\s*'anywhere',\s*wordBreak:\s*'break-word'\s*\}/.test(src));
ck('text style spreads WRAP_ANYWHERE', /\.\.\.WRAP_ANYWHERE/.test(styleLine('text')));
ck('inlineCode style spreads WRAP_ANYWHERE', /\.\.\.WRAP_ANYWHERE/.test(styleLine('inlineCode')));
ck('listText can shrink below its content width (minWidth 0)', /minWidth:\s*0/.test(styleLine('listText')) && /flexShrink:\s*1/.test(styleLine('listText')));
ck('listRow has minWidth 0', /minWidth:\s*0/.test(styleLine('listRow')));
ck('root column has minWidth 0', /minWidth:\s*0/.test(styleLine('root')));
ck('code block still scrolls horizontally on web (not wrapped)', /<ScrollView horizontal><Text selectable style=\{styles\.codeText\}>/.test(src));
ck('codeText does not opt into wrapping', !/WRAP_ANYWHERE/.test(styleLine('codeText')));

console.log(`markdown wrap: ${p}/${t} checks passed`);
process.exit(p === t ? 0 : 1);
