// 规则文件「阅读 / 编辑 / 全屏目录」纯模型。ck 风格自执行脚本(不是 bun:test)。
// @ts-expect-error app tsconfig 不带 node 类型(其余读源码的 ck 测试同样报这一条);运行时由 node/bun 提供。
import { readFileSync } from 'node:fs';
import { blockAtY, blockLineForCaret, buildRulesOutline, DOUBLE_TAP_MS, DOUBLE_TAP_SLOP, isDoubleTap, isTap, resolveBlockRects, RULES_OUTLINE_MIN_WINDOW, RULES_TOOLBAR_NARROW_WIDTH, rulesToolbarLayout, showRulesOutline, TAP_MOVE_SLOP, RULES_STATUS_HIDE_MS, rulesInfoText, saveButtonLabel, statusAutoHideMs, jumpText, lineAtOffset, lineEndOffset, lineStartOffset, outlineText, OUTLINE_MAX_LEVEL, RULES_DEFAULT_MODE, rulesReadKey, rulesViewState, sourceRangeFromDataset, sourceSelection } from './node-rules-view';
import { parseMarkdownBlocks } from './markdown-model';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) p++; else console.log(`  ✗ ${n}`); };

// ── 草稿在两种模式间保留 ───────────────────────────────
ck('默认是阅读模式', RULES_DEFAULT_MODE === 'read');
const clean = rulesViewState('# 规则\n原文', '# 规则\n原文');
ck('没改过:阅读渲染原文、不标未保存', clean.renderSource === '# 规则\n原文' && clean.unsaved === false);
const draft = rulesViewState('# 规则\n改过的草稿', '# 规则\n原文');
ck('改过:阅读渲染的是草稿,不是节点上的原文', draft.renderSource === '# 规则\n改过的草稿');
ck('改过:标未保存', draft.unsaved === true);
ck('还没读到(onNode=null):不标未保存', rulesViewState('', null).unsaved === false);
ck('节点上没有文件(onNode=\'\')+ 写了草稿:标未保存', rulesViewState('新规则', '').unsaved === true);
ck('节点上没有文件 + 草稿也空:不标未保存', rulesViewState('', '').unsaved === false);

// ── 目录 ────────────────────────────────────────────
const doc = [
  '# 总则',
  '正文',
  '## 第 1 节 `命令`',
  '```bash',
  '# 这是代码里的注释,不是标题',
  'echo hi',
  '```',
  '### 1.1 **加粗** 与 [链接](https://example.com)',
  '#### 太深的标题',
  '## 第 2 节',
  '#不是标题(没有空格)',
].join('\n');
const o = buildRulesOutline(doc);
ck('收 h1–h3,代码块里的 # 和 h4 不收', o.map(h => h.text).join('|') === '总则|第 1 节 命令|1.1 加粗 与 链接|第 2 节');
ck('层级正确', o.map(h => h.level).join(',') === '1,2,3,2');
ck('序号按全文所有标题计(h4 占一个号,后面的序号跳过它)', o.map(h => h.index).join(',') === '0,1,2,4');
ck('OUTLINE_MAX_LEVEL = 3', OUTLINE_MAX_LEVEL === 3);
ck('空文档目录为空', buildRulesOutline('').length === 0);
ck('没收尾的代码块:后面的 # 也不当标题', buildRulesOutline('# A\n```\n# 注释\n## 不是').map(h => h.text).join('|') === 'A');
ck('outlineText 去掉行内记号', outlineText('`a` **b** *c* [d](https://x.y)') === 'a b c d');
ck('outlineText 保留普通星号乘法', outlineText('2 * 3') === '2 * 3');

