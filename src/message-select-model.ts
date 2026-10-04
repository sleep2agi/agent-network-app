/**
 * 长按消息 → 就地选区 + 浮动菜单(微信安卓同款,#537 Vincent 2026-10-04 10:48:「这个需求比较高的优先级，
 * 要能支持这样的一个复制方式」,截图是微信长按后:整条选中、两只绿色手柄、气泡上方深色浮条
 * 「复制 / 全选 / 转发 / 收藏 / 搜一搜」+ 第二行「引用」)。
 *
 * 这里只放纯逻辑,不 import react-native:选区归一化、复制 / 转发 / 引用拿哪段字、菜单项和分行、
 * 菜单放在气泡上方还是下方(放不下就翻)、原生选区事件里哪些要丢。渲染在 MessageSelectOverlay.tsx。
 */

export interface TextSelection { readonly start: number; readonly end: number }

/** 有序、夹在 [0, len] 内。原生事件偶尔给反向区间(从后往前拖)或越界值(文字刚换过)。 */
export const clampSelection = (sel: TextSelection | null | undefined, len: number): TextSelection => {
  const n = Math.max(0, len | 0);
  if (!sel) return { start: 0, end: n };
  const a = Math.min(n, Math.max(0, Math.round(Number(sel.start) || 0)));
  const b = Math.min(n, Math.max(0, Math.round(Number(sel.end) || 0)));
  return a <= b ? { start: a, end: b } : { start: b, end: a };
};

export const fullSelection = (len: number): TextSelection => ({ start: 0, end: Math.max(0, len | 0) });

export const isCollapsed = (sel: TextSelection): boolean => sel.start === sel.end;

/** 整条都选中。空选区(用户点了一下文字把选区收成光标)也按整条算 —— 微信里不存在「什么都没选的复制」。 */
export const isWholeSelection = (sel: TextSelection, len: number): boolean => {
  const s = clampSelection(sel, len);
  return isCollapsed(s) || (s.start === 0 && s.end === len);
};

export const selectedPart = (plain: string, sel: TextSelection): string => {
  const s = clampSelection(sel, plain.length);
  return plain.slice(s.start, s.end);
};

/**
 * 菜单动作拿哪段字:
 *   whole  —— 整条选中:交还给调用方按原有「复制整条」走(copyTextOf:去引用行、保留 Markdown 原文),
 *             与以前长按「复制」的结果逐字相同;
 *   part   —— 拖过手柄只选了一段:就是选区里的那段纯文本,原样(不过 copyTextOf,那会把「」开头的选区当引用行剥掉)。
 */
export type SelectionPayload = { readonly kind: 'whole' } | { readonly kind: 'part'; readonly text: string };
export const selectionPayload = (plain: string, sel: TextSelection): SelectionPayload => {
  if (isWholeSelection(sel, plain.length)) return { kind: 'whole' };
  const text = selectedPart(plain, sel);
  return text.trim() ? { kind: 'part', text } : { kind: 'whole' };
};

/**
 * 原生选区事件过滤。安卓 EditText 拿到焦点时会把**当前**选区报一次(ReactEditText.onFocusChanged),
 * 某些机型 autoFocus 的那一下选区还是光标位置 —— 照收的话「默认整条选中」刚画出来就被冲掉。
 * 所以打开后的头 `graceMs` 内,一个**收成光标**的事件不算用户操作,丢掉;非空区间(用户真拖了)照收。
 */
export const acceptSelectionEvent = (next: TextSelection, msSinceOpen: number, graceMs = 400): boolean =>
  !(isCollapsed(next) && msSinceOpen >= 0 && msSinceOpen < graceMs);

// ── 菜单 ────────────────────────────────────────────────────────────────────

export type SelectMenuKey = 'copy' | 'selectAll' | 'forward' | 'quote' | 'multiSelect' | 'selectText' | 'expand' | 'delete';

export interface SelectMenuItem {
  readonly key: SelectMenuKey;
  /** Ionicons 名 */
  readonly icon: string;
  readonly danger?: boolean;
}

