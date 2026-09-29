// 规则文件「左右」分栏编辑的纯模型。ck 风格自执行脚本(不是 bun:test)。
// @ts-expect-error app tsconfig 不带 node 类型(其余读源码的 ck 测试同样报这一条);运行时由 node/bun 提供。
import { readFileSync } from 'node:fs';
import {
  clampSplitRatio, effectiveRulesMode, findModeFor, initialRulesMode, monotonicAnchors, parseStoredRulesMode, parseStoredSplitRatio,
  previewBlockForLine, previewYForLine, RULES_MODE_LABEL, RULES_SPLIT_MIN_WIDTH, rulesModeTabs, rulesSplitAvailable, rulesWideLayout,
  SPLIT_DIVIDER_HIT, SPLIT_PREVIEW_DEBOUNCE_MS, SPLIT_RATIO_DEFAULT, SPLIT_RATIO_MAX, SPLIT_RATIO_MIN, splitDividerHandlers, splitPaneWidths,
  splitRatioFromDrag, syncedScrollTop, rulesEditorPrefs, type PreviewBlock,
} from './rules-split';
import { buildRulesOutline } from './node-rules-view';
import { parseMarkdownBlocks } from './markdown-model';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) p++; else console.log(`  ✗ ${n}`); };
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
// 读源码的断言:换行统一成 LF(Windows 检出是 CRLF,正则里的 \n 会对不上)。
const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// ── 宽窄:用 App.tsx 同一个 chooseAppLayout ──────────────────────────
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel Fold) AppleWebKit/537.36 Chrome/140.0 Safari/537.36';
ck('Tauri 桌面 2048 宽 = 宽', rulesWideLayout({ os: 'web', tauri: true, width: 2048 }));
ck('Tauri 桌面 1200 宽 = 宽', rulesWideLayout({ os: 'web', tauri: true, width: 1200 }));
ck('Tauri 窗口缩到 800(桌面走手机布局)= 窄', !rulesWideLayout({ os: 'web', tauri: true, width: 800 }));
ck('手机 390 = 窄', !rulesWideLayout({ os: 'android', tauri: false, width: 390 }));
ck('合上的折叠屏(外屏 ~410 dp)= 窄', !rulesWideLayout({ os: 'android', tauri: false, width: 410 }));
ck('展开的折叠屏(~880 dp)= 宽', rulesWideLayout({ os: 'android', tauri: false, width: 880 }));
ck('web 导出里的安卓 UA 走同一判定', !rulesWideLayout({ os: 'web', tauri: true, userAgent: UA_ANDROID, width: 390 }) && rulesWideLayout({ os: 'web', tauri: true, userAgent: UA_ANDROID, width: 880 }));

// ── 模式:宽默认左右,窄不给左右,偏好优先 ──────────────────────────────
ck('宽布局第一次打开默认「左右」', initialRulesMode(null, true) === 'split');
ck('窄布局第一次打开默认「阅读」(和以前一样)', initialRulesMode(null, false) === 'read');
ck('选过就用选过的(宽)', initialRulesMode('edit', true) === 'edit' && initialRulesMode('read', true) === 'read');
ck('选过就用选过的(窄)', initialRulesMode('edit', false) === 'edit');
ck('窄:不给「左右」tab', rulesModeTabs(rulesSplitAvailable(false, 0)).join() === 'read,edit');
ck('宽:三个 tab,顺序 阅读/编辑/左右', rulesModeTabs(rulesSplitAvailable(true, 1400)).join() === 'read,edit,split');
ck('tab 文案', RULES_MODE_LABEL.read === '阅读' && RULES_MODE_LABEL.edit === '编辑' && RULES_MODE_LABEL.split === '左右');
ck('宽但区块还没量到(0)按可用算(不闪两个 tab)', rulesSplitAvailable(true, 0));
ck('宽但区块被挤窄(< 640)不给', !rulesSplitAvailable(true, RULES_SPLIT_MIN_WIDTH - 1) && rulesSplitAvailable(true, RULES_SPLIT_MIN_WIDTH));
ck('窄布局就算区块很宽也不给', !rulesSplitAvailable(false, 3000));
ck('选了左右但此刻不可用 ⇒ 画编辑', effectiveRulesMode('split', false) === 'edit');
ck('选了左右且可用 ⇒ 左右', effectiveRulesMode('split', true) === 'split');
ck('阅读 / 编辑不受可用性影响', effectiveRulesMode('read', false) === 'read' && effectiveRulesMode('edit', true) === 'edit');
ck('手机上存过「左右」(从桌面带来的偏好)也画编辑', effectiveRulesMode(initialRulesMode('split', false), rulesSplitAvailable(false, 0)) === 'edit');
ck('查找:左右查源码', findModeFor('split') === 'edit' && findModeFor('edit') === 'edit' && findModeFor('read') === 'read');

