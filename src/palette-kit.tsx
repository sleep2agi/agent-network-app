// 命令面板（palette）的共用外观 —— 与 #4130 模型选择器同一套设计语言：
//   卡片(浮层) · 顶部搜索条 · 分组标题 + 计数 · 行(当前项浅灰底 + ✓) · 空态 / 真实错误 / 确认区。
//
// 只画，不做判断：过滤/分组/当前项/禁用原因都在纯逻辑模块里（node-source-palette.ts）。
// 尺寸口径：桌面最宽 560 居中；手机贴着可视区顶部（键盘弹起也不挡确认区），
// 列表只在卡片内部滚动，不撑破外面的输入区/页面。
import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import { colors, radius, spacing } from './theme';
import { ds } from './ui-scale';

export const PALETTE_MAX_WIDTH = 560;

/** 每次都重新读 colors（主题是原地 mutate 的），与 ComposerModelPalette 的 makeStyles 同一口径。 */
export const makePaletteStyles = () => ({
  overlay: {
    // Web focus may scroll the underlying page. Keep the palette attached to
    // the viewport so an error/name input cannot push its header off screen.
    position: (Platform.OS === 'web' ? 'fixed' : 'absolute') as 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    elevation: 24,
    alignItems: 'center' as const,
  },
  scrim: { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  centerWrap: { flex: 1, width: '100%' as const, alignItems: 'center' as const, justifyContent: 'center' as const, padding: spacing.lg },
  topWrap: { flex: 1, width: '100%' as const, alignItems: 'center' as const, justifyContent: 'flex-start' as const, paddingHorizontal: spacing.md, paddingTop: 8 },
  card: {
    width: '100%' as const,
    maxWidth: PALETTE_MAX_WIDTH,
    padding: 8,
    borderRadius: radius.surface,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
  },
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingHorizontal: 6, paddingTop: 2, paddingBottom: 6 },
  headerTitle: { flex: 1, fontSize: ds(13), color: colors.text, fontWeight: '600' as const },
  headerSub: { fontSize: ds(11), color: colors.textMuted, paddingHorizontal: 6, paddingBottom: 6 },
  searchBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    height: 40,
    paddingHorizontal: 10,
    borderRadius: radius.control,
    backgroundColor: colors.inputBg,
  },
  searchInput: { flex: 1, fontSize: ds(13), color: colors.text, paddingVertical: 0 },
  sectionLabel: { fontSize: ds(11), color: colors.textMuted, paddingHorizontal: 10, paddingTop: 10, paddingBottom: 2, letterSpacing: 0.4 },
  group: { paddingTop: 6 },
  groupHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingHorizontal: 10, paddingVertical: 6 },
  groupName: { fontSize: ds(12), color: colors.textMuted, flexShrink: 1 },
  groupCount: { fontSize: ds(12), color: colors.textMuted },
  groupPath: { fontSize: ds(11), color: colors.textMuted, paddingHorizontal: 10, paddingBottom: 2 },
  row: {
    minHeight: 38,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: 8,
    paddingHorizontal: 10,
    borderRadius: radius.item,
  },
  rowCurrent: { backgroundColor: colors.inputBg },
  rowDisabled: { opacity: 0.55 },
  rowActive: { borderWidth: 1, borderColor: colors.accent },
  rowMain: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: ds(14), color: colors.text, flexShrink: 1 },
  rowDetail: { fontSize: ds(11), color: colors.textMuted, lineHeight: 16 },
  statusRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, padding: 12 },
  statusText: { fontSize: ds(12), color: colors.textMuted },
  emptyBox: { paddingHorizontal: 12, paddingVertical: 18, gap: 6 },
  emptyTitle: { fontSize: ds(13), color: colors.text },
  emptyHint: { fontSize: ds(12), color: colors.textMuted, lineHeight: 18 },
  errorBox: { marginTop: 8, paddingHorizontal: 10, paddingVertical: 8, borderRadius: radius.item, backgroundColor: colors.inputBg, gap: 4 },
  errorText: { fontSize: ds(12), color: colors.failed, lineHeight: 18 },
  errorDetail: { fontSize: ds(11), color: colors.textMuted, lineHeight: 16 },
  notice: { fontSize: ds(11), color: colors.running, paddingHorizontal: 10, paddingTop: 6 },
  source: { fontSize: ds(11), color: colors.textMuted, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 2 },
  confirm: {
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
    paddingHorizontal: 4,
    gap: 6,
  },
  confirmHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingHorizontal: 6 },
  confirmMode: { flex: 1, fontSize: ds(11), color: colors.textMuted },
  confirmSelection: { fontSize: ds(12), color: colors.text, paddingHorizontal: 6 },
  confirmRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  confirmInput: {
    flex: 1,
    minWidth: 0,
    height: 36,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inputBg,
    color: colors.text,
    paddingHorizontal: 10,
    fontSize: ds(13),
  },
  primaryBtn: {
    minHeight: 36,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.control,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: colors.accent,
  },
  primaryBtnText: { color: colors.onAccent, fontSize: ds(13), fontWeight: '600' as const },
  ghostBtn: { minHeight: 36, paddingHorizontal: 10, alignItems: 'center' as const, justifyContent: 'center' as const },
  ghostBtnText: { color: colors.textMuted, fontSize: ds(12) },
  closeBtn: { width: 30, height: 30, alignItems: 'center' as const, justifyContent: 'center' as const },
  chipRow: { flexDirection: 'row' as const, alignItems: 'center' as const, flexWrap: 'wrap' as const, gap: 6, paddingHorizontal: 6 },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  chipOn: { borderColor: colors.accent },
  chipText: { fontSize: ds(11), color: colors.text },
  divider: { height: 1, backgroundColor: colors.border, marginTop: 8 },
});

