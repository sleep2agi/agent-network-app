// @ts-nocheck -- repository test scripts run directly under Bun.
// #1831 —— 任务评论正文按 Markdown 渲染(admin 2026-10-19 截图:## / **粗体** / 反引号原样露出)。
// 组件本身没有 RN 渲染测试,这里按仓库惯例读 TaskComments.tsx 源码钉住接线,并复核 Markdown 解析器
// 对评论里常见的结构(标题 / 粗体 / 行内代码 / 列表)确实产出了对应块。
import { readFileSync } from 'node:fs';
import { parseInline, parseMarkdownBlocks } from './markdown-model';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };

const src = readFileSync('src/TaskComments.tsx', 'utf8').replace(/\r\n?/g, '\n');

ck('评论组件引入 MarkdownMessage', /import MarkdownMessage from '\.\/MarkdownMessage'/.test(src));
ck('评论正文交给 MarkdownMessage 渲染', /<MarkdownMessage>\{c\.text\}<\/MarkdownMessage>/.test(src));
ck('不再把评论正文当纯文本 Text 渲染', !/\{c\.text\}<\/Text>/.test(src));
ck('保留逐条评论的 testID', src.includes('req-comment-text-${c.id}'));
ck('长按只在触屏设备上绑定', /onLongPress=\{pointer \? undefined : \(\) => \{ void copyComment\(c\.id, c\.text\); \}\}/.test(src));
ck('桌面有独立复制按钮', src.includes('req-comment-copy-${c.id}'));
ck('复制写入剪贴板', src.includes('Clipboard.setStringAsync(text)'));
ck('复制后给「已复制」反馈', src.includes('req-comment-copied-${c.id}'));
ck('复制失败时有浏览器剪贴板兜底', src.includes('navigator?.clipboard?.writeText'));

const i18n = readFileSync('src/i18n-tasks.ts', 'utf8');
ck('i18n 有复制提示', i18n.includes("'comments.copyHint'"));
ck('i18n 有复制按钮文案', i18n.includes("'comments.copy'"));
ck('i18n 有已复制提示', i18n.includes("'comments.copied'"));

// MarkdownMessage 的解析器对评论常见结构给出的块类型
const blocks = parseMarkdownBlocks('## 归因更正\n\n我初版确认**错误**:\n- 第 1 条\n- 第 2 条\n\n`agent_owner`', {});
ck('## 解析成标题块', blocks.some(b => b.kind === 'heading'));
ck('**粗体** 解析成 strong 行内节点', parseInline('我初版确认**错误**').some(n => n.kind === 'strong'));
ck('- 列表解析成列表块', blocks.some(b => b.kind === 'list'));
ck('`code` 解析成行内代码', parseInline('看 `agent_owner`').some(n => n.kind === 'code'));

console.log(`\n${p}/${t} passed`);
if (p !== t) process.exit(1);
