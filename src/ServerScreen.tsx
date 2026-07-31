import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fetchServerVersion, fetchStatus, HubConfig, Session } from './api';
import { colors, onThemeChange, spacing } from './theme';
import { usePoll } from './usePoll';

// Server tab (Vincent tg 847): one glance at the CommHub you're talking to —
// is it reachable, what version, how many agents are live right now. Sits
// left of 设置 in the bottom bar.

export default function ServerScreen({
  cfg,
  onOpenLogs,
}: {
  cfg: HubConfig;
  // Row 6 leaf — passed in from App.tsx so this file stays free of
  // navigation state.
  onOpenLogs?: () => void;
}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [version, setVersion] = useState<string | undefined>();
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchStatus(cfg);
      setSessions(data.sessions ?? []);
      setReachable(true);
    } catch {
      setReachable(false);
    } finally {
      setLoaded(true);
      setRefreshing(false);
    }
    setVersion(await fetchServerVersion(cfg));
  }, [cfg]);

  // Foreground-only polling: 10s while visible, paused in background, instant
  // refresh on resume (shared hook — see usePoll).
  usePoll(load, 10000, [load]);

  if (!loaded) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const online = sessions.length;
  // 'working' and 'running' are the same busy state under two names —
  // different agent runtimes report it differently (cf. theme.ts
  // statusColor, which also folds both) — so count both here.
  const working = sessions.filter(s => s.status === 'working' || s.status === 'running').length;
  const host = cfg.serverUrl.replace(/^https?:\/\//, '');

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ padding: spacing.lg }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
          tintColor={colors.accent}
        />
      }
    >
      <View style={styles.statusRow}>
        <View style={[styles.dot, { backgroundColor: reachable ? colors.running : colors.failed }]} />
        <Text style={styles.statusText}>{reachable ? '已连接' : '连接失败'}</Text>
      </View>

      <View style={styles.metrics}>
        <Metric value={String(online)} label="在线 Agents" />
        <Metric value={String(working)} label="工作中" />
      </View>

      <Text style={styles.sectionTitle}>服务器</Text>
      <View style={styles.card}>
        <Row label="地址" value={host} />
        <Divider />
        <Row label="版本" value={version ? `v${version}` : '—'} />
        <Divider />
        <Row label="网络" value={cfg.networkId ?? '—'} />
      </View>

      {/* Row 6 — jump into the network event stream leaf. Kept as its own
          Pressable row (not inside the info card above) so a tap here
          reads unambiguously as navigation, not "edit a field". */}
      {onOpenLogs ? (
        <>
          <Text style={styles.sectionTitle}>诊断</Text>
          <Pressable
            onPress={onOpenLogs}
            testID="server-open-logs"
            style={({ pressed }) => [styles.card, styles.linkRow, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="pulse-outline" size={18} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.linkRowTitle}>查看事件流</Text>
              <Text style={styles.linkRowSub}>
                网络任务流转（不含消息内容）
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        </>
      ) : null}
    </ScrollView>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const makeStyles = () =>
  StyleSheet.create({
    root: { flex: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg },
    dot: { width: 10, height: 10, borderRadius: 5 },
    statusText: { color: colors.text, fontSize: 16, fontWeight: '600' },
    metrics: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
    metric: {
      flex: 1,
      backgroundColor: colors.card,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 12,
      paddingVertical: spacing.lg,
      alignItems: 'center',
    },
    metricValue: { color: colors.text, fontSize: 26, fontWeight: '700' },
    metricLabel: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    sectionTitle: { color: colors.textMuted, fontSize: 12, marginBottom: spacing.sm, marginTop: spacing.md },
    card: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 12 },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: spacing.lg,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md + 2,
    },
    rowLabel: { color: colors.textSecondary, fontSize: 14 },
    rowValue: { color: colors.text, fontSize: 14, flexShrink: 1 },
    divider: { height: 1, backgroundColor: colors.border, marginLeft: spacing.lg },
    linkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    linkRowTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
    linkRowSub: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  });

let styles = makeStyles();
onThemeChange(() => {
  styles = makeStyles();
});