// ── 重读时机:页面刷新造新对象不重读,换节点/换网络才重读 ─────────
const cfg: { serverUrl: string; networkId?: string; token: string } = { serverUrl: 'http://hub.example', networkId: 'net_a', token: 't1' };
const cfgRefreshed = { ...cfg, token: 't2' };
const k = rulesReadKey(cfg, { node_id: null, alias: 'demo-node' });
ck('同一目标、新对象 ⇒ 同一个 key(刷新不重读、不冲草稿)', k === rulesReadKey(cfgRefreshed, { node_id: null, alias: 'demo-node', runtime: 'claude-code-cli' } as any));
ck('换节点 ⇒ 换 key', k !== rulesReadKey(cfg, { node_id: null, alias: 'other-node' }));
ck('换网络 ⇒ 换 key', k !== rulesReadKey({ ...cfg, networkId: 'net_b' }, { node_id: null, alias: 'demo-node' }));
ck('有无 node_id ⇒ 换 key', k !== rulesReadKey(cfg, { node_id: 'n_1', alias: 'demo-node' }));

// ── 渲染侧契约:组件确实用了这些 helper,且 MarkdownMessage 报标题位置 ─────────
const section = readFileSync(new URL('./NodeRulesSection.tsx', import.meta.url), 'utf8');
const md = readFileSync(new URL('./MarkdownMessage.tsx', import.meta.url), 'utf8');
ck('规则区用 rulesViewState 决定渲染源和未保存标记', /rulesViewState\(editor/.test(section) && /view\.unsaved/.test(section));
ck('全屏用 buildRulesOutline 生成目录', /buildRulesOutline\(source\)/.test(section));
ck('阅读模式用聊天同一个 MarkdownMessage', /<MarkdownMessage onHeadingLayout=/.test(section));
ck('全屏 Esc 退出', /event\.key === 'Escape'/.test(section));
ck('首次读取挂在 readKey 上,不挂在 runRead 身份上', /\}, \[readKey\]\);/.test(section) && !/\}, \[runRead\]\);/.test(section));
ck('MarkdownMessage 按标题序号回报 y', /onHeadingLayout\(nth, event\.nativeEvent\.layout\.y\)/.test(md));

// ── 双击跳源码(2026-09-25) ──
const DOC = [
  '# 标题一',          // 0
  '',                  // 1
  '第一段第一行',       // 2
  '第一段第二行',       // 3
  '',                  // 4
  '- 甲项',            // 5
  '- 乙项 `code`',     // 6
  '- 丙项',            // 7
  '',                  // 8
  '| 列A | 列B |',     // 9
  '| --- | --- |',     // 10
  '| a1 | b1 |',       // 11
  '| a2 | b2 |',       // 12
  '',                  // 13
  '```sh',             // 14
  '# 不是标题',         // 15
  '```',               // 16
  '> 引用一',           // 17
  '> 引用二',           // 18
].join('\n');
const dblBlocks = parseMarkdownBlocks(DOC);
const byKind = (k: string) => dblBlocks.find((b) => b.kind === k) as any;
ck('标题行号', byKind('heading')?.line === 0 && byKind('heading')?.endLine === 0);
ck('段落首末行', byKind('paragraph')?.line === 2 && byKind('paragraph')?.endLine === 3);
ck('列表逐项行号', JSON.stringify(byKind('list')?.itemLines) === '[5,6,7]' && byKind('list')?.line === 5 && byKind('list')?.endLine === 7);
ck('表格逐行行号(跳过分隔行)', JSON.stringify(byKind('table')?.rowLines) === '[9,11,12]' && byKind('table')?.endLine === 12);
ck('代码块含围栏行', byKind('code')?.line === 14 && byKind('code')?.endLine === 16);
ck('引用首末行', byKind('quote')?.line === 17 && byKind('quote')?.endLine === 18);

const CRLF = DOC.replace(/\n/g, '\r\n');
const crlfBlocks = parseMarkdownBlocks(CRLF);
ck('CRLF 原文解析出的行号与 LF 相同', JSON.stringify(crlfBlocks.map((b: any) => [b.line, b.endLine, b.itemLines, b.rowLines])) === JSON.stringify(dblBlocks.map((b: any) => [b.line, b.endLine, b.itemLines, b.rowLines])));