export type PaletteKey = 'up' | 'down' | 'enter' | 'escape';

/** 浮层骨架：遮罩 + 卡片。桌面居中；手机贴顶（确认区的输入框不被键盘盖住）。 */
export function PaletteOverlay({ children, onClose, onKey, testID }: {
  children: ReactNode;
  onClose: () => void;
  onKey?: (key: PaletteKey) => void;
  testID: string;
}) {
  const styles = makePaletteStyles();
  const { width, height } = useWindowDimensions();
  const phone = width < 560;

  // 键盘：只在 web 上挂 document 监听（原生由系统输入法处理）。Escape/↑/↓/Enter 都走同一入口。
  useEffect(() => {
    if (Platform.OS !== 'web' || !onKey) return;
    const doc = (globalThis as { document?: Document }).document;
    if (!doc) return;
    const handler = (event: KeyboardEvent) => {
      const key = event.key;
      // 名字输入框里的 ↑/↓ 是光标移动，不抢；搜索框里 ↑/↓ 走列表。Enter/Escape 两种输入框都照常。
      const target = event.target as { tagName?: string; getAttribute?: (name: string) => string | null } | null;
      const testId = target?.getAttribute?.('data-testid') ?? null;
      const inNameInput = testId === 'source-fork-child-name' || testId === 'project-create-child-name' || testId === 'clone-node-name';
      if (key === 'Escape') { onKey('escape'); return; }
      if (key === 'ArrowDown' && !inNameInput) { event.preventDefault(); onKey('down'); return; }
      if (key === 'ArrowUp' && !inNameInput) { event.preventDefault(); onKey('up'); return; }
      if (key === 'Enter') { onKey('enter'); }
    };
    // capture：不让输入框/外层组件把 Escape、方向键吞掉。
    doc.addEventListener('keydown', handler, true);
    return () => doc.removeEventListener('keydown', handler, true);
  }, [onKey]);

  return (
    <View style={styles.overlay} testID={`${testID}-backdrop`}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityRole="button" accessibilityLabel="close" testID={`${testID}-scrim`} />
      <View style={phone ? styles.topWrap : styles.centerWrap}>
        <View style={[styles.card, { maxHeight: Math.round((height || 800) * 0.9) }]} testID={testID} accessibilityViewIsModal>
          {children}
        </View>
      </View>
    </View>
  );
}