export interface SelectMenuContext {
  /** 有可选的正文。纯附件(只有图)的气泡没有 —— 只给多选 / 删除。 */
  readonly hasText: boolean;
  /** 已在多选模式里不再给「多选」。 */
  readonly selectionMode?: boolean;
  /** 转发要有名册;默认给。 */
  readonly canForward?: boolean;
}

/**
 * 浮动菜单的项,顺序照微信:复制 · 全选 · 转发 · 引用 —— 然后是我们原有长按菜单里的其余动作,一个不丢:
 * 多选 · 全屏选择(原「选择文本」整屏页,长消息超过一屏时还要它)· 放大阅读 · 删除(最后,红色)。
 * 微信的「收藏 / 搜一搜」我们没有对应功能,不放空按钮。
 */
export const selectMenuItems = (ctx: SelectMenuContext): SelectMenuItem[] => {
  const canForward = ctx.canForward !== false && ctx.hasText;
  return [
    ...(ctx.hasText ? [{ key: 'copy' as const, icon: 'copy-outline' }, { key: 'selectAll' as const, icon: 'document-text-outline' }] : []),
    ...(canForward ? [{ key: 'forward' as const, icon: 'arrow-redo-outline' }] : []),
    ...(ctx.hasText ? [{ key: 'quote' as const, icon: 'chatbox-ellipses-outline' }] : []),
    ...(ctx.selectionMode ? [] : [{ key: 'multiSelect' as const, icon: 'checkmark-circle-outline' }]),
    ...(ctx.hasText ? [{ key: 'selectText' as const, icon: 'scan-outline' }, { key: 'expand' as const, icon: 'expand-outline' }] : []),
    { key: 'delete' as const, icon: 'trash-outline', danger: true },
  ];
};

/** 微信一行 5 个。 */
export const SELECT_MENU_PER_ROW = 5;
export const chunkMenuRows = <T,>(items: readonly T[], perRow = SELECT_MENU_PER_ROW): T[][] => {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += perRow) rows.push(items.slice(i, i + perRow));
  return rows;
};

// ── 放置 ────────────────────────────────────────────────────────────────────

export interface Rect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
/** Modal 自己窗口的四边安全区(useModalSafePadding('fullScreen') 的值,规则 2:Modal 自己垫一次)。 */
export interface Insets { readonly top: number; readonly bottom: number; readonly left: number; readonly right: number }
export type MenuPlacementSide = 'above' | 'below' | 'inside';
export interface MenuPlacement {
  readonly left: number;
  readonly top: number;
  readonly side: MenuPlacementSide;
  /** 小三角相对菜单左边的 x(指向气泡水平中心,夹在圆角内)。 */
  readonly arrowX: number;
}

/** 可用的竖直区间:状态栏下、(底部安全区 / 键盘 取大者)上,各留 margin。 */
export const visibleBand = (viewportHeight: number, edge: Insets, keyboardHeight: number, margin: number) => ({
  top: edge.top + margin,
  bottom: viewportHeight - Math.max(edge.bottom, keyboardHeight > 0 ? keyboardHeight : 0) - margin,
});

/**
 * 菜单放哪:
 *   1. 气泡上方放得下 → 上方(微信默认);
 *   2. 否则下方放得下 → 下方(气泡贴着屏幕顶,翻下来);
 *   3. 都放不下(气泡比可见区还高)→ 压在气泡可见部分的顶端,仍整块在屏内。
 * 水平:以气泡中心为准,夹进屏幕左右(含安全区)。永远不越出屏幕、不被键盘盖住。
 */
