import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { fetchServerVersion, fetchStatus, HubConfig, Session } from './api';
import { colors, onThemeChange, spacing } from './theme';

// Server tab (Vincent tg 847): one glance at the CommHub you're talking to —
// is it reachable, what version, how many agents are live right now. Sits
// left of 设置 in the bottom bar.

export default function ServerScreen({ cfg }: { cfg: HubConfig }) {
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

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  if (!loaded) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const online = sessions.length;
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
  });

let styles = makeStyles();
onThemeChange(() => {
  styles = makeStyles();
});
