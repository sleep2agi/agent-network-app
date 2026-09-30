// 任务页搜索的界面件(逻辑在 task-search.ts)。桌面和手机是两套交互,不共用一个形状:
//   · 桌面(鼠标 + 键盘):头部工具栏里一个常驻搜索框;「/」或 Ctrl/⌘+K 聚焦,Esc 清空(空了再按 Esc 失焦)
//   · 手机 / 平板(触屏):标题栏一个放大镜,点开变成微信那样的搜索条(圆角灰底输入框 + 右边「取消」)
// 两边的「包含已归档」都在搜索框右端的选项按钮弹出的小菜单里(只有 Hub 支持归档时才有这个按钮)。
import { forwardRef, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, View, useWindowDimensions, type TextInput as RNTextInput } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import { t as tr } from './i18n';
import { useTranslation } from './i18n-react';
import { colors, radius, spacing, themeMode } from './theme';
import { elevated } from './elevation';
import { useModalSafePadding } from './safe-area-runtime';
import { highlightSegments } from './task-search';
import { CONTROL_H, a11yState, type TaskStyles } from './TaskBoardParts';

/** 命中的字:浅色主题淡黄底,深色主题暗金底(两种主题下正文色都读得清)。 */
const hitStyle = () => (themeMode() === 'dark'
  ? { backgroundColor: 'rgba(250, 204, 21, 0.28)', color: colors.text }
  : { backgroundColor: 'rgba(250, 204, 21, 0.45)', color: colors.text });

/** 标题里的高亮:放进标题原来的 <Text> 里当子节点,不改外层的样式 / 行数。没有搜索词时就是原文。 */
export function highlight(text: string, terms: readonly string[] | undefined): ReactNode {
  if (!terms?.length) return text;
  const parts = highlightSegments(text, terms);
  if (parts.length === 1 && !parts[0].hit) return text;
  return parts.map((p, i) => (p.hit ? <Text key={i} style={hitStyle()} testID="task-search-hit">{p.text}</Text> : p.text));
}

/** 归档的卡(只在「包含已归档」的搜索结果里出现):标题旁一个小灰标。 */
export function ArchivedTag({ testID }: { testID?: string }) {
  useTranslation();
  return (
    <View style={{ flexShrink: 0, height: 18, paddingHorizontal: 6, borderRadius: radius.pill, backgroundColor: colors.subtleFill, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 3 }} testID={testID ?? 'task-archived-tag'}>
      <Ionicons name="archive-outline" size={10} color={colors.textMuted} />
      <Text style={{ color: colors.textMuted, fontSize: 10, fontWeight: '600' }}>{tr('taskSearch.archived')}</Text>
    </View>
  );
}

/** 只读的卡(RFC-038 §9:hub 说我不能改)—— 与「已归档」同一个小标签样式,锁 + 「只读」。 */
export function ReadOnlyTag({ testID }: { testID?: string }) {
  useTranslation();
  return (
    <View style={{ flexShrink: 0, alignSelf: 'flex-start', height: 18, paddingHorizontal: 6, borderRadius: radius.pill, backgroundColor: colors.subtleFill, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 3 }} testID={testID ?? 'task-read-only-tag'}>
      <Ionicons name="lock-closed-outline" size={10} color={colors.textMuted} />
      <Text style={{ color: colors.textMuted, fontSize: 10, fontWeight: '600' }}>{tr('tasks.readOnly')}</Text>
    </View>
  );
}

type FieldProps = {
  value: string;
  onChangeText: (text: string) => void;
  onClear: () => void;
  /** 空着再按 Esc(桌面):失焦。 */
  onEscapeEmpty?: () => void;
  /** Hub 支持归档:搜索框右端多一个选项按钮。 */
  archivedCapable: boolean;
  includeArchived: boolean;
  onToggleArchived: () => void;
  touch: boolean;
  autoFocus?: boolean;
  testID: string;
};

/** 搜索输入框本体(放大镜 + 输入 + 清空 + 选项)。桌面工具栏和手机搜索条共用,外面各自决定宽度和旁边有什么。 */
export const SearchField = forwardRef<RNTextInput, FieldProps & { style?: object }>(function SearchField(
  { value, onChangeText, onClear, onEscapeEmpty, archivedCapable, includeArchived, onToggleArchived, touch, autoFocus, testID, style },
  ref,
) {
  useTranslation();
  const optionsRef = useRef<View>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; w: number } | null>(null);
  const openMenu = () => {
    const el = optionsRef.current as unknown as { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null;
    if (el?.measureInWindow) el.measureInWindow((x, y, w, h) => setMenu({ x: x + w, y: y + h + 4, w }));
    else setMenu({ x: 240, y: 64, w: 0 });
  };
  const h = touch ? 36 : CONTROL_H;
  return (
    <View
      style={[{ flexDirection: 'row', alignItems: 'center', gap: 6, height: h, paddingLeft: spacing.md - 2, paddingRight: 4, borderRadius: touch ? radius.pill : radius.control, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: includeArchived ? colors.accent + '66' : 'transparent' }, style]}
      testID={testID}
      accessibilityRole={'search' as never}
    >
      <Ionicons name="search-outline" size={15} color={colors.textMuted} />
      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        autoFocus={autoFocus}
        placeholder={tr('taskSearch.placeholder')}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel={tr('taskSearch.placeholder')}
        onKeyPress={e => {
          if ((e.nativeEvent as { key?: string }).key !== 'Escape') return;
          if (value) onClear(); else onEscapeEmpty?.();
        }}
        style={[{ flex: 1, minWidth: 0, height: h - 2, paddingVertical: 0, color: colors.text, fontSize: 13 }, { outlineStyle: 'none' } as object]}
        testID={`${testID}-input`}
      />
      {value ? (
        <Pressable accessibilityRole="button" accessibilityLabel={tr('taskSearch.clear')} onPress={onClear} hitSlop={6} style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }} testID={`${testID}-clear`}>
          <Ionicons name="close-circle" size={15} color={colors.textMuted} />
        </Pressable>
      ) : null}
      {archivedCapable ? (
        <View ref={optionsRef} collapsable={false}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tr('taskSearch.options')}
            {...a11yState({ expanded: !!menu })}
            onPress={openMenu}
            style={state => [{ width: 26, height: 26, borderRadius: radius.item, alignItems: 'center', justifyContent: 'center' }, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }]}
            testID={`${testID}-options`}
          >
            <Ionicons name={includeArchived ? 'archive' : 'options-outline'} size={14} color={includeArchived ? colors.accent : colors.textMuted} />
          </Pressable>
        </View>
      ) : null}
      <SearchOptionsMenu open={menu} touch={touch} includeArchived={includeArchived} onToggleArchived={onToggleArchived} onClose={() => setMenu(null)} />
    </View>
  );
});

