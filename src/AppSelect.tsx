// 设置里的下拉选择(Owner 09-30 看着 语音输入 → 麦克风 的 DOM <select>「这个地方也太丑了」)。
// 原生 <select> 在 macOS WKWebView 里是系统灰色渐变按钮,和旁边的输入框 / 按钮不是一套;手机上根本没有它。
// 全 app 不再用原生下拉框(src/no-native-select.test.ts 门禁),设置里的选择一律走这里:
//
//   桌面(sheet=false):一行 = 图标 + 当前值 + ⌄,和同页输入框同高同边框;点开是 app 自己画的浮层,
//                       锚在行下面(放不下翻到上面、夹进窗口)。↑↓ / Home / End 走选项、回车 / 空格选、
//                       Esc / Tab 关;点浮层外面关;选中项右边 ✓;键盘焦点有强调色描边;关了焦点回到行上。
//   手机(sheet=true):微信那种设置行(标签 · 当前值 · ›,settings-kit 的 SettingsRow),点了从底部弹
//                       动作面板:标题、选项(选中项 ✓)、隔开的「取消」。
import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { colors, onThemeChange, radius, spacing, themeMode } from './theme';
import { elevated } from './elevation';
import { useModalSafePadding } from './safe-area-runtime';
import { SettingsRow, settingsRowMinHeight } from './settings-kit';
import { anchorSelectMenu, type SelectAnchor } from './task-select-model';
import { initialActive, stepOption, type AppSelectOption } from './app-select-model';

export type { AppSelectOption } from './app-select-model';


const MENU_ROW_H = 34;
const MENU_MAX_WIDTH = 480;
const focusRing = (): object => ({ outlineStyle: 'solid', outlineWidth: 2, outlineColor: colors.accent, outlineOffset: 1 });

export default function AppSelect({ value, options, onChange, title, icon, sheet = false, disabled = false, testID, accessibilityLabel }: {
  value: string;
  options: readonly AppSelectOption[];
  onChange: (value: string) => void;
  /** 读屏名字;手机上同时是行的标签和底部面板的标题。 */
  title: string;
  /** 桌面行最前面的图标(Ionicons 名字)。 */
  icon?: keyof typeof Ionicons.glyphMap;
  sheet?: boolean;
  disabled?: boolean;
  testID: string;
  accessibilityLabel?: string;
}) {
  const ref = useRef<any>(null);
  const [anchor, setAnchor] = useState<SelectAnchor | null>(null);
  const current = options.find(o => o.value === value);
  const label = current?.label ?? '';
  const open = () => {
    if (disabled) return;
    const el = ref.current;
    if (el?.measureInWindow) el.measureInWindow((x: number, y: number, w: number, h: number) => setAnchor({ x, y, w, h }));
    else setAnchor({ x: spacing.xl, y: 120, w: 320, h: 40 });
  };
  const close = (refocus: boolean) => {
    setAnchor(null);
    // 键盘用户关了菜单要回到原处(Modal 卸掉后原来的焦点丢了)。
    if (refocus && !sheet) setTimeout(() => ref.current?.focus?.(), 0);
  };
  const pick = (v: string) => { close(true); if (v !== value) onChange(v); };

  const menu = anchor
    ? sheet
      ? <ActionSheet title={title} options={options} value={value} onPick={pick} onClose={() => close(false)} testID={`${testID}-menu`} />
      : <PopoverMenu anchor={anchor} title={title} options={options} value={value} onPick={pick} onClose={close} testID={`${testID}-menu`} />
    : null;

  if (sheet) {
    return (
      <>
        <View ref={ref} collapsable={false}>
          <SettingsRow testID={testID} label={title} value={label} disabled={disabled} onPress={open} accessibilityLabel={accessibilityLabel ?? `${title}:${label}`} />
        </View>
        {menu}
      </>
    );
  }

  // 焦点在行上时 ↓ / ↑ 直接打开(同系统下拉框);回车 / 空格由 Pressable 当点击。
  const onKeyDown = (e: any) => {
    if (anchor || disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); }
  };
  return (
    <>
      <Pressable
        ref={ref}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? `${title}:${label}`}
        accessibilityState={{ disabled, expanded: !!anchor }}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        disabled={disabled}
        onPress={open}
        {...(Platform.OS === 'web' ? { onKeyDown } : null)}
        style={(state: any) => [
          styles.field,
          state.hovered && !disabled && styles.fieldHover,
          anchor && styles.fieldOpen,
          disabled && styles.disabled,
          state.focused && !anchor ? focusRing() : null,
        ]}
      >
        {icon ? <Ionicons name={icon} size={16} color={colors.textMuted} /> : null}
        <Text style={styles.fieldText} numberOfLines={1} testID={`${testID}-value`}>{label}</Text>
        <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
      </Pressable>
      {menu}
    </>
  );
}

