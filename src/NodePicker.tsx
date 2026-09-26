// 定时任务表单的「执行节点」:表单里一行 + 点开的选择器(手机底部 sheet / 宽屏居中对话框)。
// 逻辑(分组、搜索、最近使用、呈现形态)全在 node-picker-model.ts;这里只画。
//
// 对齐(owner 对这个很敏感,PR 里有 Playwright boundingBox 量表):
//   - 选择器的每一行是**单行**:头像、名字、在线点、状态字、提示、✓ 都在同一条中线上
//     (列表页的在线点压在头像右下角,这里放进行内 —— 角上那颗点的中心不在行的中线上);
//   - 标题行 / 搜索框 / 行 / 组头左右内边距都是同一个 PAD_X。
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Modal, PanResponder, Platform, Pressable, SectionList, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import { colors, onThemeChange, radius, spacing, type as fontSize, weight } from './theme';
import { ds } from './ui-scale';
import { rowStatus } from './agent-row-model';
import { pinyinMatch } from './lib/pinyin';
import { useModalSafePadding } from './safe-area-runtime';
import {
  buildPickerSections,
  countPickerRows,
  emptySearchText,
  fieldModel,
  pickerAutoFocus,
  pickerDialogSize,
  pickerPresentation,
  PICKER_SHEET_RATIO,
  toggleFolded,
  type PickerNode,
  type PickerSection,
} from './node-picker-model';

const PAD_X = 16;
const AVATAR = 32;
const DOT = 8;
const ROW_H = 52;
const CHECK = 20;

const useThemeVersion = () => {
  const [v, setV] = useState(0);
  useEffect(() => onThemeChange(() => setV(n => n + 1)), []);
  return v;
};

/** 表单里的那一行:头像 · 名字 · 在线点 · runtime·组 · ›;没选时「选择执行节点」。 */
export function NodePickerField({ node, fallbackAlias, onPress }: {
  node: PickerNode | null;
  fallbackAlias?: string | null;
  onPress: () => void;
}) {
  const tv = useThemeVersion();
  const s = useMemo(makeStyles, [tv]);
  const m = fieldModel(node, fallbackAlias);
  const dot = node ? colors[rowStatus(node.status).dot] : colors.rest;
  return (
    <Pressable
      testID="schedule-target-field"
      accessibilityRole="button"
      accessibilityLabel={m.placeholder ? '选择执行节点' : `执行节点 ${m.title}${m.online ? ',在线' : ',离线'},点按更换`}
      onPress={onPress}
      style={({ pressed }) => [s.field, pressed && { backgroundColor: colors.rowHover }]}
    >
      {m.placeholder ? (
        <Text testID="schedule-target-placeholder" style={s.fieldPlaceholder} numberOfLines={1}>{m.title}</Text>
      ) : (
        <>
          <View testID="schedule-target-avatar" style={!m.online ? s.dim : null}><AliasAvatar alias={m.title} size={AVATAR} /></View>
          <Text testID="schedule-target-name" style={s.fieldName} numberOfLines={1}>{m.title}</Text>
          <View testID="schedule-target-dot" style={[s.dot, { backgroundColor: m.online ? dot : colors.rest }]} />
          <View style={s.flex} />
          {m.hint ? <Text testID="schedule-target-hint" style={s.fieldHint} numberOfLines={1}>{m.hint}</Text> : null}
        </>
      )}
      {m.placeholder ? <View style={s.flex} /> : null}
      <Ionicons testID="schedule-target-chevron" name="chevron-forward" size={16} color={colors.textMuted} />
    </Pressable>
  );
}

const coarsePointer = (): boolean => {
  try { return !!(globalThis as any).matchMedia?.('(pointer: coarse)')?.matches; } catch { return false; }
};

