import { t as tr } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-tasks';
// 任务详情里的下拉选择(项目 / 母任务),样子跟「负责人」「负责 Agent」一样:一个输入框高的按钮
// (前面圆点或图标 + 名字 + ⌄),点开是选项列表。
//   桌面(鼠标):锚在按钮下面的浮层(放不下就翻到上面),可以打字搜索、↑↓ 回车选、Esc 关。
//   手机(手指):底部面板,顶上标题,可搜索,选项行高 44。
// Owner 09-29:项目原来是一排胶囊,像筛选,他没看出来那是「给这个任务设项目」的地方。
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import { colors, radius, spacing, themeMode, type as typeScale } from './theme';
import { elevated } from './elevation';
import { useModalSafePadding } from './safe-area-runtime';
import { a11yState, useTaskStyles } from './TaskBoardParts';
import { fieldStyles } from './TaskCreateDialog';
import { anchorSelectMenu, filterSelectOptions, type SelectAnchor, type SelectOption } from './task-select-model';

export type { SelectOption } from './task-select-model';

/** 选项前面的小圆点(项目颜色 / 状态颜色);没有颜色 = 空心圈。 */
export function Dot({ color, size = 8 }: { color?: string | null; size?: number }) {
  return color
    ? <View style={{ width: size, height: size, borderRadius: radius.pill, backgroundColor: color }} />
    : <View style={{ width: size, height: size, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.textMuted }} />;
}

/**
 * 触发按钮 + 选项浮层。compact = 列表行里的就地选择(不画输入框外框,只有圆点 + 名字 + ⌄)。
 * value 为 null = 「无」那一项(noneLabel)。
 */
export function SelectField({ value, options, noneLabel, placeholder, onPick, touch, title, searchable = false, disabled = false, compact = false, testID, accessibilityLabel, lead }: {
  value: string | null;
  options: readonly SelectOption[];
  /** 「无」选项的文字;不给就没有「无」。 */
  noneLabel?: string;
  placeholder: string;
  onPick: (id: string | null) => void;
  touch: boolean;
  /** 手机底部面板的标题 / 浮层的读屏名字。 */
  title: string;
  searchable?: boolean;
  disabled?: boolean;
  compact?: boolean;
  testID: string;
  accessibilityLabel?: string;
  /** 按钮前面的图标(没选中时)。 */
  lead?: ReactNode;
}) {
  useTranslation();
  const f = fieldStyles();
  const s = useTaskStyles();
  const ref = useRef<any>(null);
  const [anchor, setAnchor] = useState<SelectAnchor | null>(null);
  const current = value ? options.find(o => o.id === value) : undefined;
  const open = () => {
    if (disabled) return;
    const el = ref.current;
    if (el?.measureInWindow) el.measureInWindow((x: number, y: number, w: number, h: number) => setAnchor({ x, y, w, h }));
    else setAnchor({ x: spacing.xl, y: 120, w: 280, h: 40 });
  };
  const label = current ? current.label : value === null && noneLabel && !placeholder ? noneLabel : placeholder;
  return (
    <>
      <View ref={ref} collapsable={false} style={compact ? { alignSelf: 'flex-start', maxWidth: '100%' } : undefined}>
        <Pressable
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel ?? `${title}：${current ? current.label : noneLabel ?? placeholder}`}
          {...a11yState({ disabled, expanded: !!anchor })}
          disabled={disabled}
          onPress={open}
          style={state => compact
            ? [{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 26, paddingHorizontal: 6, borderRadius: radius.item, maxWidth: '100%' }, ((state as { hovered?: boolean }).hovered || state.pressed) && { backgroundColor: colors.rowHover }]
            : [f.input, f.row, disabled && { opacity: 0.55 }]}
        >
          {current ? (current.lead ?? <Dot color={current.color} />) : lead ?? <Dot />}
          <Text style={compact ? [s.metaText, { flexShrink: 1 }] : { flex: 1, color: current ? colors.text : colors.textMuted, fontSize: typeScale.body }} numberOfLines={1} testID={`${testID}-value`}>{label}</Text>
          <Ionicons name="chevron-down" size={compact ? 12 : 14} color={colors.textMuted} />
        </Pressable>
      </View>
      <SelectMenu
        anchor={anchor}
        touch={touch}
        title={title}
        options={options}
        noneLabel={noneLabel}
        selected={value}
        searchable={searchable}
        onPick={id => { setAnchor(null); if (id !== value) onPick(id); }}
        onClose={() => setAnchor(null)}
        testID={`${testID}-menu`}
      />
    </>
  );
}

