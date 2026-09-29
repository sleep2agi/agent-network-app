// 手机「设置」子页的积木(Vincent 2026-09-27「设置界面有点体验太差」):照微信 设置 → 通用 / 字体大小
// 那一套画 —— 页面地色上一块块白色圆角卡片(左右 16 边距),卡片里是 ≥48 高的行:
//   标签在左 · 值在右 · 最右一列 › 或 ✓(同一个 18 宽的格子,所以 › 和 ✓ 右边缘对齐)。
// 行间细线从标签左边缘开始(不贯穿整卡)。说明文字不夹在控件中间,放在卡片下面的小灰字 footer 里。
//
// 子页文件(SettingsPhonePages.tsx)只通过这里画东西 —— settings-subpages.test.ts 静态守着:
// 子页里不许直接出现 TextInput / 单选圆点卡片,要输入框就用 SettingsTextField(只放在三级编辑页里)。
// 文字一律走 ui-text(字体大小设置生效),尺寸走 ds()(界面密度生效)。
// 宽屏(桌面两栏)的设置不用这些积木,保持原样。
import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View, type TextInputProps } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import { colors, onThemeChange, spacing, radius } from './theme';
import { ds } from './ui-scale';
import { elevated } from './elevation';

/** 卡片左右边距 与 行内左右内边距(标签左边缘 = 卡片左边缘 + ROW_PAD_X)。 */
export const SETTINGS_GUTTER = 16;
export const SETTINGS_ROW_PAD_X = 16;
/** 行高下限(Material 触控下限 48;标准密度 52)。 */
export const settingsRowMinHeight = (): number => Math.max(48, ds(52));
/** 最右一列(› / ✓)的格子宽:两者共用,右边缘必然对齐。 */
const ACCESSORY = 18;
/** 没给 testID 的行的默认 testID(web 验收脚本按 `<id>` / `<id>-label` / `<id>-accessory` 量)。 */
const ROW_ID = 'settings-kit-row';

export type SettingsTone = 'default' | 'accent' | 'danger' | 'muted';
const toneColor = (tone: SettingsTone | undefined, fallback: string): string =>
  tone === 'accent' ? colors.accent : tone === 'danger' ? colors.failed : tone === 'muted' ? colors.textMuted : fallback;

/** 子页滚动区的内容样式(首块离顶栏的距离、底部留白)。 */
export function settingsPageContentStyle() {
  return styles.page;
}

/**
 * 一组:可选的小灰字标题 + 白色圆角卡片 + 可选的小灰字说明。
 * 子节点之间自动插细线(从标签左边缘开始);null / false 子节点不占位也不插线。
 */
export function SettingsGroup({ title, footer, footerTone, children, testID }: {
  title?: string;
  footer?: ReactNode;
  footerTone?: SettingsTone;
  children?: ReactNode;
  testID?: string;
}) {
  const items = Children.toArray(children); // toArray 已丢掉 null / false / undefined
  return (
    <View style={[styles.group, !title && styles.groupUntitled]} testID={testID}>
      {title ? <Text style={styles.groupTitle} testID="settings-kit-group-title">{title}</Text> : null}
      {items.length ? (
        <View style={styles.card} testID="settings-kit-card">
          {items.map((child, i) => (
            <Fragment key={isValidElement(child) && child.key != null ? child.key : i}>
              {i ? <View style={styles.separator} testID="settings-kit-separator" /> : null}
              {child}
            </Fragment>
          ))}
        </View>
      ) : null}
      {footer ? <Text style={[styles.footer, { color: toneColor(footerTone, colors.textMuted) }]} testID="settings-kit-footer">{footer}</Text> : null}
    </View>
  );
}

/** 卡片里放一块自绘内容(预览、诊断面板、麦克风电平),四周和行同样的内边距。 */
export function SettingsCardContent({ children, testID }: { children: ReactNode; testID?: string }) {
  return <View style={styles.cardContent} testID={testID}>{children}</View>;
}

function RowShell({ children, onPress, disabled, testID, accessibilityLabel, accessibilityRole, accessibilityState, ariaChecked }: {
  children: ReactNode;
  /** RN-web 0.21 不把 accessibilityState.checked 映射成 aria-checked(#547):需要时显式给。 */
  ariaChecked?: boolean | 'mixed';
  onPress?: () => void;
  disabled?: boolean;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'radio' | 'switch' | 'link' | 'checkbox';
  accessibilityState?: { checked?: boolean | 'mixed'; selected?: boolean; disabled?: boolean; busy?: boolean };
}) {
  const style = [styles.row, { minHeight: settingsRowMinHeight() }, disabled && styles.disabled];
  if (!onPress) return <View style={style} testID={testID} accessibilityLabel={accessibilityLabel}>{children}</View>;
  return (
    <Pressable
      testID={testID}
      accessibilityRole={accessibilityRole ?? 'button'}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled, ...accessibilityState }}
      {...(ariaChecked !== undefined ? { 'aria-checked': ariaChecked } : {})}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [...style, pressed && styles.rowPressed]}
    >
      {children}
    </Pressable>
  );
}

