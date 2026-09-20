// 0.2.81:通知正文不能是 Markdown 原文(Vincent 截图里读到的是 `[xxx.md](/data/workspaces/…`)。
import { plainTextForNotification, stripInlineMarkdown } from './notify-text';
import { readFileSync } from 'fs';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`  ✓ ${n}`); } else console.log(`  ✗ ${n}`); };
const norm = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf-8').replace(/\r\n?/g, '\n');

// —— 行内记号 ——
ck('链接只留标签,URL 不进通知', stripInlineMarkdown('见 [报告.md](/data/workspaces/agent-x/r.md) 完') === '见 报告.md 完');
ck('图片整条去掉 URL', stripInlineMarkdown('![图](/tmp/a.png)') === '图');
ck('图片在链接之前处理(不留下孤立的 !)', !stripInlineMarkdown('![x](y)').includes('!'));
ck('行内代码去掉反引号', stripInlineMarkdown('跑 `npm test` 看看') === '跑 npm test 看看');
ck('粗体斜体删除线', stripInlineMarkdown('**粗** *斜* ~~删~~') === '粗 斜 删');

// —— Vincent 截图里的那一条 ——
const real = '[TM基建牛] 详细报告已生成： [API-UAT-SGC-NETWORK-REPORT-20260920.md](/data/workspaces/agent-network-infra/reports/x.md)';
const got = plainTextForNotification(real);
ck('真实样本:不再出现链接语法', !got.includes('](') && !got.includes('.md)'));
ck('真实样本:不再出现绝对路径', !got.includes('/data/workspaces'));
ck('真实样本:保留文件名标签', got.includes('API-UAT-SGC-NETWORK-REPORT-20260920.md'));

// —— 块级 ——
ck('代码块压成占位而不是整段代码', plainTextForNotification('```bash\nrm -rf /\n```') === '［bash 代码］');
ck('表格压成表头占位', plainTextForNotification('| a | b |\n| --- | --- |\n| 1 | 2 |').startsWith('［表格：'));
ck('标题去掉 # 记号', !plainTextForNotification('## 标题\n正文').includes('#'));
ck('多块拼成一行(不含换行)', !plainTextForNotification('第一段\n\n第二段').includes('\n'));

// —— 截断 ——
const long = plainTextForNotification('中'.repeat(300));
ck('超长截断到 80 字符 + 省略号', Array.from(long).length === 81 && long.endsWith('…'));
ck('按字符截断而不是按 length(中文不会被算错)', Array.from(plainTextForNotification('中'.repeat(300))).length === 81);
ck('空输入 → 空串', plainTextForNotification('') === '' && plainTextForNotification(null) === '');

// —— 契约:通知发送处真的用了它 ——
const notifier = norm('./DesktopNotifier.tsx');
ck('DesktopNotifier 用 plainTextForNotification 压正文', notifier.includes('plainTextForNotification(group.body)'));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
