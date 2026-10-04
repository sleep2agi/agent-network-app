import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Modal, Platform, Pressable, StyleSheet, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import { t } from './i18n';
import './i18n-chat';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import { colors, onThemeChange, radius, spacing } from './theme';
import { useModalSafePadding } from './safe-area-runtime';
import { selectableTextOf } from './message-plain-text';
import {
  acceptSelectionEvent, chunkMenuRows, clampSelection, fullSelection, handleZones, placeMenuAvoidingHandles, placeSelectCard, placeSelectMenu,
  selectInputTraits, selectionLinesFromLayout, selectMenuItems, selectionPayload, SELECT_HANDLE_COLOR, SELECT_HIGHLIGHT_COLOR, SELECT_MENU_SETTLE_MS,
  type Rect, type SelectionLines, type SelectionPayload, type SelectMenuKey, type TextLine, type TextSelection,
} from './message-select-model';

/** 长按时量到的那条气泡。null = 没在选择。 */
export interface MessageSelectTarget {
  /** 气泡在窗口里的位置(measureInWindow)。 */
  rect: Rect;
  /** 原始消息内容(可能带「@作者: …」引用行、Markdown)。 */
  raw: string;
  /** 'sent' = 我发的(bubbleMine 底),'reply' = 对方的(card 底)—— 卡片底色跟气泡一致。 */
  tone: 'sent' | 'reply';
}

/**
 * 手机长按消息 → 就地选区 + 微信式浮动菜单(#537)。只在触摸端渲染(phone-only-registry.ts 有一行守着)。
 *
 * 结构:一个透明 Modal(自己的窗口,盖住键盘以外的一切):
 *   - 整窗透明遮罩:点空白处 = 退出选择(微信同款);
 *   - 选区卡片:与气泡同位同宽,盖在气泡上,里面是一个承载**整条纯文本**的原生 TextInput —— 默认整条选中,
 *     系统手柄拖动调整,绿色高亮;一个原生节点,所以选区可以跨段落(Markdown 的块边界不再是墙);
 *   - 浮动菜单:深色两行图标格。#551 起它躲的是**选区的两只手柄**而不是整张卡片(placeMenuAvoidingHandles):
 *     先放选区起点行上方,放不下放终点行下方,都不行放在不碰任何可见手柄的空档里;始终整块在屏内。
 *     手指按在选区上 / 选区在变(拖手柄)时菜单隐藏,松手且选区停下 SELECT_MENU_SETTLE_MS 后按新选区重新放(微信同款)。
 */