export default function NodePickerSheet({ visible, nodes, selectedId, recents, pinned, onSelect, onClose }: {
  visible: boolean;
  nodes: readonly PickerNode[];
  selectedId: string;
  recents: readonly string[];
  pinned: readonly string[];
  onSelect: (node: PickerNode) => void;
  onClose: () => void;
}) {
  const tv = useThemeVersion();
  const s = useMemo(makeStyles, [tv]);
  const { width, height } = useWindowDimensions();
  const mode = pickerPresentation(width);
  const safe = useModalSafePadding('overlay');
  const [query, setQuery] = useState('');
  // 300+ 行 × 拼音:输入框立刻更新,列表用延后的值重算,打字不卡。
  const deferred = useDeferredValue(query);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  useEffect(() => { if (visible) setQuery(''); }, [visible]);

  const sections = useMemo(
    () => buildPickerSections(nodes, { query: deferred, recents, pinned, collapsed, match: pinyinMatch }),
    [nodes, deferred, recents, pinned, collapsed],
  );
  const shown = countPickerRows(sections);
  const searching = deferred.trim() !== '';

  const inputRef = useRef<any>(null);
  // 桌面(web + 精确指针)自动聚焦搜索框;手机不聚焦(不弹键盘)。autoFocus 让输入框一挂上就拿到焦点 ——
  // react-native-web 的 Modal 焦点陷阱激活时焦点已经在陷阱里,就不会再把它挪去第一个可聚焦元素(遮罩)。
  const autoFocus = visible && pickerAutoFocus(Platform.OS, coarsePointer());
  useEffect(() => {
    if (!autoFocus) return;
    // react-native-web 的 Modal 挂上后会把焦点放到第一个可聚焦元素上(时机在我们之后),
    // 所以试两次:一帧后 + 动画(fade ~300 ms)结束后,哪次赶上算哪次(和规则全屏同一个做法)。
    const ts = [50, 350].map(ms => setTimeout(() => inputRef.current?.focus?.(), ms));
    return () => ts.forEach(clearTimeout);
  }, [autoFocus]);

  // 手机 sheet:按住把手往下拖超过 120 或快速下滑 ⇒ 关闭。
  const dragY = useRef(new Animated.Value(0)).current;
  useEffect(() => { if (visible) dragY.setValue(0); }, [visible, dragY]);
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_e, g) => g.dy > 4,
    onPanResponderMove: (_e, g) => dragY.setValue(Math.max(0, g.dy)),
    onPanResponderRelease: (_e, g) => {
      if (g.dy > 120 || g.vy > 1.2) onClose();
      else Animated.spring(dragY, { toValue: 0, useNativeDriver: Platform.OS !== 'web' }).start();
    },
  }), [dragY, onClose]);

  const pick = useCallback((n: PickerNode) => { onSelect(n); }, [onSelect]);

  const renderHeader = ({ section }: { section: PickerSection }) => (
    <Pressable
      testID={`picker-group-${section.title}`}
      disabled={!section.collapsible}
      onPress={() => setCollapsed(prev => toggleFolded(prev, section.title))}
      accessibilityRole={section.collapsible ? 'button' : 'header'}
      accessibilityState={section.collapsible ? { expanded: !section.collapsed } : undefined}
      accessibilityLabel={`${section.title} ${section.online}/${section.total} 在线${section.collapsible ? (section.collapsed ? ',已折叠' : ',已展开') : ''}`}
      style={s.group}
    >
      {section.collapsible ? <Ionicons name={section.collapsed ? 'chevron-forward' : 'chevron-down'} size={12} color={colors.textMuted} /> : null}
      <Text dense style={s.groupTitle} numberOfLines={1}>{section.title}</Text>
      <Text dense style={s.groupCount}>{section.online}/{section.total}</Text>
    </Pressable>
  );

  const renderRow = ({ item, section }: { item: PickerNode; section: PickerSection }) => {
    const st = rowStatus(item.status);
    const selected = item.node_id === selectedId;
    const id = `${section.key === 'recent:最近使用' ? 'recent' : 'row'}-${item.node_id}`;
    return (
      <Pressable
        testID={`picker-${id}`}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`${item.alias}${st.online ? '' : ',离线'}${st.label ? `,${st.label}` : ''}`}
        onPress={() => pick(item)}
        style={({ pressed }) => [s.row, { backgroundColor: selected ? colors.rowActive : pressed ? colors.rowHover : 'transparent' }]}
      >
        <View testID={`picker-${id}-avatar`} style={!st.online ? s.dim : null}><AliasAvatar alias={item.alias} size={AVATAR} /></View>
        <Text dense testID={`picker-${id}-name`} numberOfLines={1} style={[s.name, { color: st.online ? colors.text : colors.textMuted }]}>{item.alias}</Text>
        <View testID={`picker-${id}-dot`} style={[s.dot, { backgroundColor: colors[st.dot] }]} />
        {st.label && st.labelTone ? <Text dense style={[s.label, { color: colors[st.labelTone] }]}>{st.label}</Text> : null}
        <View style={s.flex} />
        {item.runtime ? <Text dense numberOfLines={1} style={s.hint}>{item.runtime}</Text> : null}
        <View style={s.check}>
          {selected ? <Ionicons testID={`picker-${id}-check`} name="checkmark" size={18} color={colors.accent} /> : null}
        </View>
      </Pressable>
    );
  };

  const dialog = mode === 'dialog' ? pickerDialogSize(width, height) : null;
  const panel = (
    <Animated.View
      testID="node-picker"
      accessibilityViewIsModal
      style={[
        s.panel,
        dialog
          ? [s.dialog, { width: dialog.width, height: dialog.height }]
          : [s.sheet, { height: Math.round(height * PICKER_SHEET_RATIO), paddingBottom: safe.paddingBottom, paddingLeft: safe.paddingLeft, paddingRight: safe.paddingRight, transform: [{ translateY: dragY }] }],
      ]}
    >
      {!dialog ? (
        <View testID="node-picker-handle" style={s.handleArea} {...pan.panHandlers}>
          <View style={s.handle} />
        </View>
      ) : null}
      <View testID="node-picker-header" style={[s.head, dialog && { paddingTop: spacing.md }]}>
        <Text testID="node-picker-title" style={s.title} numberOfLines={1}>选择执行节点</Text>
        <Pressable testID="node-picker-close" onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="关闭" style={s.close}>
          <Ionicons name="close" size={20} color={colors.textMuted} />
        </Pressable>
      </View>
      <View testID="node-picker-search" style={s.searchBox}>
        <Ionicons name="search" size={16} color={colors.textMuted} />
        <TextInput
          ref={inputRef}
          autoFocus={autoFocus}
          testID="node-picker-input"
          style={s.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder={`搜索 ${nodes.length} 个节点(支持拼音)`}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="清空搜索">
            <Ionicons name="close-circle" size={16} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      <SectionList
        testID="node-picker-list"
        sections={sections}
        keyExtractor={(n, i) => `${n.node_id}:${i}`}
        renderSectionHeader={renderHeader}
        renderItem={renderRow}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        // 300+ 行:首屏只画一屏,保留窗口收小(与节点列表同一组参数)。
        initialNumToRender={14}
        maxToRenderPerBatch={14}
        windowSize={9}
        updateCellsBatchingPeriod={50}
        contentContainerStyle={{ paddingBottom: spacing.md }}
        ListEmptyComponent={searching && shown === 0 ? (
          <View style={s.empty}><Text testID="node-picker-empty" style={s.emptyText}>{emptySearchText(deferred)}</Text></View>
        ) : nodes.length === 0 ? (
          <View style={s.empty}><Text style={s.emptyText}>还没有可用的节点</Text></View>
        ) : null}
      />
    </Animated.View>
  );

  return (
    <Modal transparent visible={visible} animationType={dialog ? 'fade' : 'slide'} onRequestClose={onClose}>
      <View style={[s.root, dialog ? s.rootCenter : s.rootBottom]}>
        <Pressable testID="node-picker-backdrop" accessibilityLabel="关闭选择器" focusable={false} onPress={onClose} style={[StyleSheet.absoluteFill, s.backdrop]} />
        {panel}
      </View>
    </Modal>
  );
}