/** 搜索框右端选项的下拉:「包含已归档」开关 + (桌面)快捷键提示。 */
function SearchOptionsMenu({ open, touch, includeArchived, onToggleArchived, onClose }: {
  open: { x: number; y: number; w: number } | null; touch: boolean; includeArchived: boolean; onToggleArchived: () => void; onClose: () => void;
}) {
  useTranslation();
  const safe = useModalSafePadding('fullScreen');
  const viewport = useWindowDimensions();
  const width = Math.min(240, viewport.width - 16);
  return (
    <Modal visible={!!open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: touch ? 'rgba(0,0,0,0.18)' : 'transparent' }} onPress={onClose} accessibilityLabel={tr('tasks.copy.61')} testID="task-search-menu-scrim" />
      {open ? (
        <View
          style={{ position: 'absolute', left: Math.max(8 + safe.paddingLeft, Math.min(open.x - width, viewport.width - safe.paddingRight - width - 8)), top: Math.max(open.y, safe.paddingTop + 8), width, padding: 6, borderRadius: radius.control, backgroundColor: colors.card, ...elevated('floating') }}
          accessibilityRole="menu"
          testID="task-search-menu"
        >
          <Pressable
            accessibilityRole="checkbox"
            {...a11yState({ checked: includeArchived })}
            onPress={() => { onToggleArchived(); onClose(); }}
            style={state => ({ height: touch ? 44 : 36, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: spacing.md, borderRadius: radius.item, backgroundColor: (state as { hovered?: boolean }).hovered || state.pressed ? colors.rowHover : 'transparent' })}
            testID="task-search-archived"
          >
            <Ionicons name="archive-outline" size={14} color={colors.textMuted} />
            <Text style={{ flex: 1, color: colors.text, fontSize: 13 }} numberOfLines={1}>{tr('taskSearch.includeArchived')}</Text>
            <Ionicons name={includeArchived ? 'checkbox' : 'square-outline'} size={16} color={includeArchived ? colors.accent : colors.textMuted} />
          </Pressable>
          {!touch ? <Text style={{ color: colors.textMuted, fontSize: 11, paddingHorizontal: spacing.md, paddingTop: 4, paddingBottom: 6 }}>{tr('taskSearch.hint')}</Text> : null}
        </View>
      ) : null}
    </Modal>
  );
}

/** 手机 / 平板标题栏上的放大镜(收起状态)。 */
export function SearchIconButton({ s, onPress, active }: { s: TaskStyles; onPress: () => void; active: boolean }) {
  useTranslation();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={tr('taskSearch.open')} onPress={onPress} style={state => [s.iconButton, { flexShrink: 0 }, (state.pressed || active) && { backgroundColor: colors.rowHover }]} testID="task-search-open">
      <Ionicons name="search-outline" size={19} color={active ? colors.accent : colors.textSecondary} />
    </Pressable>
  );
}

/** 手机 / 平板展开后的「取消」:清空并收起。 */
export function SearchCancel({ onPress }: { onPress: () => void }) {
  useTranslation();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8} style={{ height: 36, justifyContent: 'center', paddingHorizontal: 4, flexShrink: 0 }} testID="task-search-cancel">
      <Text style={{ color: colors.accent, fontSize: 15 }}>{tr('taskSearch.cancel')}</Text>
    </Pressable>
  );
}

/** 搜索没有结果:「没有找到包含 “xxx” 的任务」+ 清除搜索。 */
export function SearchEmpty({ q, s, onClear, filtered, partial }: { q: string; s: TaskStyles; onClear: () => void; filtered: boolean; /** 旧 Hub、表被截断:只搜了最近的 500 个。 */ partial?: boolean }) {
  useTranslation();
  return (
    <View style={[s.center, { gap: spacing.sm }]} testID="task-search-empty">
      <Ionicons name="search-outline" size={28} color={colors.textMuted} />
      <Text style={{ color: colors.textSecondary, fontSize: 14, fontWeight: '600', textAlign: 'center' }} testID="task-search-empty-text">{tr('taskSearch.empty', { q: q.trim() })}</Text>
      {filtered ? <Text style={s.muted}>{tr('taskSearch.emptyFiltered')}</Text> : null}
      {partial ? <Text style={s.muted} testID="task-search-partial">{tr('taskSearch.partial')}</Text> : null}
      <Pressable accessibilityRole="button" onPress={onClear} style={{ height: 32, justifyContent: 'center', paddingHorizontal: spacing.md }} testID="task-search-empty-clear">
        <Text style={s.link}>{tr('taskSearch.clear')}</Text>
      </Pressable>
    </View>
  );
}