// ── 偏好持久化:存 → 读回 ─────────────────────────────────────────
ck('模式存值读回', (['read', 'edit', 'split'] as const).every((m) => parseStoredRulesMode(m) === m));
ck('认不出的模式当没存过', parseStoredRulesMode(null) === null && parseStoredRulesMode('') === null && parseStoredRulesMode('SPLIT') === null && parseStoredRulesMode('preview') === null);
ck('比例存值读回', parseStoredSplitRatio((0.62).toFixed(4)) === 0.62);
ck('比例坏值当没存过', [null, '', 'abc', '0', '1', '-0.3', '1.5', 'NaN', 'Infinity'].every((v) => parseStoredSplitRatio(v as any) === null));
ck('存过的比例越界也夹回 25–75%', parseStoredSplitRatio('0.1') === SPLIT_RATIO_MIN && parseStoredSplitRatio('0.9') === SPLIT_RATIO_MAX);

// 偏好:存 → 读回(假存储后端;web 用 localStorage、原生用 JSON 文件,都走这一层)。
{
  const store = new Map<string, string>();
  const prefs = rulesEditorPrefs({ get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); } });
  const before = await prefs.load();
  ck('从没存过:全是 null', before.mode === null && before.ratio === null && before.scrollSync === null && before.outlineOpen === null);
  await prefs.saveMode('split');
  await prefs.saveRatio(0.4);
  await prefs.saveScrollSync(false);
  await prefs.saveOutlineOpen(false);
  const after = await prefs.load();
  ck('存了再读:模式', after.mode === 'split');
  ck('存了再读:比例', after.ratio === 0.4);
  ck('存了再读:同步开关 / 目录收起', after.scrollSync === false && after.outlineOpen === false);
  await prefs.saveRatio(Number.NaN);
  ck('坏比例不写盘', (await prefs.load()).ratio === 0.4);
  const broken = rulesEditorPrefs({ get: async () => { throw new Error('disk'); }, set: async () => {} });
  const none = await broken.load();
  ck('存储读失败 ⇒ 当没存过(不抛)', none.mode === null && none.ratio === null);
  // 往返:宽布局下选过「编辑」,下次打开还是编辑,不回到默认的左右。
  await prefs.saveMode('edit');
  ck('往返:宽布局存过编辑 ⇒ 下次打开编辑', initialRulesMode((await prefs.load()).mode, true) === 'edit');
  const prefsSrc = src('./rules-editor-prefs.ts');
  ck('接线:web 用 localStorage,原生写 JSON 文件', /localStorage/.test(prefsSrc) && /writeAsStringAsync/.test(prefsSrc) && /rulesEditorPrefs\(/.test(prefsSrc));
}

// ── 分隔条:夹紧、拖动、双击复位 ─────────────────────────────────────
ck('默认 50/50', SPLIT_RATIO_DEFAULT === 0.5);
ck('每栏至少 25%', clampSplitRatio(0.1) === 0.25 && clampSplitRatio(0.9) === 0.75 && clampSplitRatio(0.3) === 0.3);
ck('NaN ⇒ 默认', clampSplitRatio(Number.NaN) === 0.5);
ck('拖动:+200px / 1000px 宽 ⇒ +20%', near(splitRatioFromDrag(0.5, 200, 1000), 0.7));
ck('拖出左边界 ⇒ 25%', splitRatioFromDrag(0.5, -5000, 1000) === 0.25);
ck('拖出右边界 ⇒ 75%', splitRatioFromDrag(0.5, 5000, 1000) === 0.75);
ck('宽还没量到(0)不动', splitRatioFromDrag(0.6, 300, 0) === 0.6);
ck('两栏宽加起来正好是总宽', [[1000, 0.5], [1487, 0.333], [1789, 0.61], [641, 0.25]].every(([w, r]) => { const x = splitPaneWidths(w, r); return x.left + x.right === w; }));
ck('两栏宽按比例 + 夹紧', splitPaneWidths(1000, 0.1).left === 250 && splitPaneWidths(1000, 0.5).left === 500);
ck('分隔条热区 ≥ 8px', SPLIT_DIVIDER_HIT >= 8);
ck('预览节流约 150 ms', SPLIT_PREVIEW_DEBOUNCE_MS === 150);