function RowLabel({ label, subtitle, tone, subtitleTone, testID }: { label: string; subtitle?: ReactNode; tone?: SettingsTone; subtitleTone?: SettingsTone; testID?: string }) {
  return (
    <View style={styles.labelBox}>
      <Text style={[styles.label, { color: toneColor(tone, colors.text) }]} numberOfLines={2} testID={testID}>{label}</Text>
      {subtitle ? <Text style={[styles.subtitle, { color: toneColor(subtitleTone, colors.textMuted) }]} numberOfLines={2}>{subtitle}</Text> : null}
    </View>
  );
}

/**
 * 标签 · 右侧值 · ›。有 onPress 默认画 ›(chevron={false} 关掉);没有 onPress 就是只读的「标签 — 值」。
 * external = 跳到应用外(浏览器),右侧用 ↗ 而不是 ›。
 */
export function SettingsRow({ label, subtitle, subtitleTone, value, valueTone, tone, onPress, chevron, external, busy, disabled, testID, accessibilityLabel }: {
  label: string;
  subtitle?: ReactNode;
  subtitleTone?: SettingsTone;
  value?: string;
  valueTone?: SettingsTone;
  tone?: SettingsTone;
  onPress?: () => void;
  chevron?: boolean;
  external?: boolean;
  busy?: boolean;
  disabled?: boolean;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const showChevron = chevron ?? !!onPress;
  const id = testID ?? ROW_ID;
  return (
    <RowShell onPress={onPress} disabled={disabled} testID={id} accessibilityLabel={accessibilityLabel ?? label} accessibilityRole={external ? 'link' : 'button'} accessibilityState={busy ? { busy } : undefined}>
      <RowLabel label={label} subtitle={subtitle} tone={tone} subtitleTone={subtitleTone} testID={`${id}-label`} />
      {busy ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
      {value ? <Text style={[styles.value, { color: toneColor(valueTone, colors.textMuted) }]} numberOfLines={1} testID={`${id}-value`}>{value}</Text> : null}
      {showChevron || external ? (
        <View style={styles.accessory} testID={`${id}-accessory`}>
          <Ionicons name={external ? 'open-outline' : 'chevron-forward'} size={external ? 16 : 18} color={colors.textMuted} />
        </View>
      ) : null}
    </RowShell>
  );
}

/** 单选的一项(微信 字体大小 / 语言):选中项右侧一个 ✓,和 › 在同一列。 */
export function SettingsChoiceRow({ label, subtitle, subtitleTone, selected, onPress, disabled, testID }: {
  label: string;
  subtitle?: ReactNode;
  subtitleTone?: SettingsTone;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const id = testID ?? ROW_ID;
  return (
    <RowShell onPress={onPress} disabled={disabled} testID={id} accessibilityLabel={label} accessibilityRole="radio" accessibilityState={{ checked: selected, selected }}>
      <RowLabel label={label} subtitle={subtitle} subtitleTone={subtitleTone} testID={`${id}-label`} />
      <View style={styles.accessory} testID={`${id}-accessory`}>
        {selected ? <Ionicons name="checkmark" size={18} color={colors.accent} /> : null}
      </View>
    </RowShell>
  );
}

/**
 * 三态多选的一行(微信「选择联系人」按分组全选那种):右侧 ● 全选 / ⊖ 部分 / ○ 没选,和 ✓、› 在同一列。
 * 点一下由调用方决定怎么翻(通常:全选 → 全不选,否则 → 全选)。
 */
export function SettingsTriStateRow({ label, subtitle, state, onPress, disabled, testID }: {
  label: string;
  subtitle?: ReactNode;
  state: 'all' | 'some' | 'none';
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const id = testID ?? ROW_ID;
  const checked = state === 'all' ? true : state === 'some' ? 'mixed' : false;
  return (
    <RowShell onPress={onPress} disabled={disabled} testID={id} accessibilityLabel={label} accessibilityRole="checkbox" accessibilityState={{ checked }} ariaChecked={checked}>
      <RowLabel label={label} subtitle={subtitle} testID={`${id}-label`} />
      <View style={styles.accessory} testID={`${id}-accessory`}>
        <Ionicons
          name={state === 'all' ? 'checkmark-circle' : state === 'some' ? 'remove-circle' : 'ellipse-outline'}
          size={22}
          color={state === 'none' ? colors.textMuted : colors.accent}
        />
      </View>
    </RowShell>
  );
}

/** 标签 · 开关。 */
export function SettingsSwitchRow({ label, subtitle, subtitleTone, value, onValueChange, disabled, testID }: {
  label: string;
  subtitle?: ReactNode;
  subtitleTone?: SettingsTone;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
  testID?: string;
}) {
  const id = testID ?? ROW_ID;
  return (
    <RowShell testID={id} accessibilityLabel={label}>
      <RowLabel label={label} subtitle={subtitle} subtitleTone={subtitleTone} testID={`${id}-label`} />
      <Switch
        accessibilityLabel={label}
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        trackColor={{ true: colors.accent, false: colors.border }}
        thumbColor={colors.card}
        style={[styles.switch, disabled && styles.disabled]}
      />
    </RowShell>
  );
}

/**
 * 卡片里的一个输入框(只用在三级编辑页:API Key、免打扰时段…)。label 给了就画在左边一列。
 */
export function SettingsTextField({ label, testID, ...input }: TextInputProps & { label?: string; testID?: string }) {
  const id = `${testID ?? 'settings-kit-field'}-row`;
  return (
    <View style={[styles.row, { minHeight: settingsRowMinHeight() }]} testID={id}>
      {label ? <Text style={styles.fieldLabel} numberOfLines={1} testID={`${id}-label`}>{label}</Text> : null}
      <TextInput
        testID={testID}
        accessibilityLabel={input.accessibilityLabel ?? label}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        {...input}
        style={styles.fieldInput}
      />
    </View>
  );
}

/** 整宽按钮:primary = 主色实心(保存);destructive = 卡片底红字(清除 / 删除);plain = 卡片底正文色。 */
export function SettingsButton({ label, onPress, variant = 'primary', disabled, busy, testID, accessibilityLabel }: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'destructive' | 'plain';
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const off = !!disabled || !!busy;
  const primary = variant === 'primary';
  const textColor = primary ? colors.onAccent : variant === 'destructive' ? colors.failed : colors.text;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { minHeight: settingsRowMinHeight() },
        primary ? styles.buttonPrimary : styles.buttonCard,
        off && styles.disabled,
        pressed && (primary ? { opacity: 0.8 } : styles.rowPressed),
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={textColor} /> : null}
      <Text style={[styles.buttonText, { color: textColor }]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = () => StyleSheet.create({
  page: { paddingTop: spacing.xs, paddingBottom: spacing.xl * 2 },
  group: { paddingTop: spacing.lg + spacing.xs },
  groupUntitled: { paddingTop: spacing.md },
  groupTitle: { color: colors.textMuted, fontSize: 13, paddingHorizontal: SETTINGS_GUTTER + SETTINGS_ROW_PAD_X, paddingBottom: spacing.xs + 2 },
  card: {
    marginHorizontal: SETTINGS_GUTTER,
    borderRadius: radius.surface,
    backgroundColor: colors.groupedRow,
    overflow: 'hidden',
    ...elevated('raised'),
  },
  cardContent: { padding: SETTINGS_ROW_PAD_X },
  footer: { fontSize: 13, lineHeight: 18, paddingHorizontal: SETTINGS_GUTTER + SETTINGS_ROW_PAD_X, paddingTop: spacing.xs + 2 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: SETTINGS_ROW_PAD_X },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: SETTINGS_ROW_PAD_X, paddingVertical: spacing.sm, backgroundColor: colors.groupedRow },
  rowPressed: { backgroundColor: colors.groupedRowPressed },
  labelBox: { flexShrink: 1, minWidth: 0, gap: 2 },
  label: { fontSize: 16 },
  subtitle: { fontSize: 13, lineHeight: 18 },
  value: { flex: 1, minWidth: 0, fontSize: 15, textAlign: 'right' },
  accessory: { width: ACCESSORY, height: ACCESSORY, marginLeft: 'auto', alignItems: 'center', justifyContent: 'center' },
  switch: { marginLeft: 'auto' },
  fieldLabel: { color: colors.text, fontSize: 16, width: 124 },
  fieldInput: { flex: 1, minWidth: 0, color: colors.text, fontSize: 16, paddingVertical: spacing.sm, outlineStyle: 'none' } as any,
  button: { flexDirection: 'row', gap: spacing.sm, marginHorizontal: SETTINGS_GUTTER, marginTop: spacing.lg, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SETTINGS_ROW_PAD_X },
  buttonPrimary: { backgroundColor: colors.accent },
  buttonCard: { backgroundColor: colors.groupedRow, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  buttonText: { fontSize: 16, fontWeight: '600' },
  disabled: { opacity: 0.45 },
});

// 同全 app 的主题写法:模块级 styles 随主题重建,App.tsx 用 key={theme} 整棵重挂。
let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