export function SelectMenu({ anchor, touch, title, options, noneLabel, selected, searchable, onPick, onClose, testID }: {
  anchor: SelectAnchor | null;
  touch: boolean;
  title: string;
  options: readonly SelectOption[];
  noneLabel?: string;
  selected: string | null;
  searchable: boolean;
  onPick: (id: string | null) => void;
  onClose: () => void;
  testID: string;
}) {
  useTranslation();
  const s = useTaskStyles();
  const win = useWindowDimensions();
  const safe = useModalSafePadding('fullScreen');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  useEffect(() => { if (anchor) { setQuery(''); setActive(0); } }, [anchor]);
  const all: SelectOption[] = useMemo(() => [...(noneLabel ? [{ id: '', label: noneLabel } as SelectOption] : []), ...options], [options, noneLabel]);
  const shown = useMemo(() => filterSelectOptions(all, query), [all, query]);
  const pick = (o: SelectOption) => { if (!o.disabled) onPick(o.id || null); };
  // 键盘:↑↓ 走选项、回车选、Esc 关(web;原生没有这些键)。
  const keyRef = useRef({ shown, active, pick, onClose });
  keyRef.current = { shown, active, pick, onClose };
  useEffect(() => {
    const doc = (globalThis as any).document;
    if (!anchor || touch || !doc?.addEventListener) return;
    const onKey = (e: any) => {
      const k = keyRef.current;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(k.shown.length - 1, i + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)); }
      else if (e.key === 'Enter') { const o = k.shown[k.active]; if (o) { e.preventDefault(); k.pick(o); } }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); k.onClose(); }
    };
    doc.addEventListener('keydown', onKey, true);
    return () => doc.removeEventListener('keydown', onKey, true);
  }, [anchor, touch]);
  if (!anchor) return null;
  const rowH = touch ? 44 : 34;
  const rows = shown.map((o, i) => {
    const on = (selected ?? '') === o.id;
    return (
      <Pressable
        key={o.id || '__none'}
        testID={`${testID}-opt-${o.id || 'none'}`}
        accessibilityRole="menuitem"
        {...a11yState({ selected: on, disabled: !!o.disabled })}
        disabled={o.disabled}
        onPress={() => pick(o)}
        style={state => ({
          minHeight: rowH, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: spacing.md, borderRadius: radius.item,
          backgroundColor: (state as { hovered?: boolean }).hovered || state.pressed || (!touch && i === active) ? colors.rowHover : 'transparent',
          opacity: o.disabled ? 0.45 : 1,
        })}
      >
        {o.id ? (o.lead ?? <Dot color={o.color} />) : <Ionicons name="remove-circle-outline" size={14} color={colors.textMuted} />}
        <View style={{ flex: 1, minWidth: 0, paddingVertical: 4 }}>
          <Text style={{ color: colors.text, fontSize: 13 }} numberOfLines={1}>{o.label}</Text>
          {o.sub ? <Text style={s.metaMuted} numberOfLines={1}>{o.sub}</Text> : null}
        </View>
        {on ? <Ionicons name="checkmark" size={16} color={colors.accent} /> : null}
      </Pressable>
    );
  });
  const search = searchable ? (
    <TextInput
      autoFocus={!touch}
      value={query}
      onChangeText={q => { setQuery(q); setActive(0); }}
      placeholder={tr('taskSel.search')}
      placeholderTextColor={colors.textMuted}
      // 浏览器的黑色焦点框换成强调色边框(同全屏描述编辑框)。
      style={{ height: 34, paddingHorizontal: spacing.md, marginBottom: 4, borderRadius: radius.control, borderWidth: 1, borderColor: colors.accent, color: colors.text, fontSize: 13, backgroundColor: colors.inputBg, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null) } as object}
      testID={`${testID}-search`}
      accessibilityLabel={tr('taskSel.search')}
    />
  ) : null;
  const empty = shown.length === 0 ? <Text style={[s.muted, { padding: spacing.md }]}>{tr('taskSel.noMatch')}</Text> : null;
  if (touch) {
    const scrim = themeMode() === 'dark' ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.25)';
    return (
      <Modal visible transparent animationType="slide" onRequestClose={onClose}>
        <Pressable style={{ flex: 1, backgroundColor: scrim }} onPress={onClose} accessibilityLabel={tr('taskSel.close')} testID={`${testID}-scrim`} />
        <View style={{ maxHeight: '70%', paddingTop: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md + safe.paddingBottom, borderTopLeftRadius: radius.surface, borderTopRightRadius: radius.surface, backgroundColor: colors.card }} testID={testID} accessibilityRole="menu">
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600', marginBottom: spacing.sm }}>{title}</Text>
          {search}
          <ScrollView keyboardShouldPersistTaps="handled">{rows}{empty}</ScrollView>
        </View>
      </Modal>
    );
  }
  const pos = anchorSelectMenu(anchor, { width: win.width, height: win.height }, { rows: shown.length || 1, rowH, search: searchable });
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} onPress={onClose} accessibilityLabel={tr('taskSel.close')} testID={`${testID}-scrim`} />
      <View
        style={{ position: 'absolute', left: Math.max(pos.left, safe.paddingLeft + 8), top: Math.max(pos.top, safe.paddingTop + 8), width: pos.width, maxHeight: pos.maxHeight, padding: 6, borderRadius: radius.control, backgroundColor: colors.card, ...elevated('floating') }}
        testID={testID}
        accessibilityRole="menu"
        accessibilityLabel={title}
      >
        {search}
        <ScrollView style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled">{rows}{empty}</ScrollView>
      </View>
    </Modal>
  );
}