function makeStyles() {
  const padX = ds(PAD_X);
  return StyleSheet.create({
    flex: { flex: 1 },
    dim: { opacity: 0.45 },
    dot: { width: ds(DOT), height: ds(DOT), borderRadius: ds(DOT) / 2 },
    // 表单行:与输入框同一个外框(圆角 9 / 1px 边 / card 底),高度 = 头像 + 2 × 10。
    field: { flexDirection: 'row', alignItems: 'center', gap: ds(10), minHeight: ds(AVATAR) + 20, paddingHorizontal: spacing.md, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 9 },
    fieldPlaceholder: { color: colors.textMuted, fontSize: fontSize.body },
    fieldName: { flexShrink: 1, color: colors.text, fontSize: fontSize.body, fontWeight: weight.medium },
    fieldHint: { flexShrink: 1, maxWidth: '45%', color: colors.textMuted, fontSize: fontSize.small },
    root: { flex: 1 },
    rootBottom: { justifyContent: 'flex-end' },
    rootCenter: { alignItems: 'center', justifyContent: 'center' },
    backdrop: { backgroundColor: '#00000073' },
    panel: { backgroundColor: colors.bg, overflow: 'hidden' },
    sheet: { width: '100%', borderTopLeftRadius: 14, borderTopRightRadius: 14 },
    dialog: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, boxShadow: '0 12px 40px rgba(0,0,0,0.28)' } as any,
    handleArea: { alignItems: 'center', paddingTop: 8, paddingBottom: 4 },
    handle: { width: 36, height: 5, borderRadius: 3, backgroundColor: colors.border },
    head: { flexDirection: 'row', alignItems: 'center', minHeight: ds(40), paddingHorizontal: padX },
    title: { flex: 1, color: colors.text, fontSize: fontSize.title, fontWeight: weight.strong },
    close: { width: ds(28), height: ds(28), alignItems: 'center', justifyContent: 'center', marginRight: -ds(4) },
    searchBox: { flexDirection: 'row', alignItems: 'center', gap: ds(6), minHeight: ds(36), marginHorizontal: padX, marginTop: spacing.xs, marginBottom: spacing.sm, borderRadius: radius.md, paddingHorizontal: ds(10), backgroundColor: colors.subtleFill },
    searchInput: { flex: 1, minWidth: 0, color: colors.text, fontSize: fontSize.body, paddingVertical: 0, height: ds(36), outlineStyle: 'none' } as any,
    group: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: padX, paddingTop: spacing.md, paddingBottom: spacing.xs },
    groupTitle: { flexShrink: 1, color: colors.textMuted, fontSize: fontSize.small, fontWeight: weight.medium, letterSpacing: 0.4 },
    groupCount: { color: colors.textMuted, fontSize: fontSize.caption, marginLeft: 2 },
    row: { flexDirection: 'row', alignItems: 'center', gap: ds(10), height: ds(ROW_H), paddingHorizontal: padX },
    name: { flexShrink: 1, fontSize: fontSize.body, fontWeight: weight.medium },
    label: { fontSize: fontSize.small, fontWeight: weight.medium },
    hint: { flexShrink: 1, maxWidth: '35%', color: colors.textMuted, fontSize: fontSize.small },
    check: { width: ds(CHECK), alignItems: 'center', justifyContent: 'center' },
    empty: { paddingVertical: 48, paddingHorizontal: padX, alignItems: 'center' },
    emptyText: { color: colors.textMuted, fontSize: fontSize.body },
  });
}
