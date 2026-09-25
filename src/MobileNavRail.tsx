// Left navigation rail for the Android wide layout (unfolded foldable / tablet / phone in
// landscape). Same pattern as the desktop rail in App.tsx (DesktopWorkspace): brand mark on
// top, the destinations, 设置 pinned to the bottom, version under it, same rail colours —
// but sized and labelled for touch: there is no hover, so every item shows its label
// (the desktop shows it as a hover tooltip) and each hit box is 64×56 dp.
//
// The decision of *when* this shows lives in src/nav-chrome.ts (pure + tested).
import { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from './theme';
import { APP_VERSION } from './version';
import { railBadgeText, railIconFor } from './rail-nav';
import { MOBILE_RAIL_ITEM, MOBILE_RAIL_WIDTH, railUnreadTotal } from './nav-chrome';
import { getUnreadSnapshot, subscribeUnread } from './unread-store';
import { agentUnreadCounts } from './agent-unread-counts';

export interface MobileNavTab {
  key: string;
  label: string;
  icon: string;
  iconActive: string;
}

interface Props {
  tabs: readonly MobileNavTab[];
  active: string;
  onSelect: (key: string) => void;
  /** Left safe-area inset (landscape cutout / 3-button nav bar on the left). */
  insetLeft: number;
  /** Bottom inset (gesture bar). The top is already padded by the app root. */
  insetBottom: number;
  showBrand: boolean;
}

/** Same count the tray and the list rows use (agentUnreadCounts), summed. */
function useAgentsUnreadTotal(): number {
  const [snap, setSnap] = useState(getUnreadSnapshot);
  useEffect(() => subscribeUnread(() => setSnap(getUnreadSnapshot())), []);
  return useMemo(() => railUnreadTotal(agentUnreadCounts(snap)), [snap]);
}

export default function MobileNavRail({ tabs, active, onSelect, insetLeft, insetBottom, showBrand }: Props) {
  // AppRoot is keyed by theme, so this remounts on a theme switch and rebuilds its styles.
  const s = useMemo(makeStyles, []);
  const unread = useAgentsUnreadTotal();
  const main = tabs.filter(tab => tab.key !== 'settings');
  const settings = tabs.find(tab => tab.key === 'settings');

  const item = (tab: MobileNavTab) => {
    const selected = active === tab.key;
    const badge = tab.key === 'agents' ? railBadgeText(unread) : null;
    return (
      <Pressable
        key={tab.key}
        testID={`nav-rail-${tab.key}`}
        accessibilityRole="tab"
        accessibilityLabel={badge ? `${tab.label}，${badge} 条未读` : tab.label}
        accessibilityState={{ selected }}
        aria-selected={selected}
        onPress={() => onSelect(tab.key)}
        android_ripple={{ color: colors.railHover, borderless: true, radius: 30 }}
        style={({ pressed }) => [s.item, pressed && !selected && s.itemPressed]}
      >
        <View style={[s.indicator, selected && s.indicatorActive]}>
          <Ionicons
            name={railIconFor(tab, active) as keyof typeof Ionicons.glyphMap}
            size={24}
            color={selected ? colors.accent : colors.textSecondary}
          />
          {badge ? (
            <View style={s.badge} testID={`nav-rail-badge-${tab.key}`}><Text style={s.badgeText}>{badge}</Text></View>
          ) : null}
        </View>
        <Text style={[s.label, selected && s.labelActive]} numberOfLines={1}>{tab.label}</Text>
      </Pressable>
    );
  };

  return (
    <View
      style={[s.rail, { width: MOBILE_RAIL_WIDTH + insetLeft, paddingLeft: insetLeft, paddingBottom: 8 + insetBottom }]}
      testID="mobile-nav-rail"
      accessibilityRole="tablist"
    >
      {showBrand ? (
        <View style={s.brand}>
          {/* Same transparent brand mark as the desktop rail (not the plated app icon). */}
          <Image source={require('../assets/android-icon-foreground.png')} style={s.brandMark} resizeMode="contain" />
        </View>
      ) : null}
      <View style={[s.tabs, !showBrand && s.tabsCompact]}>{main.map(item)}</View>
      {settings ? item(settings) : null}
      {showBrand ? <Text style={s.version}>v{APP_VERSION}</Text> : null}
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  rail: {
    alignItems: 'center',
    paddingTop: 12,
    backgroundColor: colors.railBg,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.border,
  },
  brand: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  brandMark: { width: 58, height: 58 },
  tabs: { flex: 1, paddingTop: 14, gap: 6, alignItems: 'center' },
  tabsCompact: { paddingTop: 0 },
  item: {
    width: MOBILE_RAIL_ITEM.width,
    height: MOBILE_RAIL_ITEM.height,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderRadius: 12,
  },
  itemPressed: { backgroundColor: colors.railHover },
  // Material 3 style active indicator: a pill behind the icon, label underneath.
  indicator: { width: 52, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  indicatorActive: { backgroundColor: colors.railActiveBg },
  label: { color: colors.textSecondary, fontSize: 11, fontWeight: '500', maxWidth: MOBILE_RAIL_ITEM.width },
  labelActive: { color: colors.accent, fontWeight: '600' },
  badge: {
    position: 'absolute', top: -3, right: 4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
    backgroundColor: colors.failed, borderWidth: 2, borderColor: colors.railBg, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '600', lineHeight: 12 },
  version: { color: colors.textMuted, fontSize: 10, marginTop: 4, textAlign: 'center' },
});