export const placeSelectMenu = (args: {
  anchor: Rect;
  menu: { width: number; height: number };
  viewport: { width: number; height: number };
  edge?: Insets;
  keyboardHeight?: number;
  gap?: number;
  margin?: number;
}): MenuPlacement => {
  const edge = args.edge ?? { top: 0, bottom: 0, left: 0, right: 0 };
  const gap = args.gap ?? 10;
  const margin = args.margin ?? 8;
  const { anchor, menu, viewport } = args;
  const band = visibleBand(viewport.height, edge, args.keyboardHeight ?? 0, margin);
  const aboveTop = anchor.y - gap - menu.height;
  const belowTop = anchor.y + anchor.height + gap;
  let side: MenuPlacementSide;
  let top: number;
  if (aboveTop >= band.top) { side = 'above'; top = aboveTop; }
  else if (belowTop + menu.height <= band.bottom) { side = 'below'; top = belowTop; }
  else {
    side = 'inside';
    top = Math.max(band.top, Math.min(Math.max(anchor.y, band.top) + gap, band.bottom - menu.height));
  }
  const minLeft = edge.left + margin;
  const maxLeft = viewport.width - edge.right - margin - menu.width;
  const centre = anchor.x + anchor.width / 2;
  const left = maxLeft < minLeft ? minLeft : Math.max(minLeft, Math.min(centre - menu.width / 2, maxLeft));
  const arrowX = Math.max(16, Math.min(centre - left, menu.width - 16));
  return { left, top, side, arrowX };
};

/**
 * 选区卡片(盖在气泡上的那块可选文字)放哪:与气泡同左同宽、从气泡顶开始;气泡顶已经滚出可见区时从可见区顶开始,
 * 最高到可见区底(超出的在卡片里滚)。最小高度 = 气泡在可见区里的高度,盖住底下的气泡。
 */
export const placeSelectCard = (args: { anchor: Rect; viewportHeight: number; edge?: Insets; keyboardHeight?: number; margin?: number }) => {
  const edge = args.edge ?? { top: 0, bottom: 0, left: 0, right: 0 };
  const band = visibleBand(args.viewportHeight, edge, args.keyboardHeight ?? 0, args.margin ?? 8);
  const top = Math.max(args.anchor.y, band.top);
  const maxHeight = Math.max(48, band.bottom - top);
  const minHeight = Math.max(0, Math.min(args.anchor.y + args.anchor.height, band.bottom) - top);
  return { left: args.anchor.x, width: args.anchor.width, top, minHeight: Math.min(minHeight, maxHeight), maxHeight };
};

/**
 * 承载选区的原生控件(RN 0.85 源码核对过,见 PR #537):
 *   android —— 可编辑的 TextInput + showSoftInputOnFocus=false(不弹键盘)+ 受控 value(改不动):
 *              🔴 editable=false 在安卓是 `view.isEnabled = false`,禁用的 EditText 选不中;
 *              🔴 contextMenuHidden 在安卓让自定义 ActionMode 回调返回 false,系统随即把选区收成光标 —— 手柄一拖就没了,
 *                 所以安卓不藏系统浮条(拖完手柄系统会再弹自己的「复制/全选」浮条,和我们的菜单并存)。
 *   ios     —— 只读 TextInput(UITextView editable=NO 仍可区间选择、有原生手柄)+ contextMenuHidden(藏掉系统
 *              「拷贝/查询」菜单,只留我们的)。
 *   web     —— 只读 textarea:浏览器原生选区(手机浏览器有原生手柄,桌面没有这一层 —— 桌面不走长按)。
 * 三端都受控 `selection` + onSelectionChange,所以「默认全选」「全选」「复制选中的一段」都是同一份状态。
 */
export interface SelectInputTraits {
  readonly readOnly: boolean;
  readonly showSoftInputOnFocus: boolean;
  readonly contextMenuHidden: boolean;
  readonly caretHidden: boolean;
}
export const selectInputTraits = (os: string): SelectInputTraits => {
  if (os === 'android') return { readOnly: false, showSoftInputOnFocus: false, contextMenuHidden: false, caretHidden: true };
  if (os === 'ios') return { readOnly: true, showSoftInputOnFocus: false, contextMenuHidden: true, caretHidden: true };
  return { readOnly: true, showSoftInputOnFocus: false, contextMenuHidden: false, caretHidden: true };
};

/** 微信的绿色:手柄实色,高亮带透明度(安卓 selectionColor 原样画在字底下,实色会压字)。 */
export const SELECT_HANDLE_COLOR = '#07C160';
export const SELECT_HIGHLIGHT_COLOR = 'rgba(7,193,96,0.28)';

