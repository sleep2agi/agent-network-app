// Hub 服务器管理 — SKILLS / 令牌 / Provider 演示壳（侧栏选 tab，主栏展示内容）。
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { useTranslation } from './i18n-react';
import './i18n-backend-pending';
import { BackendPendingIntegration } from './BackendPendingDemo';
import { type PendingTab } from './backend-pending-ui';
import { colors, onThemeChange, spacing, type, weight } from './theme';
import type { HubConfig } from './api';

const TITLE_KEY: Record<PendingTab, string> = {
  skills: 'server.pendingTitle.skills',
  tokens: 'server.pendingTitle.tokens',
  provider: 'server.pendingTitle.provider',
};

export default function HubPendingScreen({ tab, cfg: _cfg }: { tab: PendingTab; cfg: HubConfig }) {
  const { t } = useTranslation();
  return (
    <View testID="hub-pending-screen" style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>{t(TITLE_KEY[tab])}</Text>
        <Text style={styles.subtitle}>{t('backendPending.hubHint')}</Text>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollInner} keyboardShouldPersistTaps="handled">
        <BackendPendingIntegration layer="hub" tab={tab} showTabs={false} testIDPrefix="hub-pending" />
      </ScrollView>
    </View>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    header: {
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.xl,
      paddingBottom: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: spacing.xs,
    },
    title: { color: colors.text, fontSize: type.title, fontWeight: weight.strong },
    subtitle: { color: colors.textSecondary, fontSize: type.body, lineHeight: 20 },
    scroll: { flex: 1 },
    scrollInner: { padding: spacing.xl, paddingBottom: spacing.xl * 2, maxWidth: 760, width: '100%', alignSelf: 'center' },
  });

let styles = makeStyles();
onThemeChange(() => {
  styles = makeStyles();
});