/** 列表只在浮层内滚；高度按窗口留出搜索条 + 确认区的位置，不撑破输入区。 */
export function PaletteList({ children, testID }: { children: ReactNode; testID: string }) {
  const { height } = useWindowDimensions();
  const listMax = Math.max(140, Math.min(430, Math.round((height || 800) - 380)));
  return (
    <ScrollView
      style={{ maxHeight: listMax, flexGrow: 0, flexShrink: 1, minHeight: 0 }}
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled
      showsVerticalScrollIndicator
      testID={testID}
    >
      {children}
    </ScrollView>
  );
}

export function PaletteSearch({ value, onChangeText, placeholder, accessibilityLabel, testID, autoFocus }: {
  value: string;
  onChangeText: (next: string) => void;
  placeholder: string;
  accessibilityLabel: string;
  testID: string;
  autoFocus?: boolean;
}) {
  const styles = makePaletteStyles();
  return (
    <View style={styles.searchBar}>
      <Ionicons name="search-outline" size={16} color={colors.textMuted} />
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={accessibilityLabel}
        style={[styles.searchInput, Platform.OS === 'web' && ({ outlineStyle: 'none' } as object)]}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
      />
      <Ionicons name="options-outline" size={16} color={colors.textMuted} />
    </View>
  );
}

export function PaletteSectionLabel({ title, testID }: { title: string; testID?: string }) {
  const styles = makePaletteStyles();
  return <Text style={styles.sectionLabel} numberOfLines={1} testID={testID}>{title}</Text>;
}

export function PaletteGroupHeader({ title, count, path, testID }: { title: string; count: number; path?: string | null; testID: string }) {
  const styles = makePaletteStyles();
  return (
    <>
      <View style={styles.groupHeader}>
        <Text style={styles.groupName} numberOfLines={1} testID={`${testID}-name`}>{title}</Text>
        <Text style={styles.groupCount} testID={`${testID}-count`}>{count}</Text>
      </View>
      {path ? <Text style={styles.groupPath} numberOfLines={1} testID={`${testID}-path`}>{path}</Text> : null}
    </>
  );
}

export function PaletteRow({ testID, label, detail, current, active, disabled, onPress, accessibilityLabel }: {
  testID: string;
  label: string;
  detail?: string | null;
  current: boolean;
  /** 键盘 ↓/↑ 移动到的行：给一个可见轮廓，抬手前就能看出 Enter 会选哪一行。 */
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const styles = makePaletteStyles();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: current, disabled: !!disabled }}
      aria-selected={current}
      aria-disabled={!!disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, current && styles.rowCurrent, !!active && styles.rowActive, !!disabled && styles.rowDisabled, pressed && !disabled && { opacity: 0.7 }]}
    >
      <View style={styles.rowMain}>
        <Text style={styles.rowLabel} numberOfLines={1}>{label}</Text>
        {detail ? <Text style={styles.rowDetail} numberOfLines={1}>{detail}</Text> : null}
      </View>
      {current ? <Ionicons name="checkmark" size={18} color={colors.textSecondary} testID={`${testID}-check`} /> : null}
    </Pressable>
  );
}

export function PaletteLoading({ text, testID }: { text: string; testID: string }) {
  const styles = makePaletteStyles();
  return (
    <View style={styles.statusRow} testID={testID}>
      <ActivityIndicator size="small" color={colors.textMuted} />
      <Text style={styles.statusText}>{text}</Text>
    </View>
  );
}

export function PaletteError({ text, testID, detail, textTestID }: { text: string; testID: string; detail?: string | null; textTestID?: string }) {
  const styles = makePaletteStyles();
  return (
    <View style={styles.errorBox} testID={testID}>
      <Text style={styles.errorText} testID={textTestID}>{text}</Text>
      {detail ? <Text style={styles.errorDetail}>{detail}</Text> : null}
    </View>
  );
}

export function PaletteEmpty({ title, hint, testID }: { title: string; hint?: string | null; testID: string }) {
  const styles = makePaletteStyles();
  return (
    <View style={styles.emptyBox} testID={testID}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint ? <Text style={styles.emptyHint}>{hint}</Text> : null}
    </View>
  );
}