// ── 菜单避开选区手柄(#551)──────────────────────────────────────────────────
//
// Vincent 2026-10-04 iPhone 截图(0.2.205):长按一条比屏还高的消息,菜单走了上面的 'inside' 分支 —— 「压在气泡可见部分的
// 顶端」,正好盖住选区**起点**那只绿色手柄,手柄拖不动。根因:菜单锚的是整张卡片,不知道手柄在哪。
//
// 规则(微信同款,所有「我们自己画的、浮在可选文字上的菜单」都走这一条):
//   1. 手指按在选区上 / 选区在变(拖手柄)时菜单隐藏;松手、选区停下来 SELECT_MENU_SETTLE_MS 后再出;
//   2. 再出时永远不压任何一只**看得见的**手柄:优先放在选区起点那行上方;放不下放在终点那行下方;
//      都放不下(选区比屏还高)就放在手柄之间 / 之外的空档里;仍整块在屏内(安全区 + 键盘)。
// 手柄的竖直范围按两端最坏情况取(iOS 起点圆点在行顶上方、安卓水滴挂在行底下方),整行宽度都算禁区 ——
// 菜单几乎和屏一样宽,横向躲不开,所以只按竖直方向判。

/** 一只手柄从所在行的行顶往上伸出多少(iOS 起点圆点 ≈ 10pt,留余量)。 */
export const HANDLE_REACH_ABOVE = 16;
/** 一只手柄从所在行的行底往下挂多少(安卓水滴 ≈ 22dp,iOS 终点圆点 ≈ 10pt,取大 + 余量)。 */
export const HANDLE_REACH_BELOW = 28;
/** 选区停止变化 / 手指抬起后多久菜单重新出现。 */
export const SELECT_MENU_SETTLE_MS = 300;

/** 原生 onTextLayout 的一行(只用到这几个字段)。 */
export interface TextLine { readonly y: number; readonly height: number; readonly text: string }

/** 第 offset 个字符在哪一行。偏移落在两行交界(行末)算前一行的末尾 —— 用于终点;起点传 preferNext 取下一行行首。 */
export const lineIndexAt = (lines: readonly TextLine[], offset: number, preferNext = false): number => {
  if (!lines.length) return -1;
  let acc = 0;
  for (let i = 0; i < lines.length; i++) {
    const len = lines[i].text.length;
    const end = acc + len;
    if (offset < end || (offset === end && !preferNext)) return i;
    acc = end;
  }
  return lines.length - 1;
};

/** 选区起点行 / 终点行的竖直范围(相对文字区顶,未减滚动)。 */
export interface SelectionLines { readonly startTop: number; readonly startBottom: number; readonly endTop: number; readonly endBottom: number }

export const selectionLinesFromLayout = (lines: readonly TextLine[], sel: TextSelection, len: number): SelectionLines | null => {
  if (!lines.length) return null;
  const s = clampSelection(sel, len);
  const a = lines[lineIndexAt(lines, s.start, true)];
  // 终点是「最后一个选中字符」所在行:end 指向它后面一格,所以取 end-1(空选区取 start)。
  const b = lines[lineIndexAt(lines, Math.max(s.start, s.end - 1), true)];
  return { startTop: a.y, startBottom: a.y + a.height, endTop: b.y, endBottom: b.y + b.height };
};

/** 一只手柄占的竖直范围(窗口坐标)。 */
export interface HandleZone { readonly top: number; readonly bottom: number }

/**
 * 两只手柄在窗口里的竖直禁区。`clip` = 文字实际看得见的那块(卡片可视区 ∩ 屏幕可见带):行不在里面 = 手柄画不出来,不算禁区。
 */
export const handleZones = (args: { lines: SelectionLines; textTop: number; scrollY?: number; clip: { top: number; bottom: number } }): { start: HandleZone | null; end: HandleZone | null } => {
  const off = args.textTop - (args.scrollY ?? 0);
  const vis = (top: number, bottom: number) => bottom > args.clip.top && top < args.clip.bottom;
  const { startTop, startBottom, endTop, endBottom } = args.lines;
  return {
    start: vis(startTop + off, startBottom + off) ? { top: startTop + off - HANDLE_REACH_ABOVE, bottom: startBottom + off + HANDLE_REACH_BELOW } : null,
    end: vis(endTop + off, endBottom + off) ? { top: endTop + off - HANDLE_REACH_ABOVE, bottom: endBottom + off + HANDLE_REACH_BELOW } : null,
  };
};