{
  let ratio = 0.5, now = 1000, commits: number[] = [], resets = 0, live: number[] = [];
  const h = splitDividerHandlers({
    getRatio: () => ratio, getWidth: () => 1000, now: () => now,
    setRatio: (r) => { live.push(r); ratio = r; },
    commit: (r) => { commits.push(r); ratio = r; },
    reset: () => { resets++; ratio = 0.5; },
  });
  h.onPanResponderGrant();
  h.onPanResponderMove(undefined, { dx: 100 });
  h.onPanResponderMove(undefined, { dx: 150 });
  h.onPanResponderRelease(undefined, { dx: 150 });
  ck('拖动:移动中实时给比例', live.length === 2 && near(live[1], 0.65));
  ck('拖动:松手定在 65%', commits.length === 1 && near(commits[0], 0.65) && resets === 0);
  // 双击:两次原地点按 ≤ 300 ms
  now = 5000; h.onPanResponderGrant(); h.onPanResponderRelease(undefined, { dx: 1 });
  now = 5200; h.onPanResponderGrant(); h.onPanResponderRelease(undefined, { dx: 0 });
  ck('双击 ⇒ 复位 50/50', resets === 1 && ratio === 0.5);
  ck('单击不改比例', near(commits[1], 0.65));
  // 两次点按相隔太久 ⇒ 不是双击
  now = 9000; h.onPanResponderGrant(); h.onPanResponderRelease(undefined, { dx: 0 });
  now = 9600; h.onPanResponderGrant(); h.onPanResponderRelease(undefined, { dx: 0 });
  ck('相隔 600 ms 不算双击', resets === 1);
  // 拖动之后紧跟一次点按不算双击(拖动清掉了上一次点按)
  now = 12000; h.onPanResponderGrant(); h.onPanResponderRelease(undefined, { dx: 0 });
  now = 12100; h.onPanResponderGrant(); h.onPanResponderMove(undefined, { dx: 80 }); h.onPanResponderRelease(undefined, { dx: 80 });
  now = 12200; h.onPanResponderGrant(); h.onPanResponderRelease(undefined, { dx: 0 });
  ck('点按 → 拖动 → 点按 不算双击', resets === 1);
  // 被打断:停在最后显示的位置
  ratio = 0.5; h.onPanResponderGrant(); h.onPanResponderMove(undefined, { dx: -100 }); h.onPanResponderTerminate();
  ck('被系统手势打断 ⇒ 停在最后显示的 40%', near(ratio, 0.4));
}

// ── 源码行 → 预览块 ────────────────────────────────────────────────
// 合成文档(不用任何真实规则文件):用渲染同一个解析器取块的行号,预览 y 人为给定。
const doc = [
  '# 总则',          // 0
  '',                 // 1
  '第一段。',         // 2
  '第一段第二行。',   // 3
  '',                 // 4
  '## 第二节',        // 5
  '',                 // 6
  '- 甲',             // 7
  '- 乙',             // 8
  '',                 // 9
  '```',              // 10
  '# 代码里的注释',   // 11
  '```',              // 12
  '',                 // 13
  '## 第三节',        // 14
  '尾段。',           // 15
].join('\r\n'); // CRLF:解析器和映射都按行号走,不受换行风格影响
const parsed = parseMarkdownBlocks(doc);
ck('合成文档解析出 7 个块(标题×3 段落×2 列表 代码)', parsed.length === 7);
const tops = [0, 40, 100, 160, 260, 340, 380];
const blocks: PreviewBlock[] = parsed.map((b, i) => ({ start: b.line ?? 0, end: b.endLine ?? b.line ?? 0, top: tops[i] }));
ck('块行号(CRLF 也按行算)', blocks.map((b) => `${b.start}-${b.end}`).join(',') === '0-0,2-3,5-5,7-8,10-12,14-14,15-15');
ck('标题行 → 那个标题块', previewBlockForLine(blocks, 5) === 2 && previewBlockForLine(blocks, 14) === 5);
ck('段落第二行 → 段落块', previewBlockForLine(blocks, 3) === 1);
ck('块之间的空行 → 前一块', previewBlockForLine(blocks, 4) === 1 && previewBlockForLine(blocks, 13) === 4);
ck('代码块里的「# 注释」→ 代码块,不是标题', previewBlockForLine(blocks, 11) === 4);
ck('最后一行之后 → 最后一块', previewBlockForLine(blocks, 99) === 6);
ck('空 ⇒ -1', previewBlockForLine([], 3) === -1);
{ const rev = [...blocks].reverse(); ck('任意顺序输入', rev[previewBlockForLine(rev, 5)].start === 5 && rev[previewBlockForLine(rev, 99)].start === 15); }
ck('块首行 → 块顶', previewYForLine(blocks, 5) === 100 && previewYForLine(blocks, 0) === 0);
ck('块之间按行比例插值', near(previewYForLine(blocks, 3.5)!, 40 + (1.5 / 3) * 60));
ck('最后一块之后停在它顶部', previewYForLine(blocks, 50) === 380);
ck('空 ⇒ null', previewYForLine([], 1) === null);