export default function MessageSelectOverlay({ target, selectionMode, onAction, onClose }: {
  target: MessageSelectTarget | null;
  selectionMode?: boolean;
  /** 菜单动作。payload:整条 or 选中的那段(message-select-model selectionPayload)。 */
  onAction: (key: SelectMenuKey, payload: SelectionPayload) => void;
  onClose: () => void;
}) {
  const { width: vw, height: vh } = useWindowDimensions();
  const safe = useModalSafePadding('fullScreen');
  const edge = { top: safe.paddingTop ?? 0, bottom: safe.paddingBottom ?? 0, left: safe.paddingLeft ?? 0, right: safe.paddingRight ?? 0 };
  const plain = useMemo(() => selectableTextOf(target?.raw ?? ''), [target?.raw]);
  const hasText = plain.length > 0;
  const [sel, setSel] = useState<TextSelection>(() => fullSelection(plain.length));
  const openedAt = useRef(0);
  const [cardBox, setCardBox] = useState<Rect | null>(null);
  const [menuSize, setMenuSize] = useState<{ width: number; height: number } | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const inputRef = useRef<any>(null);
  // web:长按的那只手指 / 鼠标还按着时选区层就出来了,松手的那一下落在 textarea 上会把选区收成光标(Chromium 实测:
  // 松手前 0..len,松手后 0..0)。所以 web 上等这次手势结束(armed)前卡片不接指针,结束后再把整条选区设一遍并聚焦
  // (只读 textarea 不弹键盘;不聚焦 Chromium 不画选区高亮)。原生端新窗口收不到这次按压的后续事件,打开即 armed。
  const [armed, setArmed] = useState(Platform.OS !== 'web');
  // #551 拖手柄期间菜单隐藏:touching = 手指按在选区卡片上;settling = 选区刚变过,还没停稳。
  const [touching, setTouching] = useState(false);
  const [settling, setSettling] = useState(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settle = () => {
    setSettling(true);
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => setSettling(false), SELECT_MENU_SETTLE_MS);
  };
  useEffect(() => () => { if (settleTimer.current) clearTimeout(settleTimer.current); }, []);
  // #551 选区起点行 / 终点行在哪(手柄就画在那两行):原生端用一份不可见的同款 Text 的 onTextLayout 行信息,
  // web 端用 textarea 的镜像 div 量。scrollY = 卡片里文字滚过的距离。
  const [textLines, setTextLines] = useState<TextLine[] | null>(null);
  const [scrollY, setScrollY] = useState(0);
  const [webGeom, setWebGeom] = useState<{ lines: SelectionLines; textTop: number } | null>(null);

  // 每次打开都从「整条选中」开始,重新量卡片 / 菜单。
  useEffect(() => {
    if (!target) return;
    openedAt.current = Date.now();
    setSel(fullSelection(plain.length));
    setArmed(Platform.OS !== 'web');
    setCardBox(null);
    setMenuSize(null);
    setTouching(false);
    setSettling(false);
    setTextLines(null);
    setScrollY(0);
    setWebGeom(null);
    // 键盘开着时长按:先收起(微信同款),菜单再按收起后的空间放;收不起(外接/悬浮键盘)也按它的高度避开。
    Keyboard.dismiss();
    const metrics = Keyboard.metrics?.();
    setKeyboardHeight(metrics && Keyboard.isVisible?.() ? metrics.height : 0);
  }, [target]);
  useEffect(() => {
    if (!target || Platform.OS === 'web') return;
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', e => setKeyboardHeight(e?.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, [target]);

  useEffect(() => {
    if (!target || Platform.OS !== 'web' || typeof document === 'undefined') return;
    let done = false;
    const arm = () => {
      if (done) return;
      done = true;
      setTimeout(() => {
        setArmed(true);
        setSel(fullSelection(plain.length));
        inputRef.current?.focus?.();
      }, 0);
    };
    const events = ['pointerup', 'mouseup', 'touchend', 'pointercancel', 'touchcancel'];
    events.forEach(ev => document.addEventListener(ev, arm, true));
    // 手势在选区层出来之前就结束了(或是键盘 / 读屏打开的):兜底按时间 arm。
    const fallback = setTimeout(arm, 900);
    return () => { done = true; clearTimeout(fallback); events.forEach(ev => document.removeEventListener(ev, arm, true)); };
  }, [target]);

  const items = useMemo(() => selectMenuItems({ hasText, selectionMode }), [hasText, selectionMode]);
  const rows = useMemo(() => chunkMenuRows(items), [items]);
  const card = target ? placeSelectCard({ anchor: target.rect, viewportHeight: vh, edge, keyboardHeight }) : null;
  // 菜单锚在「看得见的那块」上:有文字 = 选区卡片(可能比气泡高),没文字 = 气泡本身。
  const anchor = hasText ? cardBox : target?.rect ?? null;
  // web:选区 / 卡片 / 滚动一变、以及每次停稳(settling → false)时用镜像量一次(读 DOM,放在 effect 里)。
  // 量的是 textarea **当下的真实选区**,不是 sel 状态:React 的 onSelect 有自己的「上次选区」缓存,
  // 点一下再拖回同一段时事件不来,状态会停在光标上(drive 实测:菜单按光标那行放,压住了终点手柄)。
  useEffect(() => {
    if (Platform.OS !== 'web' || !hasText || !cardBox || settling || touching) return;
    const ta = inputRef.current as HTMLTextAreaElement | null;
    if (!ta || typeof ta.getBoundingClientRect !== 'function') { setWebGeom(null); return; }
    const live = typeof ta.selectionStart === 'number' && typeof ta.selectionEnd === 'number'
      ? clampSelection({ start: ta.selectionStart, end: ta.selectionEnd }, plain.length) : sel;
    setWebGeom(measureWebSelection(ta, live));
  }, [sel, cardBox, scrollY, hasText, armed, settling, touching]);
  const selGeom = !hasText || !cardBox ? null
    : Platform.OS === 'web' ? webGeom
    : (() => {
      const lines = textLines ? selectionLinesFromLayout(textLines, sel, plain.length) : null;
      return lines ? { lines, textTop: cardBox.y + CARD_PAD_V + TEXT_PAD - scrollY } : null;
    })();
  const viewport = { width: vw, height: vh };
  const placed = !anchor || !menuSize ? null
    : hasText && selGeom
      ? placeMenuAvoidingHandles({
        anchor, menu: menuSize, viewport, edge, keyboardHeight,
        ...handleZones({ lines: selGeom.lines, textTop: selGeom.textTop, clip: { top: anchor.y, bottom: anchor.y + anchor.height } }),
      })
      // 量到行之前(头一帧)/ 纯附件:按卡片放,与 #537 相同。
      : placeSelectMenu({ anchor, menu: menuSize, viewport, edge, keyboardHeight });
  const menuShown = !!placed && !touching && !settling;
  const touchDown = () => setTouching(true);
  const touchUp = () => { setTouching(false); settle(); };
  const touchProps = Platform.OS === 'web'
    ? { onPointerDown: touchDown, onPointerUp: touchUp, onPointerCancel: touchUp }
    : { onTouchStart: touchDown, onTouchEnd: touchUp, onTouchCancel: touchUp };
  const traits = selectInputTraits(Platform.OS);

  const act = (key: SelectMenuKey) => {
    if (key === 'selectAll') { setSel(fullSelection(plain.length)); return; }
    // web:以 textarea 当下的真实选区为准。React 的 onSelect 有自己的「上次选区」缓存,程序设过的「全选」它看不见 ——
    // 全选后再拖回同一段,事件不来,状态就停在整条(实测)。原生端 ref 上没有选区,用 onSelectionChange 记的状态。
    const node = inputRef.current as { selectionStart?: unknown; selectionEnd?: unknown } | null;
    const live = Platform.OS === 'web' && typeof node?.selectionStart === 'number' && typeof node?.selectionEnd === 'number'
      ? clampSelection({ start: node.selectionStart, end: node.selectionEnd }, plain.length)
      : sel;
    onAction(key, selectionPayload(plain, live));
  };
  const onCardLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (card) setCardBox({ x: card.left, y: card.top, width, height });
  };
  const onMenuLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!menuSize || Math.abs(menuSize.width - width) > 0.5 || Math.abs(menuSize.height - height) > 0.5) setMenuSize({ width, height });
  };

  return (
    <Modal visible={!!target} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={styles.root} testID="msg-select-layer">
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('chat.select.exit')} testID="msg-select-backdrop" />
        {target && hasText && card ? (
          <View
            onLayout={onCardLayout}
            pointerEvents={armed ? 'auto' : 'none'}
            testID="msg-select-card"
            {...(touchProps as object)}
            style={[styles.card, target.tone === 'sent' ? styles.cardSent : styles.cardReply, { left: card.left, top: card.top, width: card.width, minHeight: card.minHeight, maxHeight: card.maxHeight }]}
          >
            {Platform.OS !== 'web' ? (
              // 不可见的同款文字,只为拿 onTextLayout 的行位置(与下面 TextInput 同字号 / 行高 / 内容宽)。
              <Text
                pointerEvents="none"
                accessible={false}
                importantForAccessibility="no-hide-descendants"
                onTextLayout={e => setTextLines(e.nativeEvent.lines.map(l => ({ y: l.y, height: l.height, text: l.text })))}
                style={[styles.mirror, { width: Math.max(0, card.width - 2 * (CARD_PAD_H + TEXT_PAD)) }]}
              >
                {plain}
              </Text>
            ) : null}
            <TextInput
              ref={inputRef}
              testID="msg-select-text"
              accessibilityLabel={t('chat.select.text')}
              value={plain}
              onChangeText={() => { /* 受控:安卓那一端可编辑(只为能选中),任何改动都被下一次渲染还原 */ }}
              multiline
              scrollEnabled
              autoFocus
              readOnly={traits.readOnly}
              showSoftInputOnFocus={traits.showSoftInputOnFocus}
              contextMenuHidden={traits.contextMenuHidden}
              caretHidden={traits.caretHidden}
              selection={sel}
              onSelectionChange={e => {
                const next = clampSelection(e.nativeEvent.selection, plain.length);
                if (!acceptSelectionEvent(next, Date.now() - openedAt.current)) return;
                // 用户在拖手柄(程序设的同一个选区回声不算):菜单先藏,停稳了再按新选区放。
                if (next.start !== sel.start || next.end !== sel.end) settle();
                setSel(next);
              }}
              onScroll={e => setScrollY(e?.nativeEvent?.contentOffset?.y ?? 0)}
              selectionColor={Platform.OS === 'android' ? SELECT_HIGHLIGHT_COLOR : SELECT_HANDLE_COLOR}
              selectionHandleColor={SELECT_HANDLE_COLOR}
              textAlignVertical="top"
              style={[styles.text, target.tone === 'sent' && styles.textSent]}
            />
          </View>
        ) : null}
        {target ? (
          <View
            onLayout={onMenuLayout}
            testID="msg-select-menu"
            accessibilityRole="menu"
            // 量完尺寸、算好位置前不显示(免得在 (0,0) 闪一下)。
            // #551 拖手柄 / 手指按在选区上时隐藏(不卸载:尺寸留着,松手直接按新位置出现)。
            pointerEvents={menuShown ? 'auto' : 'none'}
            style={[styles.menu, { maxWidth: vw - 16 }, placed ? { left: placed.left, top: placed.top } : styles.menuMeasuring, placed && !menuShown && styles.menuHidden]}
            // web:按菜单项的 mousedown 默认动作会把 textarea 的选区收掉(实测:拖成一段后点「复制」拿到的是整条)。
            {...({ dataSet: { side: placed?.side ?? 'measuring', hidden: menuShown ? '0' : '1' }, ...(Platform.OS === 'web' ? { onMouseDown: (e: { preventDefault?: () => void }) => e.preventDefault?.() } : {}) } as object)}
          >
            {rows.map((row, i) => (
              <View key={`row-${i}`} style={[styles.menuRow, i > 0 && styles.menuRowSep]}>
                {row.map(item => (
                  <Pressable
                    key={item.key}
                    accessibilityRole="menuitem"
                    accessibilityLabel={t(`chat.select.${item.key}`)}
                    testID={`msg-select-${item.key}`}
                    onPress={() => act(item.key)}
                    style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
                  >
                    <Ionicons name={item.icon as any} size={22} color={item.danger ? '#ff7a7a' : '#ffffff'} />
                    <Text style={[styles.menuLabel, item.danger && styles.menuLabelDanger]} numberOfLines={1}>{t(`chat.select.${item.key}`)}</Text>
                  </Pressable>
                ))}
              </View>
            ))}
            {placed && placed.side !== 'inside' ? (
              <View pointerEvents="none" style={[styles.arrow, placed.side === 'above' ? styles.arrowDown : styles.arrowUp, { left: placed.arrowX - 7 }]} />
            ) : null}
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const MENU_BG = '#4c4c4c';
const ITEM_W = 60;
/** 卡片内边距 / 文字内边距(下面 styles.card / styles.text,原生端算文字顶要用)。 */
const CARD_PAD_H = spacing.lg - 4;
const CARD_PAD_V = spacing.md - 6;
const TEXT_PAD = 4;
const TEXT_SIZE = 14;
const TEXT_LINE = 21;

/**
 * web:textarea 里选区起点 / 终点那两行的竖直范围(相对 textarea 边框内顶,含 padding)与 textTop(窗口坐标,已减 scrollTop)。
 * 浏览器不给 textarea 选区的几何,所以照它的计算样式造一个镜像 div,取起点 / 终点那个字符的 Range 矩形。
 */
function measureWebSelection(ta: HTMLTextAreaElement, sel: TextSelection): { lines: SelectionLines; textTop: number } | null {
  if (typeof document === 'undefined' || !ta.value) return null;
  const cs = getComputedStyle(ta);
  const div = document.createElement('div');
  const copy = ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth',
    'borderBottomWidth', 'borderLeftWidth', 'borderStyle', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight',
    'textTransform', 'wordSpacing', 'textIndent', 'overflowWrap', 'wordBreak', 'tabSize'] as const;
  for (const k of copy) (div.style as any)[k] = (cs as any)[k];
  Object.assign(div.style, { position: 'absolute', visibility: 'hidden', top: '0px', left: '-9999px', whiteSpace: 'pre-wrap', height: 'auto', overflow: 'hidden' });
  const node = document.createTextNode(ta.value);
  div.appendChild(node);
  document.body.appendChild(div);
  try {
    const s = clampSelection(sel, ta.value.length);
    const lh = parseFloat(cs.lineHeight) || TEXT_LINE;
    const base = div.getBoundingClientRect().top + (parseFloat(cs.borderTopWidth) || 0);
    // 起点:选区里第一个非换行字符;终点:最后一个非换行字符(换行符的矩形落在行尾 / 下一行,不可靠)。
    let a = s.start, b = Math.max(s.start, s.end - 1);
    while (a < b && ta.value[a] === '\n') a++;
    while (b > a && ta.value[b] === '\n') b--;
    const lineOf = (i: number) => {
      const r = document.createRange();
      r.setStart(node, Math.min(i, ta.value.length - 1));
      r.setEnd(node, Math.min(i + 1, ta.value.length));
      const rects = r.getClientRects();
      const q = rects.length ? rects[0] : r.getBoundingClientRect();
      const top = (q.top + q.bottom) / 2 - lh / 2 - base;
      return { top, bottom: top + lh };
    };
    const A = lineOf(a), B = lineOf(b);
    const tr = ta.getBoundingClientRect();
    return {
      lines: { startTop: A.top, startBottom: A.bottom, endTop: B.top, endBottom: B.bottom },
      textTop: tr.top + (parseFloat(cs.borderTopWidth) || 0) - ta.scrollTop,
    };
  } finally {
    div.remove();
  }
}

const makeStyles = () => StyleSheet.create({
  root: { flex: 1 },
  card: { position: 'absolute', borderRadius: radius.bubble, overflow: 'hidden', paddingHorizontal: CARD_PAD_H, paddingVertical: CARD_PAD_V },
  mirror: { position: 'absolute', left: CARD_PAD_H + TEXT_PAD, top: CARD_PAD_V + TEXT_PAD, opacity: 0, fontSize: TEXT_SIZE, lineHeight: TEXT_LINE, padding: 0, margin: 0 },
  cardSent: { backgroundColor: colors.bubbleMine },
  cardReply: { backgroundColor: colors.card },
  textSent: { color: colors.onBubbleMine },
  // 与气泡正文同字号同行高(MarkdownMessage styles.text),选中时字不跳。
  text: {
    color: colors.text, fontSize: TEXT_SIZE, lineHeight: TEXT_LINE, padding: TEXT_PAD, margin: 0, borderWidth: 0, flexGrow: 0,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none', resize: 'none', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap', fieldSizing: 'content', cursor: 'text' } as object) : {}),
  },
  menu: { position: 'absolute', backgroundColor: MENU_BG, borderRadius: radius.control, paddingHorizontal: spacing.sm, ...({ boxShadow: '0 4px 16px rgba(0,0,0,0.25)' } as object), elevation: 8 },
  menuMeasuring: { left: 0, top: 0, opacity: 0 },
  menuHidden: { opacity: 0 },
  menuRow: { flexDirection: 'row', paddingVertical: spacing.sm },
  menuRowSep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.18)' },
  menuItem: { width: ITEM_W, alignItems: 'center', gap: 4, paddingVertical: 6, borderRadius: radius.item },
  menuItemPressed: { backgroundColor: 'rgba(255,255,255,0.12)' },
  menuLabel: { color: '#ffffff', fontSize: 12 },
  menuLabelDanger: { color: '#ff7a7a' },
  arrow: { position: 'absolute', width: 14, height: 14, backgroundColor: MENU_BG, transform: [{ rotate: '45deg' }] },
  arrowDown: { bottom: -6 },
  arrowUp: { top: -6 },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });

// web:原生 ::selection 是系统蓝,换成微信绿(只作用于选区卡片里那一个 textarea)。
if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.getElementById('anet-msg-select-style')) {
  const el = document.createElement('style');
  el.id = 'anet-msg-select-style';
  el.textContent = `[data-testid="msg-select-text"]::selection{background:${SELECT_HIGHLIGHT_COLOR}}`;
  document.head.appendChild(el);
}
