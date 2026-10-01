// 手机「设置」子页的积木(Vincent 2026-09-27「设置界面有点体验太差」):照微信 设置 → 通用 / 字体大小
// 那一套画 —— 页面地色上一块块白色圆角卡片(左右 16 边距),卡片里是 ≥48 高的行:
//   标签在左 · 值在右 · 最右一列 › 或 ✓(同一个 18 宽的格子,所以 › 和 ✓ 右边缘对齐)。
// 行间细线从标签左边缘开始(不贯穿整卡)。说明文字不夹在控件中间,放在卡片下面的小灰字 footer 里。
//
// 子页文件(SettingsPhonePages.tsx)只通过这里画东西 —— settings-subpages.test.ts 静态守着:
// 子页里不许直接出现 TextInput / 单选圆点卡片,要输入框就用 SettingsTextField(只放在三级编辑页里)。
// 文字一律走 ui-text(字体大小设置生效),尺寸走 ds()(界面密度生效)。
// 宽屏(桌面两栏)右栏也用这些积木(#427「设置页整体重新设计」):SettingsPane 把内容收在一列居中的窄栏里,
// 每段一张卡片;账号一段用 SettingsAccountRow(头像 · 名字 · 当前 · ⋯)。
import { Children, Fragment, isValidElement, useRef, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View, type TextInputProps } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import { colors, onThemeChange, spacing, radius } from './theme';
import { ds } from './ui-scale';
import { elevated } from './elevation';
import AliasAvatar from './AliasAvatar';