// 目录条目带行号,点目录时源码滚到这一行。
const outline = buildRulesOutline(doc);
ck('目录带标题行号(代码块里的 # 不收)', outline.map((h) => `${h.text}@${h.line}`).join('|') === '总则@0|第二节@5|第三节@14');

// ── 滚动同步:锚点之间按比例插值 ─────────────────────────────────────
const anchors = [{ src: 100, dst: 300 }, { src: 200, dst: 400 }, { src: 400, dst: 1000 }];
ck('锚点上正好对齐', syncedScrollTop(anchors, 200, 1000, 2000) === 400);
ck('锚点之间插值', syncedScrollTop(anchors, 300, 1000, 2000) === 700);
ck('顶端 0 ⇒ 0', syncedScrollTop(anchors, 0, 1000, 2000) === 0);
ck('源码滚到底 ⇒ 预览也到底', syncedScrollTop(anchors, 1000, 1000, 2000) === 2000);
ck('最后锚点到底之间也插值', syncedScrollTop(anchors, 700, 1000, 2000) === 1500);
ck('没有锚点 = 按比例', syncedScrollTop([], 250, 1000, 2000) === 500);
ck('一边滚不动 ⇒ 0', syncedScrollTop(anchors, 300, 0, 2000) === 0 && syncedScrollTop(anchors, 300, 1000, 0) === 0);
ck('越界夹紧', syncedScrollTop(anchors, -50, 1000, 2000) === 0 && syncedScrollTop(anchors, 5000, 1000, 2000) === 2000);
ck('倒走的锚点被扔掉(不会让预览倒跳)', monotonicAnchors([{ src: 100, dst: 300 }, { src: 150, dst: 200 }, { src: 200, dst: 400 }]).map((a) => a.src).join() === '100,200');
ck('同一 src 只留一个', monotonicAnchors([{ src: 100, dst: 300 }, { src: 100, dst: 310 }]).length === 1);
{
  let prev = -1, mono = true;
  for (let s = 0; s <= 1000; s += 7) { const d = syncedScrollTop([{ src: 120, dst: 90 }, { src: 110, dst: 500 }, { src: 600, dst: 700 }], s, 1000, 1500); if (d < prev) mono = false; prev = d; }
  ck('乱序 / 冲突锚点下仍单调', mono);
}

// ── 接线契约:组件确实用了这些 ─────────────────────────────────────
const section = src('./NodeRulesSection.tsx');
ck('模式由 effectiveRulesMode(… initialRulesMode(null, splitOk) …) 决定(放不下左右的宽布局卡片默认阅读)', /effectiveRulesMode\(chosen \?\? initialRulesMode\(null, splitOk\), splitOk\)/.test(section));
ck('宽布局但卡片放不下左右、没选过 ⇒ 阅读', effectiveRulesMode(initialRulesMode(null, rulesSplitAvailable(true, 560)), rulesSplitAvailable(true, 560)) === 'read');
ck('tab 按 rulesModeTabs(splitOk) 给', /rulesModeTabs\(splitOk\)/.test(section));
ck('切模式存盘', /changeMode[\s\S]{0,200}saveRulesMode\(next\)/.test(section));
ck('查找在左右里查源码', /mode: findModeFor\(mode\)/.test(section));
ck('预览用阅读同一个 MarkdownMessage', /rendered\(preview, false\)/.test(section) && /rendered\(draft, true\)/.test(section));
ck('预览节流', /useDebounced\(draft, split \? SPLIT_PREVIEW_DEBOUNCE_MS : 0\)/.test(section));
ck('全屏不再把编辑框限在 1080 居中', !/maxWidth: 1080/.test(section));
ck('Ctrl/⌘+F 在捕获阶段监听(光标在编辑框里也收得到:RN-web TextInput 会 stopPropagation)', /addEventListener\('keydown', onKey, true\)/.test(src('./RulesFind.tsx')));
ck('目录在所有模式都能点', !/disabled=\{mode !== 'read'\}/.test(section));

console.log(`\n${p}/${t} passed`);
// @ts-expect-error 同上:process 由 node/bun 提供
if (p !== t) process.exit(1);
