// Shared chrome for Hub / Daemon / Node backend-pending demo shells — 复用设置页分段控件与节点页卡片 token。
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { colors, onThemeChange, radius, spacing, type, weight } from './theme';
import { ds } from './ui-scale';

export type PendingTab = 'skills' | 'tokens' | 'provider';
export type PendingLayer = 'hub' | 'daemon' | 'node';

const TAB_ITEMS: readonly { key: PendingTab; labelKey: string }[] = [
  { key: 'skills', labelKey: 'backendPending.tab.skills' },
  { key: 'tokens', labelKey: 'backendPending.tab.tokens' },
  { key: 'provider', labelKey: 'backendPending.tab.provider' },
];

const TAB_ICONS: Record<PendingTab, keyof typeof Ionicons.glyphMap> = {
  skills: 'extension-puzzle-outline',
  tokens: 'key-outline',
  provider: 'cube-outline',
};

/** 与 WeakPasswordBanner / 设置说明条同款 token。 */
export function PendingDemoBanner({ t }: { t: (key: string) => string }) {
  return (
    <View testID="backend-pending-banner" accessibilityRole="text" style={styles.banner}>
      <View style={styles.bannerDot} />
      <Text style={styles.bannerText}>{t('backendPending.banner')}</Text>
    </View>
  );
}

/** 与节点页头部 runtime chip 同款。 */
export function PendingLayerBadge({ layer, t }: { layer: PendingLayer; t: (key: string) => string }) {
  return (
    <View style={styles.layerBadge} testID={`pending-layer-${layer}`}>
      <Text style={styles.layerBadgeText}>{t(`backendPending.layer.${layer}`)}</Text>
    </View>
  );
}

/** 节点页 SectionTitle 的轻量版(无 action)。 */
export function PendingCardTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ color: colors.text, fontSize: type.body, fontWeight: weight.strong }}>{title}</Text>
      {subtitle ? <Text style={{ color: colors.textMuted, fontSize: type.small, lineHeight: 18 }}>{subtitle}</Text> : null}
    </View>
  );
}

export function PendingFieldLabel({ children }: { children: string }) {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

export function PendingSegmentedTabs({
  value,
  onChange,
  testID,
  stacked,
  t,
}: {
  value: PendingTab | null;
  onChange: (tab: PendingTab) => void;
  testID: string;
  stacked?: boolean;
  t: (key: string) => string;
}) {
  if (stacked) {
    return (
      <View style={styles.stacked} accessibilityRole="tablist" testID={testID}>
        {TAB_ITEMS.map(item => {
          const on = value !== null && item.key === value;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => onChange(item.key)}
              testID={`${testID}-${item.key}`}
              style={({ pressed }) => [styles.stackedItem, on && styles.stackedItemOn, pressed && { opacity: 0.65 }]}
            >
              <Ionicons name={TAB_ICONS[item.key]} size={18} color={on ? colors.accent : colors.textSecondary} />
              <Text style={[styles.stackedText, on && styles.stackedTextOn]} numberOfLines={1}>{t(item.labelKey)}</Text>
            </Pressable>
          );
        })}
      </View>
    );
  }
  return (
    <View style={styles.segmented} accessibilityRole="tablist" testID={testID}>
      {TAB_ITEMS.map(item => {
        const on = value !== null && item.key === value;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(item.key)}
            testID={`${testID}-${item.key}`}
            style={({ pressed }) => [styles.segment, on && styles.segmentSelected, pressed && !on && { opacity: 0.6 }]}
          >
            <Text style={[styles.segmentText, on && styles.segmentTextSelected]} numberOfLines={1}>{t(item.labelKey)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** 节点详情页 content 卡片同款(无描边,圆角 surface)。 */
export function PendingPanelCard({ children, testID, style }: { children: ReactNode; testID?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View testID={testID} style={[styles.card, style]}>
      {children}
    </View>
  );
}

export function PendingIntegrationFrame({
  layer,
  hint,
  banner,
  tabs,
  children,
  testID,
  t,
}: {
  layer: PendingLayer;
  hint: string;
  banner: ReactNode;
  tabs?: ReactNode;
  children: ReactNode;
  testID: string;
  t: (key: string) => string;
}) {
  return (
    <View testID={testID} style={styles.frame}>
      <View style={styles.frameHead}>
        <View style={styles.frameMeta}>
          <PendingLayerBadge layer={layer} t={t} />
          {banner}
        </View>
        <Text style={styles.frameHint}>{hint}</Text>
      </View>
      {tabs}
      <View style={styles.frameBody}>{children}</View>
    </View>
  );
}

export function pendingFieldStyle() {
  return {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inputBg,
    borderRadius: radius.control,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 42,
    color: colors.text,
    fontSize: type.body,
  };
}

const makeStyles = () =>
  StyleSheet.create({
    banner: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs + 2,
      borderWidth: 1,
      borderColor: colors.accent,
      backgroundColor: colors.tonalBg,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: spacing.xs,
    },
    bannerDot: { width: 6, height: 6, borderRadius: radius.pill, backgroundColor: colors.accent },
    bannerText: { color: colors.accent, fontSize: type.small, lineHeight: 18, fontWeight: weight.strong },
    layerBadge: {
      alignSelf: 'flex-start',
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      borderRadius: radius.pill,
      backgroundColor: colors.subtleFill,
    },
    layerBadgeText: { color: colors.textSecondary, fontSize: type.small },
    fieldLabel: { color: colors.textMuted, fontSize: type.small, lineHeight: 18 },
    segmented: {
      flexDirection: 'row',
      flexShrink: 0,
      flexWrap: 'wrap',
      padding: 2,
      borderRadius: radius.control,
      backgroundColor: colors.subtleFill,
      borderWidth: 1,
      borderColor: colors.border,
    },
    segment: {
      flexGrow: 1,
      flexBasis: 0,
      minWidth: 44,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: ds(6),
      borderRadius: radius.item,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: 'transparent',
    },
    segmentSelected: { backgroundColor: colors.card, borderColor: colors.border },
    segmentText: { color: colors.textSecondary, fontSize: 13 },
    segmentTextSelected: { color: colors.text, fontWeight: weight.strong },
    stacked: { gap: 3, paddingHorizontal: spacing.sm },
    stackedItem: {
      minHeight: 42,
      borderRadius: radius.item,
      paddingHorizontal: spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      justifyContent: 'flex-start',
    },
    stackedItemOn: { backgroundColor: colors.rowActive },
    stackedText: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
    stackedTextOn: { color: colors.text, fontWeight: weight.strong },
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.surface,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      gap: spacing.md,
    },
    frame: { gap: spacing.md },
    frameHead: { gap: spacing.xs },
    frameMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
    frameHint: { color: colors.textMuted, fontSize: type.small, lineHeight: 18 },
    frameBody: { gap: spacing.md },
  });

let styles = makeStyles();
onThemeChange(() => {
  styles = makeStyles();
});

export { styles as pendingUiStyles };
