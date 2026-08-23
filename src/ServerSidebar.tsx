import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fetchStatus, type HubConfig } from './api';
import { colors, spacing } from './theme';
import { usePoll } from './usePoll';

export type ServerSection = 'overview' | 'nodes' | 'create' | 'logs';

const ITEMS: Array<{ key: ServerSection; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: 'overview', label: '概览', icon: 'grid-outline' },
  { key: 'nodes', label: '节点', icon: 'git-network-outline' },
  { key: 'create', label: '新建节点', icon: 'add-circle-outline' },
  { key: 'logs', label: '事件与日志', icon: 'pulse-outline' },
];

export default function ServerSidebar({ cfg, active, onSelect }: {
  cfg: HubConfig;
  active: ServerSection;
  onSelect: (section: ServerSection) => void;
}) {
  const [online, setOnline] = useState<number | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const load = useCallback(async () => {
    try {
      const result = await fetchStatus(cfg);
      setOnline(result.sessions?.length ?? 0);
      setReachable(true);
    } catch {
      setReachable(false);
    }
  }, [cfg]);
  usePoll(load, 10000, [load]);

  const host = cfg.serverUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return (
    <View style={styles.root} testID="server-sidebar">
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <View style={[styles.serverIcon, reachable === false && styles.serverIconFailed]}>
            <Ionicons name="server" size={18} color="#fff" />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.title}>当前服务器</Text>
            <Text style={styles.host} numberOfLines={1}>{host}</Text>
          </View>
        </View>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: reachable === false ? colors.failed : reachable ? colors.running : colors.textMuted }]} />
          <Text style={styles.status}>{reachable === null ? '正在连接' : reachable ? '已连接' : '连接失败'}</Text>
          {online === null ? <ActivityIndicator size="small" color={colors.textMuted} /> : <Text style={styles.count}>{online} 个在线节点</Text>}
        </View>
      </View>

      <Text style={styles.sectionLabel}>服务器管理</Text>
      <View style={styles.items}>
        {ITEMS.map(item => (
          <Pressable
            key={item.key}
            accessibilityLabel={`服务器-${item.label}`}
            onPress={() => onSelect(item.key)}
            style={({ pressed }) => [styles.item, active === item.key && styles.itemActive, pressed && { opacity: 0.65 }]}
          >
            <Ionicons name={item.icon} size={18} color={active === item.key ? colors.accent : colors.textSecondary} />
            <Text style={[styles.itemText, active === item.key && styles.itemTextActive]}>{item.label}</Text>
            {item.key === 'nodes' && online !== null ? <Text style={styles.badge}>{online}</Text> : null}
          </Pressable>
        ))}
      </View>
      <View style={styles.footer}>
        <Text style={styles.footerLabel}>网络</Text>
        <Text style={styles.footerValue} numberOfLines={1}>{cfg.networkId ?? 'default'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  serverIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  serverIconFailed: { backgroundColor: colors.failed },
  title: { color: colors.text, fontSize: 14, fontWeight: '700' },
  host: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, gap: 7 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  status: { color: colors.textSecondary, fontSize: 11 },
  count: { color: colors.textMuted, fontSize: 11, marginLeft: 'auto' },
  sectionLabel: { color: colors.textMuted, fontSize: 11, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  items: { paddingHorizontal: spacing.sm, gap: 3 },
  item: { height: 42, borderRadius: 8, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  itemActive: { backgroundColor: colors.card },
  itemText: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
  itemTextActive: { color: colors.text, fontWeight: '600' },
  badge: { marginLeft: 'auto', color: colors.textMuted, fontSize: 11 },
  footer: { marginTop: 'auto', borderTopWidth: 1, borderTopColor: colors.border, padding: spacing.lg },
  footerLabel: { color: colors.textMuted, fontSize: 10 },
  footerValue: { color: colors.textSecondary, fontSize: 12, marginTop: 3 },
});
