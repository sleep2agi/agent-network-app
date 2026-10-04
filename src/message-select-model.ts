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
