// #537 手机长按就地选区 + 微信式浮动菜单 —— 纯逻辑。ck 风格自执行脚本(不是 bun:test)。
// run: bun src/message-select-model.test.ts
import fs from 'node:fs';
import path from 'node:path';
import {
  acceptSelectionEvent, chunkMenuRows, clampSelection, fullSelection, handleZones, HANDLE_REACH_ABOVE, HANDLE_REACH_BELOW, isWholeSelection,
  lineIndexAt, placeMenuAvoidingHandles, placeSelectCard, placeSelectMenu, selectedPart, selectInputTraits, selectionLinesFromLayout,
  selectionPayload, selectMenuItems, zonesOverlap,
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


// ── #551 菜单避开选区手柄 ────────────────────────────────────────────────
// 行 → 偏移映射
const L = [{ y: 0, height: 21, text: '一二三四\n' }, { y: 21, height: 21, text: '五六七' }, { y: 42, height: 21, text: '八九' }];
ck('lineIndexAt:字符 0 在第 0 行', lineIndexAt(L, 0, true) === 0);
ck('lineIndexAt:行尾换行符仍在第 0 行', lineIndexAt(L, 4, true) === 0);
ck('lineIndexAt:字符 5(首个「五」)在第 1 行', lineIndexAt(L, 5, true) === 1);
ck('lineIndexAt:光标偏移 5(行交界)不 preferNext → 前一行', lineIndexAt(L, 5) === 0);
ck('lineIndexAt:越界 → 最后一行', lineIndexAt(L, 99, true) === 2);
ck('lineIndexAt:空行表 → -1', lineIndexAt([], 0) === -1);
const SL = selectionLinesFromLayout(L, { start: 6, end: 10 }, 10);
ck('选区 6..10 → 起点行 1、终点行 2', js(SL) === js({ startTop: 21, startBottom: 42, endTop: 42, endBottom: 63 }), js(SL));
const SL2 = selectionLinesFromLayout(L, { start: 0, end: 8 }, 10);
ck('终点取最后一个选中字符(end-1)所在行', !!SL2 && SL2.endTop === 21, js(SL2));
ck('没有行信息 → null(调用方退回按卡片放)', selectionLinesFromLayout([], { start: 0, end: 1 }, 1) === null);

// 手柄禁区
const zz = handleZones({ lines: { startTop: 0, startBottom: 21, endTop: 210, endBottom: 231 }, textTop: 300, clip: { top: 290, bottom: 800 } });
ck('起点手柄禁区 = 行顶上 HANDLE_REACH_ABOVE ~ 行底下 HANDLE_REACH_BELOW', !!zz.start && zz.start.top === 300 - HANDLE_REACH_ABOVE && zz.start.bottom === 321 + HANDLE_REACH_BELOW, js(zz));
ck('终点手柄禁区同理', !!zz.end && zz.end.top === 510 - HANDLE_REACH_ABOVE && zz.end.bottom === 531 + HANDLE_REACH_BELOW, js(zz));
const zs = handleZones({ lines: { startTop: 0, startBottom: 21, endTop: 2000, endBottom: 2021 }, textTop: 300, scrollY: 0, clip: { top: 290, bottom: 812 } });
ck('终点行在可见区外 → 没有终点手柄(不当禁区)', !!zs.start && zs.end === null, js(zs));
const zsc = handleZones({ lines: { startTop: 0, startBottom: 21, endTop: 400, endBottom: 421 }, textTop: 300, scrollY: 200, clip: { top: 290, bottom: 812 } });
ck('卡片里滚过 200 → 起点行滚出(无手柄),终点行上移 200', zsc.start === null && !!zsc.end && zsc.end.top === 500 - HANDLE_REACH_ABOVE, js(zsc));

// 截图复现(iPhone 0.2.205,390×844 换算):一条比屏还高的消息,卡片从 y=210 起一直到可见区底;整条选中。
const shotEdge = { top: 47, bottom: 34, left: 0, right: 0 };
const shotMenu = { width: 316, height: 160 };
const shotCard = { x: 70, y: 210, width: 290, height: 844 - 34 - 8 - 210 };
const textTop = shotCard.y + 10 + 4;
const old = placeSelectMenu({ anchor: shotCard, menu: shotMenu, viewport: vp, edge: shotEdge });
const shotZones = handleZones({ lines: { startTop: 0, startBottom: 21, endTop: 1400, endBottom: 1421 }, textTop, clip: { top: shotCard.y, bottom: shotCard.y + shotCard.height } });
ck('复现:#537 的放法在这里走 inside,并且盖住起点手柄(这就是 bug)', old.side === 'inside' && !!shotZones.start && zonesOverlap({ top: old.top, bottom: old.top + shotMenu.height }, shotZones.start), js({ old, z: shotZones.start }));
const fixed = placeMenuAvoidingHandles({ anchor: shotCard, menu: shotMenu, viewport: vp, edge: shotEdge, ...shotZones });
const noHit = (pl: { top: number }, z: { start: any; end: any }, h = shotMenu.height) => [z.start, z.end].every(q => !q || !zonesOverlap({ top: pl.top, bottom: pl.top + h }, q));
ck('修后:同一场景菜单不碰起点手柄', !fixed.overlapsHandle && noHit(fixed, shotZones), js(fixed));
ck('修后:仍整块在可见带内', fixed.top >= shotEdge.top + 8 && fixed.top + shotMenu.height <= vp.height - shotEdge.bottom - 8, js(fixed));
ck('修后:放在起点手柄下方的空档(上方只剩 ~140 放不下 160)', fixed.side === 'inside' && fixed.top === shotZones.start!.bottom + 6, js(fixed));

// 用户把终点拖到屏幕中间(截图里那只看得见的手柄):终点下方放得下 → below
const dragZones = handleZones({ lines: { startTop: 0, startBottom: 21, endTop: 330, endBottom: 351 }, textTop, clip: { top: shotCard.y, bottom: shotCard.y + shotCard.height } });
const dragged = placeMenuAvoidingHandles({ anchor: shotCard, menu: shotMenu, viewport: vp, edge: shotEdge, ...dragZones });
ck('终点在中间 → 菜单放终点手柄下方(below),两只手柄都不碰', dragged.side === 'below' && dragged.top === dragZones.end!.bottom + 6 && noHit(dragged, dragZones), js(dragged));

// 普通气泡:选区起点上方放得下 → above,底边离起点手柄禁区 gap
const midZones = handleZones({ lines: { startTop: 0, startBottom: 21, endTop: 42, endBottom: 63 }, textTop: 520, clip: { top: 506, bottom: 590 } });
const midP = placeMenuAvoidingHandles({ anchor: { x: 60, y: 506, width: 280, height: 84 }, menu: shotMenu, viewport: vp, edge: shotEdge, ...midZones });
ck('屏幕中间的气泡 → above,菜单底 = 起点手柄禁区顶 - 6', midP.side === 'above' && midP.top + shotMenu.height === midZones.start!.top - 6 && noHit(midP, midZones), js(midP));
// 选区只是中间一段:above 以**选区起点行**为准,不是卡片顶
const partZones = handleZones({ lines: { startTop: 210, startBottom: 231, endTop: 231, endBottom: 252 }, textTop: 100, clip: { top: 86, bottom: 800 } });
const partP = placeMenuAvoidingHandles({ anchor: { x: 60, y: 86, width: 280, height: 714 }, menu: shotMenu, viewport: vp, edge: shotEdge, ...partZones });
ck('选区在卡片中段 → 菜单贴着选区起点行上方,而不是被卡片顶逼到别处', partP.side === 'above' && partP.top + shotMenu.height === partZones.start!.top - 6, js(partP));

// 选区贴顶(起点上方放不下)→ 终点下方
const topZones = handleZones({ lines: { startTop: 0, startBottom: 21, endTop: 21, endBottom: 42 }, textTop: 80, clip: { top: 66, bottom: 140 } });
const topP = placeMenuAvoidingHandles({ anchor: { x: 60, y: 66, width: 280, height: 74 }, menu: shotMenu, viewport: vp, edge: shotEdge, ...topZones });
ck('贴顶的气泡 → below,在终点手柄禁区下 6', topP.side === 'below' && topP.top === topZones.end!.bottom + 6 && noHit(topP, topZones), js(topP));

// 键盘开着:不进键盘区,且不碰手柄
const kbZones = handleZones({ lines: { startTop: 0, startBottom: 21, endTop: 42, endBottom: 63 }, textTop: 360, clip: { top: 346, bottom: 430 } });
const kbP = placeMenuAvoidingHandles({ anchor: { x: 60, y: 346, width: 280, height: 84 }, menu: shotMenu, viewport: vp, edge: shotEdge, keyboardHeight: 330, ...kbZones });
ck('键盘开着 → 菜单底不进键盘,不碰手柄', kbP.top + shotMenu.height <= vp.height - 330 - 8 && noHit(kbP, kbZones) && !kbP.overlapsHandle, js(kbP));

// 选区两头都在屏外(中间一大段)→ 没有手柄可躲,放在卡片可见顶附近
const bothOut = placeMenuAvoidingHandles({ anchor: shotCard, menu: shotMenu, viewport: vp, edge: shotEdge, start: null, end: null });
ck('两只手柄都不可见 → inside,不报重叠,在可见带内', bothOut.side === 'inside' && !bothOut.overlapsHandle && bothOut.top >= shotEdge.top + 8, js(bothOut));

// 屏太矮,无处可放 → overlapsHandle=true(不假装躲开了)
const tiny = placeMenuAvoidingHandles({ anchor: { x: 0, y: 20, width: 300, height: 200 }, menu: shotMenu, viewport: { width: 320, height: 240 }, start: { top: 30, bottom: 90 }, end: { top: 150, bottom: 210 } });
ck('屏太矮放不开 → overlapsHandle=true', tiny.overlapsHandle === true, js(tiny));

// 随机扫:只要返回 overlapsHandle=false,就一定不碰任何手柄、整块在可见带内
let sweepBad = 0, sweepN = 0;
for (let sy = -400; sy <= 700; sy += 37) for (let ey = 0; ey <= 1400; ey += 53) for (const kbh of [0, 300]) {
  if (ey < sy + 21 && ey !== 0) continue;
  const cardA = { x: 40, y: 120, width: 300, height: 600 };
  const z = handleZones({ lines: { startTop: sy, startBottom: sy + 21, endTop: Math.max(sy, ey), endBottom: Math.max(sy, ey) + 21 }, textTop: 134, clip: { top: 120, bottom: 720 } });
  const pl = placeMenuAvoidingHandles({ anchor: cardA, menu: shotMenu, viewport: vp, edge: shotEdge, keyboardHeight: kbh, ...z });
  sweepN++;
  const band = { top: shotEdge.top + 8, bottom: vp.height - Math.max(shotEdge.bottom, kbh) - 8 };
  if (!pl.overlapsHandle && (!noHit(pl, z) || pl.top < band.top || pl.top + shotMenu.height > band.bottom)) sweepBad++;
}
ck(`扫 ${sweepN} 种选区/键盘组合:声称不重叠的放法全都真的不碰手柄且在屏内`, sweepN > 500 && sweepBad === 0, `bad=${sweepBad}`);

// ── #551 这一类:我们自己画、浮在可选文字上的菜单都必须走 placeMenuAvoidingHandles + 拖动时隐藏 ──
// 判据:藏掉系统菜单(contextMenuHidden 不是字面 false)= 我们自己出菜单 ⇒ 这个文件必须用手柄避让放法和隐藏开关。
const needsHandleRule = (src: string) => /contextMenuHidden=\{(?!false\})/.test(src);
const followsHandleRule = (src: string) => src.includes('placeMenuAvoidingHandles(') && src.includes('menuShown') && src.includes('SELECT_MENU_SETTLE_MS');
ck('判据自检:藏系统菜单的假文件 → 需要', needsHandleRule('<TextInput contextMenuHidden={traits.contextMenuHidden} />') && needsHandleRule('<TextInput contextMenuHidden={true} />'));
ck('判据自检:contextMenuHidden={false}(用系统菜单,系统自己躲手柄)→ 不需要', !needsHandleRule('<TextInput contextMenuHidden={false} />'));
ck('判据自检:没用规则的假文件 → 不合格', !followsHandleRule('placeSelectMenu({ anchor })'));
const srcFiles: string[] = [];
const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.tsx$/.test(e.name) && !/\.test\./.test(e.name)) srcFiles.push(f); } };
walk(__dirname);
const needing = srcFiles.filter(f => needsHandleRule(fs.readFileSync(f, 'utf8')));
const offenders = needing.filter(f => !followsHandleRule(fs.readFileSync(f, 'utf8')));
ck(`取集:递归扫 src/ 下 ${srcFiles.length} 个 .tsx,找到自画菜单的文件 ≥ 1(MessageSelectOverlay)`, srcFiles.length > 50 && needing.some(f => f.endsWith('MessageSelectOverlay.tsx')), needing.map(f => path.basename(f)).join(','));
ck('每个自画选区菜单都避让手柄 + 拖动时隐藏', offenders.length === 0, offenders.map(f => path.basename(f)).join(','));

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
ck('菜单位置:有选区几何时 placeMenuAvoidingHandles,量到之前 / 纯附件 placeSelectMenu', overlay.includes('placeMenuAvoidingHandles({') && overlay.includes('placeSelectMenu({ anchor, menu: menuSize'));
ck('#551 拖手柄时菜单隐藏:触摸按下 / 选区变化 → 藏,松手 + 停稳再出', overlay.includes('const menuShown = !!placed && !touching && !settling;') && overlay.includes('if (next.start !== sel.start || next.end !== sel.end) settle();') && overlay.includes("onTouchStart: touchDown") && overlay.includes("onPointerDown: touchDown"));
ck('#551 隐藏时不接点击(pointerEvents none),dataSet 暴露 hidden 供测试', overlay.includes("pointerEvents={menuShown ? 'auto' : 'none'}") && overlay.includes("hidden: menuShown ? '0' : '1'"));

console.log(`\n${p}/${t} passed`); process.exit(p === t ? 0 : 1);
