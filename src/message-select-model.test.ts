// #537 手机长按就地选区 + 微信式浮动菜单 —— 纯逻辑。ck 风格自执行脚本(不是 bun:test)。
// run: bun src/message-select-model.test.ts
import fs from 'node:fs';
import path from 'node:path';
import {
  acceptSelectionEvent, chunkMenuRows, clampSelection, fullSelection, isWholeSelection, placeSelectCard, placeSelectMenu,
  selectedPart, selectInputTraits, selectionPayload, selectMenuItems,
} from './message-select-model';
import { selectableTextOf } from './message-plain-text';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log('✅', n); } else console.log('❌', n, extra); };
const js = (v: unknown) => JSON.stringify(v);

// ── 选区归一化 ────────────────────────────────────────────────────────────
ck('反向区间(从后往前拖)→ 有序', js(clampSelection({ start: 9, end: 3 }, 20)) === js({ start: 3, end: 9 }));
ck('越界夹进 [0,len]', js(clampSelection({ start: -4, end: 99 }, 10)) === js({ start: 0, end: 10 }));
ck('null → 整条', js(clampSelection(null, 6)) === js({ start: 0, end: 6 }));
ck('fullSelection', js(fullSelection(7)) === js({ start: 0, end: 7 }));

// ── 复制 / 转发 / 引用拿哪段 ────────────────────────────────────────────
const plain = '创造型人才和哲学家，本质上就无法经营婚姻。';
ck('整条选中 → whole', isWholeSelection(fullSelection(plain.length), plain.length) && selectionPayload(plain, fullSelection(plain.length)).kind === 'whole');
ck('收成光标 → 按整条(没有「什么都没选的复制」)', selectionPayload(plain, { start: 5, end: 5 }).kind === 'whole');
const part = selectionPayload(plain, { start: 2, end: 18 });
ck('选了一段 → part = 那段子串(截图里的「型人才和哲学家，本质上就无法经营」)', part.kind === 'part' && part.text === '型人才和哲学家，本质上就无法经营', js(part));
ck('selectedPart 与 payload 一致', selectedPart(plain, { start: 18, end: 2 }) === '型人才和哲学家，本质上就无法经营');
ck('只选中空白 → 按整条(不把一个空格复制出去)', selectionPayload('甲 乙', { start: 1, end: 2 }).kind === 'whole');
// 选区卡片里显示的是纯文本(去 Markdown、去引用行),子串从那份纯文本里取
const raw = '「@示例节点: 旧话」\n## 发版\n**重点**:先合 PR 再发版';
const shown = selectableTextOf(raw);
ck('卡片文字 = 纯文本(去引用行 / 标题号 / 粗体记号)', shown === '发版\n\n重点:先合 PR 再发版', js(shown));
const s2 = selectionPayload(shown, { start: shown.indexOf('重点'), end: shown.indexOf('重点') + 2 });
ck('跨块后的子串仍对得上', s2.kind === 'part' && s2.text === '重点');

// ── 原生事件过滤 ────────────────────────────────────────────────────────
ck('打开 120ms 内的收成光标事件丢掉(autoFocus 冲掉默认全选)', !acceptSelectionEvent({ start: 3, end: 3 }, 120));
ck('打开 120ms 内的非空区间照收', acceptSelectionEvent({ start: 0, end: 4 }, 120));
ck('过了宽限期,收成光标照收(用户点了一下)', acceptSelectionEvent({ start: 3, end: 3 }, 900));

// ── 菜单 ────────────────────────────────────────────────────────────────
const keys = selectMenuItems({ hasText: true }).map(i => i.key);
ck('有文字:复制 · 全选 · 转发 · 引用 打头(微信顺序)', js(keys.slice(0, 4)) === js(['copy', 'selectAll', 'forward', 'quote']), js(keys));
ck('原长按菜单的动作一个不丢:多选 / 全屏选择 / 放大阅读 / 删除', ['multiSelect', 'selectText', 'expand', 'delete'].every(k => keys.includes(k as never)));
ck('删除在最后且标红', keys.at(-1) === 'delete' && selectMenuItems({ hasText: true }).at(-1)!.danger === true);
ck('纯附件:只有 多选 / 删除', js(selectMenuItems({ hasText: false }).map(i => i.key)) === js(['multiSelect', 'delete']));
ck('多选模式里不再给多选', !selectMenuItems({ hasText: true, selectionMode: true }).some(i => i.key === 'multiSelect'));
ck('没有转发名册时不给转发', !selectMenuItems({ hasText: true, canForward: false }).some(i => i.key === 'forward'));
const rows = chunkMenuRows(selectMenuItems({ hasText: true }));
ck('一行 5 个,8 项 → 5 + 3 两行', rows.length === 2 && rows[0].length === 5 && rows[1].length === 3);

