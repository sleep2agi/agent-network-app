import fs from 'node:fs';
import path from 'node:path';
import { inlinePlainText, isSafeMarkdownUrl, parseInline, parseMarkdownBlocks, type InlineNode } from './markdown-model';
import { stripInlineMarkdown } from './notify-text';
let p = 0, t = 0; const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n); };

const blocks = parseMarkdownBlocks('## 标题\n\n- 一\n- 二\n\n|项|结果|\n|---|---|\n|Enter|通过|\n\n```ts\nconst x = 1\n```');
ck('解析标题', blocks[0]?.kind === 'heading' && blocks[0].text === '标题');
ck('合并连续列表', blocks[1]?.kind === 'list' && blocks[1].items.length === 2);
ck('解析表格并跳过分隔行', blocks[2]?.kind === 'table' && blocks[2].rows.length === 2);
ck('解析围栏代码', blocks[3]?.kind === 'code' && blocks[3].text === 'const x = 1');
ck('仅允许 http/https 链接', isSafeMarkdownUrl('https://example.com') && !isSafeMarkdownUrl('javascript:alert(1)') && !isSafeMarkdownUrl('file:///tmp/x'));
ck('原始 HTML 只作为普通文本', parseMarkdownBlocks('<script>alert(1)</script>')[0]?.kind === 'paragraph');

const messageSource = fs.readFileSync(path.join(process.cwd(), 'src/MarkdownMessage.tsx'), 'utf8');
ck('Tauri Markdown 链接静态加载系统 opener', messageSource.includes("import { openUrl } from '@tauri-apps/plugin-opener'"));
ck('Markdown 链接点击不被外层气泡吞掉', messageSource.includes('event.stopPropagation()'));
ck('非 Tauri Markdown 链接保留 Linking fallback', messageSource.includes('await Linking.openURL(url)'));
// ── 行内:裸链接 + 词内 `_`(0.2.100,Vincent 安卓截图)──────────────────────────
const J = (nodes: InlineNode[]) => JSON.stringify(nodes);
const autolinks = (nodes: InlineNode[]): string[] => nodes.flatMap(n =>
  n.kind === 'autolink' ? [n.url] : (n.kind === 'strong' || n.kind === 'em') ? autolinks(n.children) : []);
const hasKind = (nodes: InlineNode[], kind: string): boolean => nodes.some(n =>
  n.kind === kind || ((n.kind === 'strong' || n.kind === 'em') && hasKind(n.children, kind)));

const APK = 'https://modelscope.cn/datasets/SmartFlowAI/agent-network-releases/resolve/master/desktop/0.2.99/Agent.Network_0.2.99_android-universal.apk';
{
  const n = parseInline(`安卓包:${APK}`);
  ck('截图原句:整条 URL 是一个链接', J(autolinks(n)) === J([APK]));
  ck('截图原句:没有斜体', !hasKind(n, 'em') && !hasKind(n, 'strong'));
  ck('截图原句:纯文本逐字等于原文(下划线没丢)', inlinePlainText(n) === `安卓包:${APK}`);
}
{
  const n = parseInline(`下载 ${APK} 就行`);
  ck('空格隔开的 URL', J(autolinks(n)) === J([APK]));
}
ck('URL 后面跟 。 —— 句号不进链接', J(autolinks(parseInline('见 https://example.com/a_b。'))) === J(['https://example.com/a_b']));
ck('URL 后面直接跟中文 —— 在第一个汉字处结束', J(autolinks(parseInline('https://x.y/z这是下载地址'))) === J(['https://x.y/z']));
ck('URL 后面跟 ，和 ）', J(autolinks(parseInline('（https://x.y/a，https://x.y/b）'))) === J(['https://x.y/a', 'https://x.y/b']));
ck('URL 在圆括号里 —— 右括号不进链接', J(autolinks(parseInline('(see https://example.com/docs)'))) === J(['https://example.com/docs']));
ck('URL 自带配对括号 —— 留在链接里', J(autolinks(parseInline('https://en.wikipedia.org/wiki/Foo_(bar)'))) === J(['https://en.wikipedia.org/wiki/Foo_(bar)']));
ck('URL 末尾的 . , : ! ? 不进链接', J(autolinks(parseInline('a https://x.y/p. b https://x.y/q, c https://x.y/r: d https://x.y/s! e https://x.y/t?'))) === J(['https://x.y/p', 'https://x.y/q', 'https://x.y/r', 'https://x.y/s', 'https://x.y/t']));
ck('URL 里的查询串保留', J(autolinks(parseInline('https://x.y/a?b=1&c=d_e#f'))) === J(['https://x.y/a?b=1&c=d_e#f']));
ck('www. 开头的也识别,打开时补 http://', J(autolinks(parseInline('去 www.example.com 看'))) === J(['http://www.example.com']));
ck('紧贴字母的 xhttps:// 不算链接', autolinks(parseInline('xhttps://x.y/z')).length === 0);
ck('只有 https:// 不算链接', autolinks(parseInline('协议写 https:// 开头')).length === 0);
ck('<https://…> 尖括号链接', J(autolinks(parseInline('<https://x.y/a_b_c>'))) === J(['https://x.y/a_b_c']));
ck('javascript: 不会被识别成链接', autolinks(parseInline('javascript:alert(1)')).length === 0);

