// 居中弹窗的唯一骨架 —— 标题栏 · 可滚动的正文 · 钉住的底部按钮行(2026-09-30 Vincent「新建用户的确认键呢」:
// 26 个网络的选项把「创建」挤到了屏幕外,弹窗又不能滚)。
//
// 规则(全 app 的弹窗都照这个,modal-footer-rule.test.ts 守着):
//   1. 卡片的高度有界:maxHeight = 背景减掉安全区 / 边距后的 100%;
//   2. 会变长的内容在一个**能收缩**的 ScrollView 里(flexGrow:0 + flexShrink:1,且是卡片的直接子节点);
//   3. 按钮行是卡片里 ScrollView 后面的兄弟节点 —— 内容再长,按钮也在卡片底上,永远可见;
//   4. 有输入框的弹窗包一层 ModalKeyboardAvoider,键盘弹起时整张卡片跟着收。
import { createContext, useContext, useRef, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { colors, onThemeChange, radius, spacing } from './theme';
import { elevated } from './elevation';
import { useModalSafePadding } from './safe-area-runtime';
import { withBasePadding } from './modal-safe-area';
import ModalKeyboardAvoider from './ModalKeyboardAvoider';

export const DIALOG_MAX_WIDTH = 460;
/** 遮罩画在 ModalKeyboardAvoider 上(铺满窗口),backdrop 只管居中。 */
const SCRIM = 'rgba(0,0,0,0.55)';

/** 正文里的控件展开(比如下拉清单)后,让骨架把正文滚到底,展开的部分整段露出来。scroll={false} 时是空操作。 */
const RevealContext = createContext<() => void>(() => {});
export const useDialogReveal = () => useContext(RevealContext);

export default function DialogFrame({ title, closeLabel, onClose, footer, children, scroll = true, maxWidth = DIALOG_MAX_WIDTH, testID }: {
  title: string;
  closeLabel: string;
  onClose: () => void;
  /** 钉在卡片底部的按钮行(取消 / 确认)。 */
  footer?: ReactNode;
  children: ReactNode;
  /**
   * 正文要不要由骨架来滚。正文自己有一个会长的列表(ScrollView / FlatList)时传 false:
   * 正文变成一个能收缩的 View,列表自己滚,别在 ScrollView 里再套一个同向的 ScrollView。
   */
  scroll?: boolean;
  maxWidth?: number;
  testID: string;
}) {
  const safe = useModalSafePadding('fullScreen');
  const scrollRef = useRef<ScrollView>(null);
  // 等展开的内容排完版再滚(下一帧)。
  const reveal = () => { setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50); };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <ModalKeyboardAvoider scrim={SCRIM}>
        <View style={[styles.backdrop, withBasePadding(safe, spacing.lg)]} testID={`${testID}-backdrop`}>
          <View style={[styles.card, { maxWidth }]} accessibilityViewIsModal testID={testID}>
            <View style={styles.header}>
              <Text style={styles.title} numberOfLines={1}>{title}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={closeLabel} onPress={onClose} hitSlop={8} style={styles.closeBtn} testID={`${testID}-close`}>
                <Ionicons name="close" size={18} color={colors.textSecondary} />
              </Pressable>
            </View>
            {scroll ? (
              <RevealContext.Provider value={reveal}>
                <ScrollView ref={scrollRef} style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled" testID={`${testID}-body`}>
                  {children}
                </ScrollView>
              </RevealContext.Provider>
            ) : (
              <View style={[styles.body, styles.bodyContent]} testID={`${testID}-body`}>{children}</View>
            )}
            {footer ? <View style={styles.footer} testID={`${testID}-footer`}>{footer}</View> : null}
          </View>
        </View>
      </ModalKeyboardAvoider>
    </Modal>
  );
}

const makeStyles = () => StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { width: '100%', maxHeight: '100%', flexShrink: 1, backgroundColor: colors.card, borderRadius: radius.surface, padding: spacing.lg, gap: spacing.md, ...elevated('floating') },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '600' },
  closeBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  body: { flexGrow: 0, flexShrink: 1, minHeight: 0 },
  bodyContent: { gap: spacing.md },
  footer: { flexShrink: 0 },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
