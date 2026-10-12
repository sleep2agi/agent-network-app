// Hub 侧栏「Daemon」：读 host_supervisor，然后打开现有的守护进程管理页。
// 一台直接 openDaemonFromHub；多台用设置行点选，点下去仍是那一页，不是新的空壳。
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { fetchHostSupervisors, type HubConfig } from './api';
import { daemonEntryTarget, type DaemonEntryChoice, type DaemonEntryTarget } from './daemon-entry';
import { useTranslation } from './i18n-react';
import './i18n-daemon';
import './i18n-chat';
import { PANE_BACK_TEST_ID, paneShowsBack } from './pane-header';
import { SettingsGroup, SettingsRow } from './settings-kit';
import { colors, onThemeChange, spacing, type, weight } from './theme';
import { buttonStyle, buttonTextStyle } from './elevation';

type ViewState = { kind: 'loading' } | DaemonEntryTarget;

function rowSubtitle(row: DaemonEntryChoice, tr: (key: string) => string): string | undefined {
  const parts = [
    row.hostname && row.hostname !== row.alias ? row.hostname : '',
    row.online === true ? tr('daemon.entry.online') : row.online === false ? tr('daemon.entry.offline') : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

export default function HubDaemonEntryScreen({
  cfg,
  onOpenDaemon,
  onBack,
  desktop = false,
}: {
  cfg: HubConfig;
  /** 与 Hub 概览点机器行相同：openDaemonFromHub(alias)。 */
  onOpenDaemon: (alias: string) => void;
  onBack: () => void;
  desktop?: boolean;
}) {
  const { t } = useTranslation();
  const openRef = useRef(onOpenDaemon);
  openRef.current = onOpenDaemon;
  const [retryTick, setRetryTick] = useState(0);
  const [view, setView] = useState<ViewState>({ kind: 'loading' });
  const showBack = paneShowsBack(desktop);

  useEffect(() => {
    let cancel = false;
    setView({ kind: 'loading' });
    void fetchHostSupervisors(cfg).then(result => {
      if (cancel) return;
      const target = daemonEntryTarget(result);
      if (target.kind === 'open') {
        openRef.current(target.alias);
        return;
      }
      setView(target);
    }).catch(() => {
      if (!cancel) setView({ kind: 'error' });
    });
    return () => { cancel = true; };
  }, [cfg, retryTick]);

  const note = view.kind === 'choose' ? t('daemon.entry.choose')
    : view.kind === 'missing' ? t('daemon.entry.missing')
    : view.kind === 'unsupported' ? t('daemon.entry.unsupported')
    : view.kind === 'error' ? t('daemon.entry.error')
    : '';

  return (
    <View testID="hub-daemon-entry" style={styles.root}>
      <View style={styles.header}>
        {showBack ? (
          <Pressable
            testID={PANE_BACK_TEST_ID}
            accessibilityRole="button"
            accessibilityLabel={t('chat.back')}
            onPress={onBack}
            hitSlop={8}
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
        ) : null}
        <Text style={styles.title} numberOfLines={1}>{t('server.integrations.daemon')}</Text>
      </View>
      {view.kind === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.loading}>{t('daemon.entry.loading')}</Text>
        </View>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollInner} keyboardShouldPersistTaps="handled">
          {note ? <Text style={styles.note}>{note}</Text> : null}
          {view.kind === 'choose' ? (
            <SettingsGroup testID="hub-daemon-entry-list">
              {view.daemons.map(row => (
                <SettingsRow
                  key={row.alias}
                  testID={`hub-daemon-entry-${row.alias}`}
                  icon="hardware-chip-outline"
                  label={row.alias}
                  subtitle={rowSubtitle(row, t)}
                  onPress={() => onOpenDaemon(row.alias)}
                />
              ))}
            </SettingsGroup>
          ) : (
            <Pressable
              testID="hub-daemon-entry-retry"
              accessibilityRole="button"
              onPress={() => setRetryTick(tick => tick + 1)}
              style={({ pressed }) => [buttonStyle('primary'), styles.retry, pressed && { opacity: 0.85 }]}
            >
              <Text style={buttonTextStyle('primary')}>{t('daemon.mgmt.retry')}</Text>
            </Pressable>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.xl,
      paddingBottom: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    title: { flex: 1, color: colors.text, fontSize: type.title, fontWeight: weight.strong },
    scroll: { flex: 1 },
    scrollInner: { paddingBottom: spacing.xl * 2, width: '100%' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
    loading: { color: colors.textSecondary, fontSize: type.body, lineHeight: 20 },
    note: { color: colors.textSecondary, fontSize: type.body, lineHeight: 20, paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
    retry: { alignSelf: 'flex-start', marginHorizontal: spacing.xl, marginTop: spacing.lg },
  });

let styles = makeStyles();
onThemeChange(() => {
  styles = makeStyles();
});
