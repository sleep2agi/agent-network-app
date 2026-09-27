// 聊天信息(微信式):会话页右上角「⋯」打开。行的取舍在 chat-info-model.ts,这里只画。
//
//   drawer — 桌面 / 安卓双栏:盖在聊天窗格上的右侧抽屉(不是 Modal,只盖这个窗格);
//            Esc(web)、点左侧遮罩、安卓返回键关闭。
//   page   — 手机单栏:推进来的一整页(Modal,自己的窗口 ⇒ useModalSafePadding),‹ / 系统返回关闭;
//            web 导出里再压一条 history,让浏览器「后退」也只关这一页。
import { useEffect, useMemo, useRef } from 'react';
import { BackHandler, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import { useModalSafePadding } from './safe-area-runtime';
import { colors, spacing } from './theme';
import { ds } from './ui-scale';
import { chatInfoDrawerWidth, type ChatInfoPresentation, type ChatInfoRow, type ChatInfoRowKey } from './chat-info-model';

/** 行高下限:手指目标 48 dp,界面密度调大时跟着变高。 */
const ROW_MIN = Math.max(48, ds(48));

export const chatInfoRowTestId = (key: ChatInfoRowKey) => `chat-info-row-${key.replace(':', '-')}`;

export default function ChatInfoPanel({
  visible,
  presentation,
  groups,
  alias,
  subtitle,
  paneWidth,
  headerHeight,
  onClose,
  onRow,
}: {
  visible: boolean;
  presentation: ChatInfoPresentation;
  groups: ChatInfoRow[][];
  alias: string;
  subtitle?: string;
  paneWidth: number;
  /** Drawer: the chat header's height, so the drawer's title bar ends on the same line. */
  headerHeight?: number;
  onClose: () => void;
  onRow: (row: ChatInfoRow) => void;
}) {
  const safe = useModalSafePadding('fullScreen');
  const styles = useMemo(makeStyles, []);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const drawer = presentation === 'drawer';
  const drawerRef = useRef<any>(null);

  // 抽屉:Esc 关(web / 桌面),安卓双栏的系统返回也先关它。
  useEffect(() => {
    if (!visible || !drawer) return;
    if (Platform.OS === 'android') {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => { onCloseRef.current(); return true; });
      return () => sub.remove();
    }
    const doc = (globalThis as any).document;
    if (!doc?.addEventListener) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onCloseRef.current(); } };
    // A click anywhere outside the drawer closes it — the agent list and the nav rail too, not only
    // the backdrop over the chat pane (WeChat desktop). The click still reaches what it hit.
    const onDown = (e: MouseEvent) => {
      const node = drawerRef.current;
      if (node && typeof node.contains === 'function' && !node.contains(e.target)) onCloseRef.current();
    };
    doc.addEventListener('keydown', onKey);
    doc.addEventListener('mousedown', onDown, true);
    return () => { doc.removeEventListener('keydown', onKey); doc.removeEventListener('mousedown', onDown, true); };
  }, [visible, drawer]);

  // 推页(web 导出):打开时压一条 history,浏览器后退 = 关这一页;用 ‹ 关的,把那条弹掉。
  useEffect(() => {
    const w = (globalThis as any).window;
    if (!visible || drawer || Platform.OS !== 'web' || !w?.history?.pushState) return;
    let popped = false;
    w.history.pushState({ ...(w.history.state ?? {}), anetChatInfo: true }, '');
    const onPop = () => { popped = true; onCloseRef.current(); };
    w.addEventListener('popstate', onPop);
    return () => {
      w.removeEventListener('popstate', onPop);
      if (!popped && w.history.state?.anetChatInfo) w.history.back();
    };
  }, [visible, drawer]);

  const body = (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} testID="chat-info-list">
      {groups.map((rows, gi) => (
        <View key={rows[0]?.key ?? gi} style={styles.group}>
          {rows.map((row, ri) => (
            <View key={row.key}>
              {ri > 0 ? <View style={row.kind === 'profile' ? null : styles.divider} /> : null}
              <Row row={row} alias={alias} subtitle={subtitle} styles={styles} onRow={onRow} />
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );

  if (drawer) {
    if (!visible) return null;
    return (
      <View style={styles.drawerRoot} testID="chat-info-drawer">
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="关闭聊天信息"
          testID="chat-info-backdrop"
        />
        <View ref={drawerRef} style={[styles.drawer, { width: chatInfoDrawerWidth(paneWidth) }]} testID="chat-info-panel" accessibilityViewIsModal>
          <View style={[styles.header, headerHeight ? { minHeight: headerHeight } : null]} testID="chat-info-header">
            <Text style={styles.headerTitle} testID="chat-info-title">聊天信息</Text>
          </View>
          {body}
        </View>
      </View>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.page, safe]} testID="chat-info-panel">
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="返回" style={styles.back} testID="chat-info-back">
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle} testID="chat-info-title">聊天信息</Text>
          {/* Balances the back button so the title sits in the true centre. */}
          <View style={styles.back} />
        </View>
        {body}
      </View>
    </Modal>
  );
}

function Row({ row, alias, subtitle, styles, onRow }: {
  row: ChatInfoRow;
  alias: string;
  subtitle?: string;
  styles: ReturnType<typeof makeStyles>;
  onRow: (row: ChatInfoRow) => void;
}) {
  const testID = chatInfoRowTestId(row.key);
  if (row.kind === 'toggle') {
    return (
      <View style={styles.row} testID={testID} {...({ dataSet: { rowKind: 'toggle' } } as any)}>
        <Text style={styles.label} numberOfLines={1} testID={`${testID}-label`}>{row.label}</Text>
        <Switch
          accessibilityLabel={row.label}
          value={!!row.value}
          onValueChange={() => onRow(row)}
          // Off track in textMuted: the border token vanishes against the dark card.
          trackColor={{ true: colors.accent, false: colors.textMuted }}
          thumbColor={colors.card}
          {...({ activeThumbColor: colors.card } as any)}
          testID={`${testID}-switch`}
        />
      </View>
    );
  }
  if (row.kind === 'profile') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`查看节点信息:${alias}`}
        onPress={() => onRow(row)}
        style={({ pressed }) => [styles.row, styles.profileRow, pressed && styles.pressed]}
        testID={testID}
      >
        <AliasAvatar alias={alias} size={48} />
        <View style={styles.profileText}>
          <Text style={styles.profileName} numberOfLines={1}>{alias}</Text>
          {subtitle ? <Text style={styles.profileSub} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} testID={`${testID}-chevron`} />
      </Pressable>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.label}
      onPress={() => onRow(row)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      testID={testID}
      {...({ dataSet: { rowKind: 'link' } } as any)}
    >
      <Text style={styles.label} numberOfLines={1} testID={`${testID}-label`}>{row.label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} testID={`${testID}-chevron`} />
    </Pressable>
  );
}

const makeStyles = () => StyleSheet.create({
  drawerRoot: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 50, flexDirection: 'row' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.28)' },
  drawer: {
    height: '100%',
    backgroundColor: colors.bg,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
  },
  page: { flex: 1, backgroundColor: colors.bg },
  header: {
    minHeight: ROW_MIN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', color: colors.text, fontSize: 16, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xl },
  // WeChat grouped list: full-width white groups on the grey ground, a gap between groups.
  group: {
    marginTop: spacing.md,
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  row: {
    minHeight: ROW_MIN,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  pressed: { backgroundColor: colors.rowHover },
  // Inset like WeChat: the line starts where the labels start.
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: spacing.lg },
  label: { flex: 1, color: colors.text, fontSize: 16 },
  profileRow: { paddingVertical: spacing.md },
  profileText: { flex: 1, minWidth: 0 },
  profileName: { color: colors.text, fontSize: 17, fontWeight: '600' },
  profileSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
});