/** 卡片左右边距 与 行内左右内边距(标签左边缘 = 卡片左边缘 + ROW_PAD_X)。 */
export const SETTINGS_GUTTER = 16;
export const SETTINGS_ROW_PAD_X = 16;
/** 行高下限(Material 触控下限 48;标准密度 52)。 */
export const settingsRowMinHeight = (): number => Math.max(48, ds(52));
/** 行首图标 / 头像的格子宽:账号头像(当前 48、其他 36)和图标方块都左对齐放进同一宽度,后面的文字左边缘因此对齐。 */
export const SETTINGS_LEAD = 48;
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
export function SettingsGroup({ title, caption, footer, footerTone, children, testID, separators = true, highlight }: {
  title?: string;
  /** 卡片上方、标题下面的说明(指向卡片里内容的话放这里:「把下面的信息…」;footer 在卡片下面,说「下面」就指空了)。 */
  caption?: ReactNode;
  footer?: ReactNode;
  footerTone?: SettingsTone;
  children?: ReactNode;
  testID?: string;
  /** false = 子节点自己画分隔(宽屏里沿用旧行的那几段):卡片照样有,不再自动插线。 */
  separators?: boolean;
  /** 当前账号那张卡:主色细边。 */
  highlight?: boolean;
}) {
  const items = Children.toArray(children); // toArray 已丢掉 null / false / undefined
  return (
    <View style={[styles.group, !title && styles.groupUntitled]} testID={testID}>
      {title ? <Text style={styles.groupTitle} testID="settings-kit-group-title">{title}</Text> : null}
      {caption ? <Text style={[styles.footer, styles.caption]} testID="settings-kit-caption">{caption}</Text> : null}
      {items.length ? (
        <View style={[styles.card, highlight && styles.cardHighlight]} testID="settings-kit-card">
          {separators ? items.map((child, i) => (
            <Fragment key={isValidElement(child) && child.key != null ? child.key : i}>
              {i ? <View style={styles.separator} testID="settings-kit-separator" /> : null}
              {child}
            </Fragment>
          )) : items}
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
export function SettingsRow({ label, subtitle, subtitleTone, value, valueTone, valueExtra, tone, onPress, chevron, external, busy, disabled, testID, accessibilityLabel, icon, iconColor }: {
  label: string;
  /** 行首图标(Ionicons 名):主色 / iconColor 的小方块,放在 SETTINGS_LEAD 格子里(和账号头像同一列)。 */
  icon?: string;
  iconColor?: string;
  subtitle?: ReactNode;
  subtitleTone?: SettingsTone;
  value?: string;
  /** 值左边的一小块自绘内容(成员页「已选 Agent」的头像叠放)。 */
  valueExtra?: ReactNode;
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
      {icon ? (
        <View style={[styles.lead, { width: ds(SETTINGS_LEAD) }]} testID={`${id}-lead`}>
          <View style={[styles.iconTile, { backgroundColor: iconColor ?? colors.accent }]}><Ionicons name={icon as any} size={17} color={colors.onAccent} /></View>
        </View>
      ) : null}
      <RowLabel label={label} subtitle={subtitle} tone={tone} subtitleTone={subtitleTone} testID={`${id}-label`} />
      {busy ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
      {valueExtra ? <View style={styles.valueExtra}>{valueExtra}</View> : null}
      {value ? <Text style={[styles.value, valueExtra ? styles.valueFit : null, { color: toneColor(valueTone, colors.textMuted) }]} numberOfLines={1} testID={`${id}-value`}>{value}</Text> : null}
      {showChevron || external ? (
        <View style={styles.accessory} testID={`${id}-accessory`}>
          <Ionicons name={external ? 'open-outline' : 'chevron-forward'} size={external ? 16 : 18} color={colors.textMuted} />
        </View>
      ) : null}
    </RowShell>
  );
}

/**
 * 一个账号(#427):头像 · 名字(+「当前」/「本机」小标)· 一行灰字(地址 · 用户名 · 网络)· 最右 ⋯。
 * 点行 = onPress(切换 / 重新验证);点 ⋯ = onMore(锚点元素),由调用方出菜单(桌面锚定菜单 / 手机底部面板)。
 * ⋯ 放在 › / ✓ 同一列(右边缘对齐)。large = 当前账号那张卡(头像 48)。
 */
export function SettingsAccountRow({ name, subtitle, warning, current, badge, large, onPress, onMore, moreLabel, testID, accessibilityLabel }: {
  name: string;
  subtitle?: string;
  /** 例如「登录已失效」:红字,在灰字下面。 */
  warning?: string;
  /** 「当前」小标的文字;不传 = 不是当前账号。 */
  current?: string;
  /** 其他小标(本地工作区 =「本机」)。 */
  badge?: string;
  large?: boolean;
  onPress?: () => void;
  onMore?: (anchor: any) => void;
  moreLabel?: string;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const id = testID ?? ROW_ID;
  const moreRef = useRef<any>(null);
  return (
    <RowShell onPress={onPress} testID={id} accessibilityLabel={accessibilityLabel ?? name}>
      <View style={[styles.lead, { width: ds(SETTINGS_LEAD) }]} testID={`${id}-lead`}><AliasAvatar alias={name} size={large ? 48 : 36} /></View>
      <View style={styles.accountCopy}>
        <View style={styles.accountNameLine}>
          <Text style={[styles.label, { color: colors.text }, large && styles.accountNameLarge]} numberOfLines={1} testID={`${id}-label`}>{name}</Text>
          {current ? <Text style={[styles.pill, styles.pillCurrent]} testID={`${id}-current`}>{current}</Text> : null}
          {badge ? <Text style={[styles.pill, styles.pillMuted]}>{badge}</Text> : null}
        </View>
        {subtitle ? <Text style={[styles.subtitle, { color: colors.textMuted }]} numberOfLines={1}>{subtitle}</Text> : null}
        {warning ? <Text style={[styles.subtitle, { color: colors.failed }]} numberOfLines={1}>{warning}</Text> : null}
      </View>
      {onMore ? (
        <Pressable
          ref={moreRef}
          testID={`${id}-more`}
          accessibilityRole="button"
          accessibilityLabel={moreLabel}
          hitSlop={10}
          onPress={(e: any) => { e?.stopPropagation?.(); onMore(moreRef.current); }}
          style={({ pressed, hovered }: any) => [styles.accessory, styles.more, (pressed || hovered) && styles.morePressed]}
        >
          <View testID={`${id}-accessory`} style={styles.accessoryInner}><Ionicons name="ellipsis-horizontal" size={18} color={colors.textSecondary} /></View>
        </Pressable>
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

/**
 * 标签 · 右侧一块自定义控件(分段控件 / 小按钮 / 时间输入)。v2(#427):桌面右栏里没法套进 › / ✓ / 开关的那些行,
 * 左边的标签列、行高、内边距和其他积木行完全一样,只是右边换成调用方给的控件(靠右放)。
 * 有 onPress 就是可点的一整行(例如「软件更新」)。
 */
export function SettingsControlRow({ label, subtitle, subtitleTone, children, onPress, disabled, testID, accessibilityLabel, accessibilityState }: {
  label: string;
  subtitle?: ReactNode;
  subtitleTone?: SettingsTone;
  children?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityState?: { busy?: boolean; disabled?: boolean };
}) {
  const id = testID ?? ROW_ID;
  return (
    <RowShell onPress={onPress} disabled={disabled} testID={id} accessibilityLabel={accessibilityLabel ?? label} accessibilityState={accessibilityState}>
      <RowLabel label={label} subtitle={subtitle} subtitleTone={subtitleTone} testID={`${id}-label`} />
      {children ? <View style={styles.control} testID={`${id}-control`}>{children}</View> : null}
    </RowShell>
  );
}

/**
 * 标签 · 右侧一个小按钮(桌面右栏:重启 / 停止 / 打开日志 / 备份 / 发送测试通知…)。手机上同类动作是整行可点的
 * SettingsRow;桌面保留按钮(鼠标点按钮,不点整行),但按钮落在和 › / 开关同一个右侧列里。
 */
export function SettingsActionRow({ label, subtitle, subtitleTone, action, busyLabel, busy, disabled, onPress, tone, testID, buttonTestID }: {
  label: string;
  subtitle?: ReactNode;
  subtitleTone?: SettingsTone;
  /** 按钮上的字;省略 = 和标签一样(旧 ActionRow 的写法)。 */
  action?: string;
  busyLabel?: string;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
  tone?: SettingsTone;
  testID?: string;
  /** 按钮自己的 testID(默认 `<testID>-button`;旧测试按原来的按钮 id 点)。 */
  buttonTestID?: string;
}) {
  const id = testID ?? ROW_ID;
  const off = !!disabled || !!busy;
  return (
    <RowShell testID={id} accessibilityLabel={label}>
      <RowLabel label={label} subtitle={subtitle} subtitleTone={subtitleTone} testID={`${id}-label`} />
      <Pressable
        testID={buttonTestID ?? `${id}-button`}
        accessibilityRole="button"
        accessibilityLabel={action ?? label}
        accessibilityState={{ disabled: off, busy: !!busy }}
        disabled={off}
        onPress={onPress}
        style={({ pressed, hovered }: any) => [styles.control, styles.actionButton, off && styles.disabled, (pressed || hovered) && !off && styles.rowPressed]}
      >
        {busy ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
        <Text style={[styles.actionText, { color: toneColor(tone, colors.text) }]} numberOfLines={1}>{busy && busyLabel ? busyLabel : action ?? label}</Text>
      </Pressable>
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
        testID={`${id}-switch`}
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
  caption: { color: colors.textMuted, paddingTop: 0, paddingBottom: spacing.xs + 2 },
  cardHighlight: { borderWidth: 1, borderColor: colors.accent },
  lead: { width: SETTINGS_LEAD, alignItems: 'flex-start', justifyContent: 'center', flexShrink: 0 },
  iconTile: { width: 30, height: 30, borderRadius: radius.item, alignItems: 'center', justifyContent: 'center' },
  accountCopy: { flex: 1, minWidth: 0, gap: 2 },
  accountNameLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minWidth: 0 },
  accountNameLarge: { fontSize: 17, fontWeight: '600' },
  pill: { fontSize: 11, fontWeight: '600', paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill, overflow: 'hidden', flexShrink: 0 },
  pillCurrent: { color: colors.accent, backgroundColor: colors.railActiveBg },
  pillMuted: { color: colors.textSecondary, backgroundColor: colors.subtleFill },
  more: { borderRadius: radius.item },
  morePressed: { backgroundColor: colors.groupedRowPressed },
  accessoryInner: { width: ACCESSORY, height: ACCESSORY, alignItems: 'center', justifyContent: 'center' },
  cardContent: { padding: SETTINGS_ROW_PAD_X },
  footer: { fontSize: 13, lineHeight: 18, paddingHorizontal: SETTINGS_GUTTER + SETTINGS_ROW_PAD_X, paddingTop: spacing.xs + 2 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: SETTINGS_ROW_PAD_X },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: SETTINGS_ROW_PAD_X, paddingVertical: spacing.sm, backgroundColor: colors.groupedRow },
  rowPressed: { backgroundColor: colors.groupedRowPressed },
  labelBox: { flexShrink: 1, minWidth: 0, gap: 2 },
  label: { fontSize: 16 },
  subtitle: { fontSize: 13, lineHeight: 18 },
  value: { flex: 1, minWidth: 0, fontSize: 15, textAlign: 'right' },
  valueExtra: { marginLeft: 'auto', flexShrink: 0 },
  // 有 valueExtra 时值按字宽(flex: -1 = 按内容、放不下再缩),两者一起靠右。
  valueFit: { flex: -1 },
  accessory: { width: ACCESSORY, height: ACCESSORY, marginLeft: 'auto', alignItems: 'center', justifyContent: 'center' },
  switch: { marginLeft: 'auto' },
  control: { marginLeft: 'auto', flexShrink: 0, alignItems: 'flex-end' },
  actionButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, paddingHorizontal: 12, borderRadius: radius.control, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.groupedRow },
  actionText: { fontSize: 14 },
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