export const zonesOverlap = (a: { top: number; bottom: number }, b: { top: number; bottom: number }): boolean => a.top < b.bottom && b.top < a.bottom;

/**
 * 有选区时菜单放哪(#551):
 *   above  —— 选区起点那行(连同手柄)上方 gap 处,放得下就放(微信默认);起点行不可见时,没有「上方」;
 *   below  —— 终点那行(连同手柄)下方 gap 处;终点行不可见时,没有「下方」;
 *   inside —— 都不行(选区比屏高 / 两头都贴边):在可见带里找一段不碰任何可见手柄的空档,离选区起点最近的那段;
 *   实在一段都没有(屏比菜单 + 两只手柄还矮)才压在可见带顶 —— 返回 overlapsHandle=true,调用方 / 测试能看见。
 * 水平与 placeSelectMenu 相同:以卡片中心为准,夹进屏幕。
 */
export const placeMenuAvoidingHandles = (args: {
  /** 卡片(水平居中和 'inside' 时的优先位置用)。 */
  anchor: Rect;
  start: HandleZone | null;
  end: HandleZone | null;
  menu: { width: number; height: number };
  viewport: { width: number; height: number };
  edge?: Insets;
  keyboardHeight?: number;
  gap?: number;
  margin?: number;
}): MenuPlacement & { readonly overlapsHandle: boolean } => {
  const edge = args.edge ?? { top: 0, bottom: 0, left: 0, right: 0 };
  const gap = args.gap ?? 6;
  const margin = args.margin ?? 8;
  const { anchor, menu, viewport, start, end } = args;
  const band = visibleBand(viewport.height, edge, args.keyboardHeight ?? 0, margin);
  const zones = [start, end].filter((z): z is HandleZone => !!z);
  const clear = (top: number) => top >= band.top && top + menu.height <= band.bottom
    && zones.every(z => !zonesOverlap({ top, bottom: top + menu.height }, z));
  let side: MenuPlacementSide = 'inside';
  let top: number | null = null;
  if (start && clear(start.top - gap - menu.height)) { side = 'above'; top = start.top - gap - menu.height; }
  else if (end && clear(end.bottom + gap)) { side = 'below'; top = end.bottom + gap; }
  else {
    // 候选:可见带顶、每只手柄的上方 / 下方。取不碰手柄、离选区起点(没有就离卡片顶)最近的一个。
    const pref = start ? start.top : Math.max(anchor.y, band.top);
    const cands = [band.top, band.bottom - menu.height, ...zones.flatMap(z => [z.top - gap - menu.height, z.bottom + gap])]
      .filter(clear)
      .sort((p, q) => Math.abs(p - pref) - Math.abs(q - pref));
    top = cands.length ? cands[0] : null;
  }
  const overlapsHandle = top === null;
  if (top === null) top = band.top;
  const minLeft = edge.left + margin;
  const maxLeft = viewport.width - edge.right - margin - menu.width;
  const centre = anchor.x + anchor.width / 2;
  const left = maxLeft < minLeft ? minLeft : Math.max(minLeft, Math.min(centre - menu.width / 2, maxLeft));
  const arrowX = Math.max(16, Math.min(centre - left, menu.width - 16));
  return { left, top, side, arrowX, overlapsHandle };
};

/**
 * 菜单此刻该不该显示:手指按着选区 → 不显示;选区刚变过(拖手柄的事件流)→ 等它停 settleMs 再显示。
 * 纯函数,渲染层每次 tick 调一次。
 */
export const selectMenuVisible = (s: { touching: boolean; msSinceSelectionChange: number; settleMs?: number }): boolean =>
  !s.touching && s.msSinceSelectionChange >= (s.settleMs ?? SELECT_MENU_SETTLE_MS);