const lineText = (text: string, line: number) => text.slice(lineStartOffset(text, line), lineEndOffset(text, line));
ck('LF:行首偏移取回原行', lineText(DOC, 6) === '- 乙项 `code`' && lineText(DOC, 0) === '# 标题一');
ck('CRLF:行首偏移取回原行(不带 \\r)', lineText(CRLF, 6) === '- 乙项 `code`' && lineText(CRLF, 18) === '> 引用二');
ck('旧 Mac \\r 换行也按一行算', lineText('a\rb\rc', 2) === 'c' && lineStartOffset('a\rb\rc', 1) === 2);
ck('超出末行 ⇒ text.length', lineStartOffset(DOC, 999) === DOC.length && lineStartOffset(DOC, 0) === 0);

for (const [name, text] of [['LF', DOC], ['CRLF', CRLF]] as const) {
  const list = parseMarkdownBlocks(text).find((b) => b.kind === 'list') as any;
  const sel = sourceSelection(text, { start: list.itemLines[1], end: list.itemLines[1] });
  ck(`${name}:列表第二项选区正好是那一行`, text.slice(sel.start, sel.end) === '- 乙项 `code`');
  const para = parseMarkdownBlocks(text).find((b) => b.kind === 'paragraph') as any;
  const ps = sourceSelection(text, { start: para.line, end: para.endLine });
  ck(`${name}:多行段落选区覆盖首行到末行`, text.slice(ps.start, ps.end).replace(/\r/g, '') === '第一段第一行\n第一段第二行');
}

// 草稿 ≠ 节点上的原文:行号是按阅读区渲染的草稿算的,偏移也必须在草稿上算。
const onNodeCopy = DOC;
const draftText = '# 新加的一行\n' + DOC;
const draftList = parseMarkdownBlocks(draftText).find((b) => b.kind === 'list') as any;
const dsel = sourceSelection(draftText, { start: draftList.itemLines[0], end: draftList.itemLines[0] });
ck('草稿上算的选区指向草稿里的那一项', draftText.slice(dsel.start, dsel.end) === '- 甲项');
const wrong = sourceSelection(onNodeCopy, { start: draftList.itemLines[0], end: draftList.itemLines[0] });
ck('(对照)拿节点原文算会错位', onNodeCopy.slice(wrong.start, wrong.end) !== '- 甲项');

ck('dataset 读回行范围', JSON.stringify(sourceRangeFromDataset({ mdLine: '5', mdEnd: '7' })) === '{"start":5,"end":7}');
ck('dataset 缺 end ⇒ 单行', JSON.stringify(sourceRangeFromDataset({ mdLine: '3' })) === '{"start":3,"end":3}');
ck('dataset 非法 ⇒ null(不跳)', sourceRangeFromDataset({ mdLine: '-1' }) === null && sourceRangeFromDataset({ mdLine: 'x' }) === null && sourceRangeFromDataset({}) === null && sourceRangeFromDataset(null) === null);
ck('dataset end < start ⇒ 夹到 start', JSON.stringify(sourceRangeFromDataset({ mdLine: '9', mdEnd: '2' })) === '{"start":9,"end":9}');

ck('光标行号:LF', lineAtOffset(DOC, lineStartOffset(DOC, 7) + 1) === 7);
ck('光标行号:CRLF', lineAtOffset(CRLF, lineStartOffset(CRLF, 12)) === 12 && lineAtOffset(CRLF, 0) === 0);
ck('切回阅读:光标在块中间 ⇒ 回到这一块', blockLineForCaret([0, 2, 5, 6, 7, 9, 14, 17], 15) === 14 && blockLineForCaret([0, 2, 5], 3) === 2);
ck('切回阅读:没有块 ⇒ null', blockLineForCaret([], 3) === null && blockLineForCaret([4, 8], 1) === null);

