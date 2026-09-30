// 成员编辑器(#417)宽屏双栏弹窗的小积木:分段控件、方形复选框(含三态)、小开关。
// 成员弹窗与任务权限区块(TaskAccessSection 的 desktop 画法)共用,两边长得一样。手机页用 settings-kit,不用这里。
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { colors, onThemeChange, radius, spacing, themeMode } from './theme';
import { shadowOnly } from './elevation';

/**
 * 分段控件:灰色轨道里一块白色(深色下亮一档)的选中块。
 * fit=false:各段等宽(flex: 1,基准 0 —— 等宽正是想要的);fit=true:各段按字宽,整条靠左(自己一套底样式,不叠 flex)。
 */
export function Segmented<T extends string>({ options, value, onChange, label, fit, small, testID, disabled }: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  label?: string;
  fit?: boolean;
  small?: boolean;
  disabled?: boolean;
  testID: string;
}) {
  return (
    <View style={[styles.track, fit && styles.trackFit]} accessibilityRole="radiogroup" accessibilityLabel={label} testID={testID}>
      {options.map(o => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, checked: on, disabled: !!disabled }}
            aria-checked={on}
            disabled={disabled}
            onPress={() => onChange(o.value)}
            style={({ hovered }: any) => [fit ? styles.segFit : styles.seg, small && styles.segSmall, on ? styles.segOn : hovered && styles.segHover]}
            testID={`${testID}-${o.value}`}
          >
            <Text style={[styles.segText, small && styles.segTextSmall, on && styles.segTextOn]} numberOfLines={1} testID={`${testID}-${o.value}-text`}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** 方形复选框:✓ 全选 / — 部分 / □ 没选。只画,不接点击(点击在整行上)。 */
export function CheckBox({ state }: { state: 'all' | 'some' | 'none' | boolean }) {
  const s = state === true ? 'all' : state === false ? 'none' : state;
  if (s === 'none') return <View style={styles.box} />;
  return (
    <View style={[styles.box, styles.boxOn]}>
      <Ionicons name={s === 'all' ? 'checkmark' : 'remove'} size={13} color={colors.onAccent} />
    </View>
  );
}

/** 行尾的「可对话」「可编辑」:小字 + 开关。 */
export function LabeledSwitch({ label, value, onValueChange, accessibilityLabel, disabled, testID }: {
  label: string; value: boolean; onValueChange: (v: boolean) => void; accessibilityLabel: string; disabled?: boolean; testID: string;
}) {
  return (
    <View style={styles.switchWrap}>
      <Text style={styles.switchLabel} numberOfLines={1}>{label}</Text>
      <Switch
        accessibilityLabel={accessibilityLabel}
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        // 深色下关着的轨道若用 border 色,会和卡片、深色滑块糊成一片(看着像没有开关):抬到中灰。
        trackColor={{ true: colors.accent, false: themeMode() === 'dark' ? colors.rest : colors.border }}
        thumbColor={colors.card}
        testID={testID}
      />
    </View>
  );
}

/** 小节标题(灰色 12 号粗体),右边可放计数 / 链接。 */
export function SectionLabel({ children, testID }: { children: string; testID?: string }) {
  return <Text style={styles.label} testID={testID}>{children}</Text>;
}

const makeStyles = () => StyleSheet.create({
  track: { flexDirection: 'row', backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control, padding: 3, gap: 2 },
  trackFit: { alignSelf: 'flex-start' },
  seg: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 7, paddingHorizontal: spacing.sm, borderRadius: radius.item },
  segFit: { alignItems: 'center', justifyContent: 'center', paddingVertical: 7, paddingHorizontal: spacing.md, borderRadius: radius.item },
  segSmall: { paddingVertical: 5 },
  // 深色下没有阴影可用:选中块用亮一档的面(同浮层的细边色);浅色是白块 + 很淡的阴影。
  segOn: { backgroundColor: themeMode() === 'dark' ? colors.floatingBorder : colors.card, ...(themeMode() === 'dark' ? {} : shadowOnly('raised')) },
  segHover: { backgroundColor: colors.rowHover },
  segText: { color: colors.textSecondary, fontSize: 13 },
  segTextSmall: { fontSize: 12 },
  segTextOn: { color: colors.text, fontWeight: '600' },
  box: { width: 18, height: 18, borderRadius: radius.mark, borderWidth: 1.5, borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  switchWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  switchLabel: { color: colors.textSecondary, fontSize: 12 },
  label: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