ck('snake_case_word 原样', J(parseInline('snake_case_word')) === J([{ kind: 'text', text: 'snake_case_word' }]));
ck('foo_bar_baz 在句中也原样', inlinePlainText(parseInline('改 foo_bar_baz 这个变量')) === '改 foo_bar_baz 这个变量' && !hasKind(parseInline('改 foo_bar_baz 这个变量'), 'em'));
ck('文件名 Agent.Network_0.2.99_android.apk(不当链接时)也不斜体', !hasKind(parseInline('Agent.Network_0.2.99_android.apk'), 'em'));
ck('__init__ 词内双下划线:两头挨空白时照 CommonMark 是粗体', J(parseInline('a __init__ b')) === J([{ kind: 'text', text: 'a ' }, { kind: 'strong', children: [{ kind: 'text', text: 'init' }] }, { kind: 'text', text: ' b' }]));
ck('my__dunder__name 词内双下划线原样', J(parseInline('my__dunder__name')) === J([{ kind: 'text', text: 'my__dunder__name' }]));
ck('_真强调_ 仍是斜体', J(parseInline('这是 _real emphasis_ 啊')) === J([{ kind: 'text', text: '这是 ' }, { kind: 'em', children: [{ kind: 'text', text: 'real emphasis' }] }, { kind: 'text', text: ' 啊' }]));
ck('**粗体** 仍是粗体', J(parseInline('**bold**')) === J([{ kind: 'strong', children: [{ kind: 'text', text: 'bold' }] }]));
ck('*斜体* 仍是斜体', J(parseInline('*it*')) === J([{ kind: 'em', children: [{ kind: 'text', text: 'it' }] }]));
ck('* 词内仍可用(foo*bar*baz)', hasKind(parseInline('foo*bar*baz'), 'em'));
ck('开符在词中间不开:foo_bar baz_ 原样', !hasKind(parseInline('foo_bar baz_'), 'em'));
ck('闭符在词中间不关:_foo bar_baz 原样', !hasKind(parseInline('_foo bar_baz'), 'em'));
ck('紧跟开符的 URL 里的 * 不当闭符', !hasKind(parseInline('*https://x.y/a*b c'), 'em') && J(autolinks(parseInline('*https://x.y/a*b c'))) === J(['https://x.y/a*b']));
ck('空内容不成强调:**** / ____ 原样', inlinePlainText(parseInline('**** ____')) === '**** ____' && !hasKind(parseInline('**** ____'), 'strong'));
ck('_ 两侧是空白不开强调(a _ b _ c)', !hasKind(parseInline('a _ b _ c'), 'em'));
ck('粗体里套链接', J(autolinks(parseInline('**看 https://x.y/a_b**'))) === J(['https://x.y/a_b']) && hasKind(parseInline('**看 https://x.y/a_b**'), 'strong'));
ck('粗体里套斜体', J(parseInline('**a _b_ c**')) === J([{ kind: 'strong', children: [{ kind: 'text', text: 'a ' }, { kind: 'em', children: [{ kind: 'text', text: 'b' }] }, { kind: 'text', text: ' c' }] }]));
ck('_ 包住 URL:URL 末尾的 _ 不进链接,强调照常', J(parseInline('_https://x.y/z_')) === J([{ kind: 'em', children: [{ kind: 'autolink', text: 'https://x.y/z', url: 'https://x.y/z' }] }]));
ck('强调闭符不会落在 URL 里', !hasKind(parseInline('_see https://x.y/a_b c'), 'em') && J(autolinks(parseInline('_see https://x.y/a_b c'))) === J(['https://x.y/a_b']));

{
  const n = parseInline('跑 `curl https://x.y/a_b_c` 看看');
  ck('行内代码里的 URL 仍是代码', J(n) === J([{ kind: 'text', text: '跑 ' }, { kind: 'code', text: 'curl https://x.y/a_b_c' }, { kind: 'text', text: ' 看看' }]));
}
ck('行内代码里的 _x_ 不斜体', J(parseInline('`_x_`')) === J([{ kind: 'code', text: '_x_' }]));
ck('[文字](链接) 仍是显式链接', J(parseInline('看 [发版说明](https://x.y/a_b_c) 吧')) === J([{ kind: 'text', text: '看 ' }, { kind: 'link', text: '发版说明', url: 'https://x.y/a_b_c' }, { kind: 'text', text: ' 吧' }]));
ck('多行文本:换行保留在纯文本里', inlinePlainText(parseInline(`第一行\n${APK}\n第三行`)) === `第一行\n${APK}\n第三行`);
ck('通知纯文本也不再吃掉 URL 里的下划线', stripInlineMarkdown(APK) === APK);
ck('通知纯文本 snake_case 原样、_强调_ 去记号', stripInlineMarkdown('snake_case 和 _强调_') === 'snake_case 和 强调');
ck('渲染器走 parseInline(不再有旧的行内正则)', messageSource.includes('parseInline(text)') && !messageSource.includes('_([^_\\n]+)_'));
ck('裸链接与显式链接共用同一个点击出口', /node\.kind === 'link' \|\| node\.kind === 'autolink'/.test(messageSource));
console.log(`\n${p}/${t} passed`); process.exit(p === t ? 0 : 1);
