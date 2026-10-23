/**
 * web GUI 验收夹具。不连 Hub。
 * `?fixture=daemon-overview&theme=dark|light&mode=demo|reported`
 * 左边是 Daemon 设置导航，全览是默认项。托管的节点和集成只标出名字。
 */
import { useState } from 'react';
import { Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import DaemonOverviewSection from './DaemonOverviewSection';
import { fixtureOverview, parseDaemonOverviewFixture } from './daemon-overview';
import { t } from './i18n';
import './i18n-daemon';
import './i18n-backend-pending';
import { colors, onThemeChange, radius, setThemeMode, spacing, themeMode, type, weight } from './theme';
import type { HubConfig } from './api';

const DUMMY_CFG: HubConfig = { serverUrl: 'http://127.0.0.1:9', token: 'fixture', networkId: 'fixture-net' };

type FixtureSection = 'overview' | 'nodes' | 'skills' | 'tokens' | 'provider';

const NAV: Array<{ key: FixtureSection; label: string; icon: keyof typeof Ionicons.glyphMap; group: 'settings' | 'daemon' | 'integrations' }> = [
  { key: 'overview', label: 'daemon.overview.nav', icon: 'speedometer-outline', group: 'settings' },
  { key: 'nodes', label: 'daemon.mgmt.nodesCount', icon: 'git-network-outline', group: 'daemon' },
  { key: 'skills', label: 'server.pendingTitle.skills', icon: 'extension-puzzle-outline', group: 'integrations' },
  { key: 'tokens', label: 'server.pendingTitle.tokens', icon: 'key-outline', group: 'integrations' },
  { key: 'provider', label: 'server.pendingTitle.provider', icon: 'cube-outline', group: 'integrations' },
];

export function readDaemonOverviewFixture(): { theme: 'dark' | 'light'; mode: 'demo' | 'reported' } | null {
  if (Platform.OS !== 'web') return null;
  try {
    return parseDaemonOverviewFixture(String((globalThis as { location?: { search?: string } }).location?.search ?? ''));
  } catch {
    return null;
  }
}

export default function DaemonOverviewFixtureScreen({ theme, mode }: { theme: 'dark' | 'light'; mode: 'demo' | 'reported' }) {
  if (themeMode() !== theme) setThemeMode(theme);
  const [section, setSection] = useState<FixtureSection>('overview');
  const overview = fixtureOverview(mode);
  // 手机上真实屏幕（DaemonManagementScreen）会把 248px 侧栏收成一条可滑的分段,
  // 夹具以前无论多宽都画宽屏布局 —— 390px 截图里正文被挤到只剩一条缝,
  // 拿它当验收会把「夹具的锅」判成产品的锅。现在跟真实布局一起收。
  const { width } = useWindowDimensions();
  const narrow = width > 0 && width < 700;
  const navItems = NAV.map(item => {
    const on = section === item.key;
    const label = item.key === 'nodes' ? t(item.label, { count: 0 }) : t(item.label);
    return { item, on, label };
  });
  if (narrow) {
    return (
      <SafeAreaView testID="daemon-overview-fixture" style={styles.rootNarrow}>
        <View style={styles.kickerRow}>
          <Text style={styles.kicker}>{t('daemon.mgmt.kicker')}</Text>
          <Text style={styles.alias} numberOfLines={1}>daemon-a</Text>
        </View>
        {/* flexGrow:0 —— 横向 ScrollView 在竖向容器里默认会长满剩余高度,把每个 chip 拉成一根竖条(0.2.80 的任务筛选行同一个坑)。 */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow} contentContainerStyle={styles.chips}>
          {navItems.map(({ item, on, label }) => (
            <Pressable key={item.key} testID={`daemon-section-${item.key}`} accessibilityRole="tab" accessibilityState={{ selected: on }}
              onPress={() => setSection(item.key)} style={[styles.chip, on && styles.chipOn]}>
              <Ionicons name={item.icon} size={15} color={on ? colors.accent : colors.textSecondary} />
              <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>{label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.pane}>{body()}</View>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView testID="daemon-overview-fixture" style={styles.root}>
      <View style={styles.nav}>
        <Text style={styles.kicker}>{t('daemon.mgmt.kicker')}</Text>
        <Text style={styles.alias}>daemon-a</Text>
        {(['settings', 'daemon', 'integrations'] as const).map(group => (
          <View key={group}>
            <Text style={styles.group}>{t(group === 'settings' ? 'daemon.settings' : group === 'daemon' ? 'daemon.mgmt.kicker' : 'server.integrations')}</Text>
            {NAV.filter(item => item.group === group).map(item => {
              const on = section === item.key;
              const label = item.key === 'nodes' ? t(item.label, { count: 0 }) : t(item.label);
              return (
                <Pressable
                  key={item.key}
                  testID={`daemon-section-${item.key}`}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  onPress={() => setSection(item.key)}
                  style={[styles.item, on && styles.itemOn]}
                >
                  <Ionicons name={item.icon} size={18} color={on ? colors.accent : colors.textSecondary} />
                  <Text style={[styles.itemText, on && styles.itemTextOn]} numberOfLines={1}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
      <View style={styles.pane}>
        {body()}
      </View>
    </SafeAreaView>
  );

  function body() {
    return section === 'overview' ? (
          <DaemonOverviewSection
            cfg={DUMMY_CFG}
            alias="daemon-a"
            nodeId="node_d1"
            nodeHostname="box-a"
            supervisor={null}
            listing="listed"
            daemonVersion={null}
            preview={overview}
          />
        ) : (
          <View testID="daemon-overview-fixture-other" style={styles.other}>
            <Text style={styles.otherTitle}>{section === 'nodes' ? t('daemon.mgmt.nodesCount', { count: 0 }) : t(NAV.find(item => item.key === section)?.label ?? 'daemon.overview.nav')}</Text>
          </View>
        );
  }
}

const makeStyles = () => StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
  rootNarrow: { flex: 1, backgroundColor: colors.bg },
  kickerRow: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: 2 },
  chipRow: { flexGrow: 0, flexShrink: 0 },
  chips: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.rowActive },
  chipText: { color: colors.textSecondary, fontSize: type.small },
  chipTextOn: { color: colors.accent }, 
  nav: { width: 248, borderRightWidth: 1, borderRightColor: colors.border, paddingVertical: spacing.sm },
  kicker: { color: colors.textMuted, fontSize: type.caption, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  alias: { color: colors.text, fontSize: type.title, fontWeight: weight.strong, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  group: { color: colors.textMuted, fontSize: type.caption, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  item: { minHeight: 42, marginHorizontal: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.item, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  itemOn: { backgroundColor: colors.rowActive },
  itemText: { color: colors.textSecondary, fontSize: 13, fontWeight: weight.medium, flex: 1 },
  itemTextOn: { color: colors.text, fontWeight: weight.strong },
  pane: { flex: 1, minWidth: 0 },
  other: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  otherTitle: { color: colors.text, fontSize: type.heading, fontWeight: weight.strong },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