// ── 放置:上方 → 翻下方 → 压在气泡里;水平夹进屏幕 ────────────────────────
const vp = { width: 390, height: 844 };
const menu = { width: 316, height: 150 };
const edge = { top: 32, bottom: 24, left: 0, right: 0 };
const mid = placeSelectMenu({ anchor: { x: 60, y: 420, width: 280, height: 80 }, menu, viewport: vp, edge });
ck('屏幕中间的气泡 → 菜单在上方,底边离气泡 10', mid.side === 'above' && mid.top + menu.height === 410, js(mid));
const topB = placeSelectMenu({ anchor: { x: 60, y: 60, width: 280, height: 80 }, menu, viewport: vp, edge });
ck('贴顶的气泡 → 翻到下方,顶边在气泡下 10', topB.side === 'below' && topB.top === 150, js(topB));
ck('翻下后整块在屏内', topB.top >= edge.top && topB.top + menu.height <= vp.height - edge.bottom);
const tall = placeSelectMenu({ anchor: { x: 60, y: 20, width: 280, height: 900 }, menu, viewport: vp, edge });
ck('比屏还高的气泡 → inside,仍整块在可见区里', tall.side === 'inside' && tall.top >= edge.top + 8 && tall.top + menu.height <= vp.height - edge.bottom - 8, js(tall));
const kb = placeSelectMenu({ anchor: { x: 60, y: 520, width: 280, height: 80 }, menu, viewport: vp, edge, keyboardHeight: 300 });
ck('键盘开着:上方放得下就放上方,底边不进键盘', kb.side === 'above' && kb.top + menu.height <= vp.height - 300, js(kb));
const kb2 = placeSelectMenu({ anchor: { x: 60, y: 40, width: 280, height: 400 }, menu, viewport: vp, edge, keyboardHeight: 300 });
ck('键盘开着且上下都放不下 → 不进键盘区', kb2.top + menu.height <= vp.height - 300 - 8, js(kb2));
const right = placeSelectMenu({ anchor: { x: 330, y: 500, width: 50, height: 40 }, menu, viewport: vp, edge });
ck('右边的窄气泡 → 菜单右边夹在屏内 8', right.left + menu.width === vp.width - 8, js(right));
ck('小三角指向气泡中心(夹在圆角内)', right.arrowX === Math.min(355 - right.left, menu.width - 16), js(right));
const left = placeSelectMenu({ anchor: { x: 0, y: 500, width: 40, height: 40 }, menu, viewport: vp, edge });
ck('左边 → 左边夹 8,三角不出圆角', left.left === 8 && left.arrowX === 16, js(left));
const narrow = placeSelectMenu({ anchor: { x: 0, y: 500, width: 200, height: 40 }, menu: { width: 400, height: 150 }, viewport: { width: 320, height: 640 } });
ck('菜单比屏还宽 → 贴左 8(maxWidth 由渲染层收)', narrow.left === 8);

// 选区卡片
const card = placeSelectCard({ anchor: { x: 60, y: -100, width: 280, height: 500 }, viewportHeight: 844, edge });
ck('气泡顶滚出屏 → 卡片从可见区顶开始', card.top === edge.top + 8 && card.minHeight === 400 - card.top, js(card));
const card2 = placeSelectCard({ anchor: { x: 60, y: 300, width: 280, height: 80 }, viewportHeight: 844, edge });
ck('普通气泡 → 卡片与气泡同位同宽同高(min),maxHeight 到可见区底', card2.top === 300 && card2.left === 60 && card2.width === 280 && card2.minHeight === 80 && card2.maxHeight === 844 - 24 - 8 - 300, js(card2));

// ── 原生控件:按平台(RN 0.85 源码结论)───────────────────────────────────
const a = selectInputTraits('android'), i = selectInputTraits('ios'), w = selectInputTraits('web');
ck('安卓:可编辑(禁用的 EditText 选不中)+ 不弹键盘', a.readOnly === false && a.showSoftInputOnFocus === false);
ck('安卓:不藏系统菜单(contextMenuHidden 会让系统把选区收成光标)', a.contextMenuHidden === false);
ck('iOS:只读 + 藏系统菜单,只留我们的', i.readOnly === true && i.contextMenuHidden === true);
ck('web:只读 textarea', w.readOnly === true);

// ── 接线(源码契约)──────────────────────────────────────────────────────
const chat = fs.readFileSync(path.join(__dirname, 'ChatScreen.tsx'), 'utf8');
const overlay = fs.readFileSync(path.join(__dirname, 'MessageSelectOverlay.tsx'), 'utf8');
ck('三处长按都进就地选区(且只在触摸端)', (chat.match(/onLongPress=\{pointer \? undefined : \(\) => openSelect\(/g) ?? []).length === 3);
ck('选区层只在触摸端渲染', chat.includes('{pointer ? null : <MessageSelectOverlay'));
ck('整条复制仍走 copyMessage(copyTextOf),一段走 copyValue 原样', chat.includes("if (key === 'copy') { void (part !== null ? copyValue(part) : copyMessage(selection.text)); return; }"));
ck('转发复用 openForwardPicker', chat.includes("if (key === 'forward') { void openForwardPicker(part !== null ? { ...selection, text: part } : selection); return; }"));
ck('引用复用 setQuote + compactQuoteText', chat.includes('setQuote({ author: selection.author, text: compactQuoteText(part ?? selection.text) })'));
ck('卡片文字与气泡同一条管线(selectableTextOf)', overlay.includes("selectableTextOf(target?.raw ?? '')"));
ck('受控 selection + 事件过滤', overlay.includes('selection={sel}') && overlay.includes('acceptSelectionEvent(next, Date.now() - openedAt.current)'));
ck('全选 = 把选区设回整条(不关菜单)', overlay.includes("if (key === 'selectAll') { setSel(fullSelection(plain.length)); return; }"));
ck('点空白退出', overlay.includes('testID="msg-select-backdrop"') && /msg-select-backdrop"[^>]*/.test(overlay) && overlay.includes('onPress={onClose}'));
ck('菜单位置由 placeSelectMenu 算', overlay.includes('placeSelectMenu({ anchor, menu: menuSize'));

console.log(`\n${p}/${t} passed`); process.exit(p === t ? 0 : 1);
