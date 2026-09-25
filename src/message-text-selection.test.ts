// 选择文本(Vincent 2026-09-26 安卓折叠屏:「现在只能复制整个的消息…想划选部分段落或句子然后去复制」)。
// ck 风格自执行脚本(不是 bun:test)。run: bun src/message-text-selection.test.ts
import fs from 'node:fs';
import path from 'node:path';
import { markdownToPlainText, selectableTextOf, selectedTextWithin, selectTextSurface } from './message-plain-text';
import { messageMenuGroups, messageMenuKeys } from './message-menu-model';
let p = 0, t = 0; const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n, extra); };
const eq = (n: string, got: string, want: string) => ck(n, got === want, `\n   got: ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);

// ── Markdown → 选择视图纯文本 ─────────────────────────────────────────────
eq('标题去掉 #', markdownToPlainText('## 发版说明'), '发版说明');
eq('强调记号去掉', markdownToPlainText('这是**重点**和*斜体*'), '这是重点和斜体');
eq('无序列表保留 •', markdownToPlainText('- 甲\n- 乙'), '• 甲\n• 乙');
eq('有序列表按序号', markdownToPlainText('1. 一\n2. 二\n3. 三'), '1. 一\n2. 二\n3. 三');
eq('代码块逐字保留、不带围栏', markdownToPlainText('```ts\nconst a_b = 1;\n  if (x) { **y** }\n```'), 'const a_b = 1;\n  if (x) { **y** }');
eq('[文字](链接) → 文字 (URL)', markdownToPlainText('看 [文档](https://example.com/a_b) 吧'), '看 文档 (https://example.com/a_b) 吧');
eq('文字就是 URL 时只写一次', markdownToPlainText('[https://example.com](https://example.com)'), 'https://example.com');
eq('裸链接原样(下划线不被吃)', markdownToPlainText('包:https://example.com/x/app_0.2.99_android.apk'), '包:https://example.com/x/app_0.2.99_android.apk');
eq('行内代码去反引号', markdownToPlainText('运行 `npm test` 即可'), '运行 npm test 即可');
eq('中文段落与标点原样', markdownToPlainText('第一段，含「引号」。\n\n第二段：继续！'), '第一段，含「引号」。\n\n第二段：继续！');
eq('块之间空一行', markdownToPlainText('# 标题\n正文一句。\n- 项'), '标题\n\n正文一句。\n\n• 项');
eq('引用块去 >', markdownToPlainText('> 被引用的话\n> 第二行'), '被引用的话\n第二行');
eq('表格按行、格子用 | 连', markdownToPlainText('| 名 | 值 |\n| --- | --- |\n| a | **1** |'), '名 | 值\na | 1');
eq('空内容 → 空串', markdownToPlainText(''), '');

// ── 整条消息 → 选择视图 ──────────────────────────────────────────────────
eq('去掉开头「@作者: …」引用行', selectableTextOf('「@示例节点: 旧话」\n**新**的一句'), '新的一句');
eq('只有引用没正文 → 退回引用', selectableTextOf('「@示例节点: 旧话」'), '示例节点: 旧话');
eq('原文模式保留 Markdown 记号', selectableTextOf('# 标题\n**粗**', 'markdown'), '# 标题\n**粗**');
eq('原文模式也去掉引用行', selectableTextOf('「@示例节点: 旧话」\n`x`', 'markdown'), '`x`');
eq('附件调试行不进选择视图', selectableTextOf('看图\n服务器路径: /srv/files/abc\n'), '看图');
eq('undefined → 空串', selectableTextOf(undefined), '');

// ── 平台选控件(RN 0.85 源码结论)────────────────────────────────────────
ck('安卓用 <Text selectable>(editable=false 的 TextInput 被 setEnabled(false),选不中)', selectTextSurface('android') === 'selectable-text');
ck('iOS 用只读 TextInput(Text selectable 只能整段 Copy)', selectTextSurface('ios') === 'readonly-input');
ck('web 用只读 TextInput', selectTextSurface('web') === 'readonly-input');

// ── 菜单:按平台 ────────────────────────────────────────────────────────
const touchKeys = messageMenuKeys({ hasText: true, touch: true });
const deskKeys = messageMenuKeys({ hasText: true, touch: false });
ck('触摸端:第一组是 复制 → 选择文本 → 引用', JSON.stringify(messageMenuGroups({ hasText: true, touch: true })[0].map(i => i.key)) === JSON.stringify(['copy', 'selectText', 'quote']));
ck('触摸端「选择文本」文案', messageMenuGroups({ hasText: true, touch: true })[0].some(i => i.key === 'selectText' && i.label === '选择文本'));
ck('桌面端不给「选择文本」(鼠标本来就能拖选)', !deskKeys.includes('selectText') && deskKeys.includes('copy'));
ck('无正文时不给「选择文本」', !messageMenuKeys({ hasText: false, touch: true }).includes('selectText'));
ck('桌面端有选区 → 第一项「复制选中内容」,仍保留「复制」', JSON.stringify(messageMenuKeys({ hasText: true, selectedText: '部分句子' }).slice(0, 2)) === JSON.stringify(['copySelection', 'copy']));
ck('选区只有空白 → 不给「复制选中内容」', !messageMenuKeys({ hasText: true, selectedText: '  \n ' }).includes('copySelection'));
ck('没选区 → 不给「复制选中内容」', !touchKeys.includes('copySelection') && !deskKeys.includes('copySelection'));
ck('删除仍独占最后一组', messageMenuGroups({ hasText: true, touch: true }).at(-1)!.every(i => i.danger));

// ── 桌面选区只认气泡内 ──────────────────────────────────────────────────
const inside = { id: 'in' }, outside = { id: 'out' };
const bubble = { contains: (n: unknown) => n === inside };
const sel = (a: unknown, f: unknown, text: string, isCollapsed = false) => ({ anchorNode: a, focusNode: f, isCollapsed, toString: () => text });
eq('两端都在气泡里 → 选中文字', selectedTextWithin(bubble, sel(inside, inside, '部分句子')), '部分句子');
eq('一端拖出气泡 → 空', selectedTextWithin(bubble, sel(inside, outside, '跨两条')), '');
eq('折叠选区 → 空', selectedTextWithin(bubble, sel(inside, inside, '', true)), '');
eq('没有选区 → 空', selectedTextWithin(bubble, null), '');
eq('没有气泡 → 空', selectedTextWithin(null, sel(inside, inside, 'x')), '');

// ── 接线(源码契约)────────────────────────────────────────────────────
const chat = fs.readFileSync(path.join(__dirname, 'ChatScreen.tsx'), 'utf8');
const sheet = fs.readFileSync(path.join(__dirname, 'SelectTextSheet.tsx'), 'utf8');
ck('菜单按平台传 touch', chat.includes('touch: !desktop, selectedText: menuFor?.selectedText'));
ck('「选择文本」打开选择视图', chat.includes("if (key === 'selectText') { setMenuFor(null); setSelectTextFor(selection); return; }"));
ck('「复制选中内容」原样复制选区(不过 copyTextOf)', chat.includes("if (key === 'copySelection') { setMenuFor(null); void copyValue(selection.selectedText ?? ''); return; }"));
ck('右键时从气泡取选区', chat.includes("selectedTextWithin(bubble, (globalThis as any).getSelection?.())") && chat.includes('setMenuFor({ item, text, author, selectedText })'));
ck('选择视图挂在 ChatScreen 上', chat.includes('<SelectTextSheet') && chat.includes('text={selectTextFor ? selectTextFor.text : null}'));
ck('选择视图按平台选控件', sheet.includes('selectTextSurface(Platform.OS)') && sheet.includes("surface === 'selectable-text'"));
ck('安卓分支:一个 <Text selectable> 承载全文', /<Text selectable[^>]*>\{value\}<\/Text>/.test(sheet));
ck('iOS/web 分支:只读多行 TextInput,系统菜单不隐藏', sheet.includes('editable={false}') && sheet.includes('multiline') && sheet.includes('contextMenuHidden={false}'));
ck('选择视图用 selectableTextOf(与气泡同一条去引用/去附件管线)', sheet.includes('selectableTextOf(text ?? \'\', mode)'));
ck('安卓返回键关闭(onRequestClose)', sheet.includes('onRequestClose={onClose}'));

console.log(`\n${p}/${t} passed`); process.exit(p === t ? 0 : 1);