ck('聊天渲染不挂行号(sourceLines 默认关)', /const src = sourceLines \? WITH_SRC : NO_SRC;/.test(md) && /const NO_SRC: Src = \(\) => \(\{\}\);/.test(md));
ck('规则阅读区开启行号并接管双击', /sourceLines=\{WEB\}/.test(section) && /addEventListener\('dblclick'/.test(section) && /closest\?\.\('\[data-md-line\]'\)/.test(section));
ck('跳转选区在编辑框文字/草稿上算(不是节点原文)', /sourceSelection\(jumpText\(ta\.value, draft\), jump\)/.test(section) && !/sourceSelection\(onNode/.test(section));
ck('切回阅读的光标行也按编辑框文字算', /lineAtOffset\(jumpText\(ta\?\.value, editor\), caret\)/.test(section));
// 浏览器 textarea 的 value 把 \r\n 规范成 \n:CRLF 草稿的偏移必须在编辑框文字上算,否则每行错一个字符。
const crlfDraft = DOC.replace(/\n/g, '\r\n');
const taValue = crlfDraft.replace(/\r\n/g, '\n');
const deepItem = (parseMarkdownBlocks(crlfDraft).find((b) => b.kind === 'list') as any).itemLines[2];
const good = sourceSelection(jumpText(taValue, crlfDraft), { start: deepItem, end: deepItem });
ck('CRLF 草稿 + 规范化的编辑框:偏移指向编辑框里的那一行', taValue.slice(good.start, good.end) === '- 丙项');
const bad = sourceSelection(crlfDraft, { start: deepItem, end: deepItem });
ck('(对照)在 CRLF 草稿上算偏移放到规范化编辑框里会错位', taValue.slice(bad.start, bad.end) !== '- 丙项');
ck('拿不到编辑框 ⇒ 退回草稿', jumpText(undefined, 'x') === 'x' && jumpText(null, 'x') === 'x' && jumpText('y', 'x') === 'y');


// ── 紧凑工具条(2026-09-25) ──
ck('已读取/已保存(ready + muted/ok)⇒ 3 秒后自动消失', statusAutoHideMs('muted', 'ready') === RULES_STATUS_HIDE_MS && statusAutoHideMs('ok', 'ready') === RULES_STATUS_HIDE_MS && RULES_STATUS_HIDE_MS === 3000);
ck('错误一直留着(不论阶段)', statusAutoHideMs('error', 'ready') === null && statusAutoHideMs('error', 'unavailable') === null && statusAutoHideMs('error', 'loading') === null);
ck('读取中/保存中的说明不自动消失', statusAutoHideMs('muted', 'loading') === null && statusAutoHideMs('muted', 'saving') === null && statusAutoHideMs('ok', 'saving') === null);
ck('不可用阶段那句话是唯一内容,不消失', statusAutoHideMs('muted', 'unavailable') === null);
ck('保存按钮干净时也叫「保存」(不再是「已是最新」)', saveButtonLabel('ready') === '保存' && saveButtonLabel('unavailable') === '保存');
ck('保存中显示「保存中…」', saveButtonLabel('saving') === '保存中…');
ck('ⓘ 说明带上真实文件名,并合并了覆盖/改不了文件名两层意思', rulesInfoText('AGENTS.md', false).includes('AGENTS.md') && rulesInfoText('AGENTS.md', false).includes('覆盖') && rulesInfoText('AGENTS.md', false).includes('改不了'));
ck('web 端 ⓘ 附双击提示,原生端不附', rulesInfoText('CLAUDE.md', true).includes('双击') && !rulesInfoText('CLAUDE.md', false).includes('双击'));
ck('规则区只剩一行工具条:卡片里不再有独立的说明段;ⓘ 带双击提示(原生端也能双击了)', !/这是节点工作目录里的 \{fileName\}/.test(section) && /<InfoTip label="规则文件说明" text=\{rulesInfoText\(fileName, true\)\} \/>/.test(section));
ck('状态句按 statusAutoHideMs 自动消失', /statusAutoHideMs\(messageTone, phase\)/.test(section));
ck('保存按钮文案走 saveButtonLabel,源码里不再有「已是最新」', /saveButtonLabel\(phase\)/.test(section) && !section.includes('已是最新'));
const screenSrc = readFileSync(new URL('./NodeDetailScreen.tsx', import.meta.url), 'utf8');
ck('节点页规则/技能标题下不再常驻说明行', /<SectionTitle title="规则文件" \/>/.test(screenSrc) && /<SectionTitle title="技能" \/>/.test(screenSrc));
const skillsSrc = readFileSync(new URL('./NodeSkillsSection.tsx', import.meta.url), 'utf8');
ck('技能区说明收进 ⓘ,刷新在头部同一行', /<InfoTip label="技能说明"/.test(skillsSrc) && skillsSrc.indexOf('<InfoTip label="技能说明"') < skillsSrc.indexOf('刷新</Text>') && skillsSrc.indexOf('刷新</Text>') < skillsSrc.indexOf('skills.map('));

// ── 手机 / 触屏(2026-09-26 Vincent 小米折叠屏:「好像编辑不了那个规则文件」) ──
// 块布局 → 绝对矩形:列表项 y 相对列表,要加上列表的 y。
const layouts = [
  { id: 'b0', start: 0, end: 0, y: 0, height: 30 },          // # 标题
  { id: 'b1', start: 2, end: 4, y: 40, height: 90 },          // 列表(3 项)
  { id: 'b1.0', parent: 'b1', start: 2, end: 2, y: 0, height: 30 },
  { id: 'b1.1', parent: 'b1', start: 3, end: 3, y: 30, height: 30 },
  { id: 'b1.2', parent: 'b1', start: 4, end: 4, y: 60, height: 30 },
  { id: 'b2', start: 6, end: 8, y: 140, height: 60 },         // 段落
];
const rects = resolveBlockRects(layouts);
const li1 = rects.find(r => r.start === 3)!;
ck('列表项的 top = 列表 y + 项 y', li1.top === 70 && li1.bottom === 100 && li1.depth === 1);
ck('顶层块 depth 0,按 top 排序', rects[0].start === 0 && rects[0].depth === 0 && rects.every((r, i) => i === 0 || rects[i - 1].top <= r.top));
ck('父块没报上来的列表项丢掉(不猜位置)', resolveBlockRects([{ id: 'x.0', parent: 'x', start: 1, end: 1, y: 5, height: 5 }]).length === 0);
ck('父子成环不死循环', resolveBlockRects([{ id: 'a', parent: 'b', start: 0, end: 0, y: 0, height: 1 }, { id: 'b', parent: 'a', start: 1, end: 1, y: 0, height: 1 }]).length === 0);
ck('坏高度 / NaN y 丢掉', resolveBlockRects([{ id: 'n', start: 0, end: 0, y: NaN, height: 1 }, { id: 'h', start: 1, end: 1, y: 0, height: -1 }]).length === 0);
const at = (y: number) => JSON.stringify(blockAtY(rects, y));
ck('点在标题上 → 标题那行', at(10) === JSON.stringify({ start: 0, end: 0 }));
ck('点在列表第二项 → 那一项,不是整张列表', at(75) === JSON.stringify({ start: 3, end: 3 }));
ck('项的上边界算这一项,下边界算下一项', at(70) === JSON.stringify({ start: 3, end: 3 }) && at(100) === JSON.stringify({ start: 4, end: 4 }));
ck('点在两块之间的空隙 → 上面那块', at(135) === JSON.stringify({ start: 2, end: 4 }) && at(35) === JSON.stringify({ start: 0, end: 0 }));
ck('点在段落里 → 段落整段', at(150) === JSON.stringify({ start: 6, end: 8 }));
ck('点在最后一块下面 → 最后一块', at(900) === JSON.stringify({ start: 6, end: 8 }));
ck('点在第一块上面(内边距)→ 第一块', at(-8) === JSON.stringify({ start: 0, end: 0 }));
ck('没有块 / y 不是数 → null(不跳)', blockAtY([], 10) === null && blockAtY(rects, NaN) === null);
ck('嵌套同深度重叠取小的那个', JSON.stringify(blockAtY([{ start: 0, end: 9, top: 0, bottom: 100, depth: 0 }, { start: 3, end: 4, top: 10, bottom: 20, depth: 0 }], 15)) === JSON.stringify({ start: 3, end: 4 }));

ck('轻触:移动 ≤ 10dp 算点', isTap({ x: 0, y: 0 }, { x: 6, y: 8 }) && TAP_MOVE_SLOP === 10);
ck('滑动(滚阅读区)不算点', !isTap({ x: 0, y: 0 }, { x: 0, y: 11 }));
ck('300ms 内同一处两次 = 双击', isDoubleTap({ t: 1000, x: 50, y: 50 }, { t: 1000 + DOUBLE_TAP_MS, x: 60, y: 60 }) && DOUBLE_TAP_MS === 300);
ck('超过 300ms 不算', !isDoubleTap({ t: 1000, x: 50, y: 50 }, { t: 1301, x: 50, y: 50 }));
ck('两次落点相距太远不算', !isDoubleTap({ t: 1000, x: 50, y: 50 }, { t: 1100, x: 50, y: 50 + DOUBLE_TAP_SLOP + 1 }));
ck('没有上一次 / 时间倒流不算', !isDoubleTap(null, { t: 1, x: 0, y: 0 }) && !isDoubleTap({ t: 2000, x: 0, y: 0 }, { t: 1990, x: 0, y: 0 }));

ck('窄工具条(手机竖屏):状态句单独一行、不显示双击提示', JSON.stringify(rulesToolbarLayout(328)) === JSON.stringify({ statusOwnLine: true, showHint: false }));
ck('宽工具条:照旧(状态句在按钮左边、有双击提示)', JSON.stringify(rulesToolbarLayout(900)) === JSON.stringify({ statusOwnLine: false, showHint: true }));
ck('窄/宽边界 560', rulesToolbarLayout(RULES_TOOLBAR_NARROW_WIDTH - 1).showHint === false && rulesToolbarLayout(RULES_TOOLBAR_NARROW_WIDTH).showHint === true && RULES_TOOLBAR_NARROW_WIDTH === 560);
ck('还没量到宽度(0)按宽算,桌面不先闪窄版', rulesToolbarLayout(0).showHint === true);
ck('全屏目录:手机竖屏不放', showRulesOutline(393, 12) === false);
ck('全屏目录:折叠屏展开 / 桌面放', showRulesOutline(1200, 12) === true && showRulesOutline(RULES_OUTLINE_MIN_WINDOW, 1) === true && showRulesOutline(RULES_OUTLINE_MIN_WINDOW - 1, 1) === false);
ck('全屏目录:没有标题不放', showRulesOutline(1200, 0) === false);

// 渲染侧契约
ck('阅读区 ScrollView 开 nestedScrollEnabled(Android 嵌套时手势归它)', /<ScrollView ref=\{readScroll\} nestedScrollEnabled/.test(section));
ck('原生阅读区:onTouchStart/End 做双击,按 blockAtY 找块', /onTouchEnd:/.test(section) && /blockAtY\(currentRects\(\), pageY - originY\.current\)/.test(section) && /isDoubleTap\(lastTap\.current, tap\)/.test(section));
ck('原生阅读区才挂 onBlockLayout(web 仍走 data-md-line)', /onBlockLayout=\{WEB \? undefined : onBlockLayout\}/.test(section) && /sourceLines=\{WEB\}/.test(section));
ck('原生编辑框跳转用 setSelection', /ta\.setSelection\?\.\(sel\.start, sel\.end\)/.test(section));
ck('原生编辑框记光标(onSelectionChange)', /onSelectionChange=\{\(e\) => onCaret\?\.\(e\.nativeEvent\.selection\.start\)\}/.test(section));
ck('工具条按 rulesToolbarLayout 决定状态句位置和提示', /\{bar\.statusOwnLine \? <View style=\{\{ flex: 1 \}\} \/> :/.test(section) && /\{bar\.statusOwnLine && message \? <View style=\{\{ width: '100%' \}\}>\{statusLine\}<\/View> : null\}/.test(section) && /bar\.showHint/.test(section));
ck('全屏目录按 showRulesOutline', /showRulesOutline\(windowWidth, outline\.length\)/.test(section));
ck('草稿状态往上报(节点页据此确认离开)', /onDirtyRef\.current\?\.\(unsavedForLeave\)/.test(section));
ck('MarkdownMessage:列表项报布局时带父列表 id', /lay\(`\$\{id\}\.\$\{itemIndex\}`, block\.itemLines\?\.\[itemIndex\], block\.itemLines\?\.\[itemIndex\], id\)/.test(md));

console.log(`node rules view: ${p}/${t} checks passed`);
process.exit(p === t ? 0 : 1);
