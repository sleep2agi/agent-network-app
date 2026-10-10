/**
 * web GUI 验收夹具。不连 Hub。
 * `?fixture=daemon-overview&theme=dark|light&mode=demo|reported`
 * 左边是 Daemon 设置导航，全览是默认项。托管的节点和集成只标出名字。
 */
import { useState } from 'react';
import { Platform, Pressable, SafeAreaView, StyleSheet, View } from 'react-native';
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
        {section === 'overview' ? (
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
        )}
      </View>
    </SafeAreaView>
  );
}

const makeStyles = () => StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
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