function PopoverMenu({ anchor, title, options, value, onPick, onClose, testID }: {
  anchor: SelectAnchor;
  title: string;
  options: readonly AppSelectOption[];
  value: string;
  onPick: (v: string) => void;
  onClose: (refocus: boolean) => void;
  testID: string;
}) {
  const win = useWindowDimensions();
  const safe = useModalSafePadding('fullScreen');
  const [active, setActive] = useState(() => initialActive(options, value));
  const keyRef = useRef({ options, active, onPick, onClose });
  keyRef.current = { options, active, onPick, onClose };
  useEffect(() => {
    const doc = (globalThis as any).document;
    if (!doc?.addEventListener) return;
    const onKey = (e: any) => {
      const k = keyRef.current;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => stepOption(k.options, i, 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => stepOption(k.options, i, -1)); }
      else if (e.key === 'Home') { e.preventDefault(); setActive(stepOption(k.options, -1, 1)); }
      else if (e.key === 'End') { e.preventDefault(); setActive(stepOption(k.options, k.options.length, -1)); }
      else if (e.key === 'Enter' || e.key === ' ') { const o = k.options[k.active]; e.preventDefault(); e.stopPropagation(); if (o && !o.disabled) k.onPick(o.value); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); k.onClose(true); }
      else if (e.key === 'Tab') { k.onClose(true); }
    };
    doc.addEventListener('keydown', onKey, true);
    return () => doc.removeEventListener('keydown', onKey, true);
  }, []);
  const pos = anchorSelectMenu(anchor, { width: win.width, height: win.height }, { rows: options.length || 1, rowH: MENU_ROW_H, search: false, maxWidth: MENU_MAX_WIDTH });
  return (
    <Modal visible transparent animationType="none" onRequestClose={() => onClose(true)}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => onClose(false)} accessibilityLabel="关闭" testID={`${testID}-scrim`} />
      <View
        style={[styles.popover, { left: Math.max(pos.left, safe.paddingLeft + 8), top: Math.max(pos.top, safe.paddingTop + 8), width: pos.width, maxHeight: pos.maxHeight }]}
        testID={testID}
        accessibilityRole="menu"
        accessibilityLabel={title}
      >
        <ScrollView style={{ flexGrow: 0 }}>
          {options.map((o, i) => {
            const on = o.value === value;
            return (
              <Pressable
                key={o.value || '__default'}
                testID={`${testID}-opt-${i}`}
                accessibilityRole="menuitem"
                accessibilityState={{ checked: on, disabled: !!o.disabled }}
                aria-checked={on}
                disabled={o.disabled}
                onPress={() => onPick(o.value)}
                onHoverIn={() => { if (!o.disabled) setActive(i); }}
                style={[styles.menuRow, i === active && styles.menuRowActive, o.disabled && styles.disabled]}
              >
                <Text style={[styles.menuText, on && styles.menuTextOn]} numberOfLines={1} testID={`${testID}-opt-${i}-label`}>{o.label}</Text>
                <View style={styles.check}>{on ? <Ionicons name="checkmark" size={16} color={colors.accent} /> : null}</View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

function ActionSheet({ title, options, value, onPick, onClose, testID }: {
  title: string;
  options: readonly AppSelectOption[];
  value: string;
  onPick: (v: string) => void;
  onClose: () => void;
  testID: string;
}) {
  const safe = useModalSafePadding('fullScreen');
  const scrim = themeMode() === 'dark' ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.25)';
  const rowH = settingsRowMinHeight();
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: scrim }} onPress={onClose} accessibilityLabel="关闭" testID={`${testID}-scrim`} />
      <View style={[styles.sheet, { paddingBottom: safe.paddingBottom }]} testID={testID} accessibilityRole="menu" accessibilityLabel={title}>
        <Text style={styles.sheetTitle}>{title}</Text>
        <ScrollView style={{ flexGrow: 0 }}>
          {options.map((o, i) => {
            const on = o.value === value;
            return (
              <Pressable
                key={o.value || '__default'}
                testID={`${testID}-opt-${i}`}
                accessibilityRole="menuitem"
                accessibilityState={{ checked: on, disabled: !!o.disabled }}
                aria-checked={on}
                disabled={o.disabled}
                onPress={() => onPick(o.value)}
                style={({ pressed }) => [styles.sheetRow, { minHeight: rowH }, i > 0 && styles.sheetRowSep, pressed && styles.sheetRowPressed, o.disabled && styles.disabled]}
              >
                <View style={styles.check} />
                <Text style={[styles.sheetText, on && styles.menuTextOn]} numberOfLines={1} testID={`${testID}-opt-${i}-label`}>{o.label}</Text>
                <View style={styles.check}>{on ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}</View>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={styles.sheetGap} />
        <Pressable accessibilityRole="button" accessibilityLabel="取消" onPress={onClose} style={({ pressed }) => [styles.sheetCancel, { minHeight: rowH }, pressed && styles.sheetRowPressed]} testID={`${testID}-cancel`}>
          <Text style={styles.sheetText}>取消</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const makeStyles = () => StyleSheet.create({
  field: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 38,
    paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control,
    backgroundColor: colors.inputBg, cursor: 'pointer',
  } as object,
  fieldHover: { borderColor: colors.textMuted },
  fieldOpen: { borderColor: colors.accent },
  fieldText: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14 },
  disabled: { opacity: 0.45 },
  popover: { position: 'absolute', padding: 6, borderRadius: radius.control, backgroundColor: colors.floatingBg, borderWidth: 1, borderColor: colors.floatingBorder, ...elevated('floating') },
  menuRow: { height: MENU_ROW_H, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.item, cursor: 'pointer' } as object,
  menuRowActive: { backgroundColor: colors.rowHover },
  menuText: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14 },
  menuTextOn: { color: colors.accent, fontWeight: '600' },
  check: { width: 18, alignItems: 'center' },
  sheet: { maxHeight: '70%', borderTopLeftRadius: radius.surface, borderTopRightRadius: radius.surface, backgroundColor: colors.groupedBg, overflow: 'hidden' },
  sheetTitle: { color: colors.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: spacing.md, backgroundColor: colors.groupedRow },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, backgroundColor: colors.groupedRow },
  sheetRowSep: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  sheetRowPressed: { backgroundColor: colors.groupedRowPressed },
  sheetText: { flex: 1, minWidth: 0, color: colors.text, fontSize: 16, textAlign: 'center' },
  sheetGap: { height: spacing.sm },
  sheetCancel: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.groupedRow },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
