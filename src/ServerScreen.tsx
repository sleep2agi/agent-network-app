import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { fetchServerVersion, fetchStatus, HubConfig, Session } from './api';
import { pingHealth } from './server-ping';
import {
  compactId,
  describeFailure,
  formatDuration,
  formatLatency,
  groupHealth,
  latencyTone,
  nextConnectedSince,
  statusCards,
  summarize,
  type AgentListFilter,
} from './server-stats';
import { listHubProfiles, type HubProfile } from './storage';
import { colors, onThemeChange, radius, spacing, type, weight } from './theme';
import { usePoll } from './usePoll';

// 服务器页(手机 / 安卓折叠屏 / 桌面「服务器管理 → 概览」共用)。
//
// Vincent 0.2.107(展开的折叠屏):「你这个服务器部分也难看的要死」。旧版是一张
// 「303 在线 Agents」大卡 + 三行信息,其余全空;而 303 是**全部已注册**会话数,不是在线数
// (见 server-stats.ts 顶部)。现在这一屏回答四件事:
//   1. 网络里的 agent 状态(在线/总数、工作中、异常、离线 —— 点卡片进列表并按该状态筛选);
//   2. 各分组的在线比例(与 Agent 列表同一份分组,点一行进列表并筛到该组);
//   3. 连接本身(地址、hub 版本、网络 id、实测延迟、已连接多久;断开时给原因和重试);
//   4. 常用入口(节点管理 / 新建节点 / 定时任务 / 事件与日志),复用已有的屏。
// 宽屏(≥ WIDE_MIN)分两栏:左 = 概况 + 分组,右 = 连接 + 操作;窄屏单栏。

/** 两栏的最小内容宽度(dp)。按本屏自身宽度判断,不按窗口 —— 桌面端它旁边还有侧栏。 */
export const WIDE_MIN = 760;
/** 分组默认显示的行数;更多的折叠在「全部 N 个分组」后面。 */
const GROUPS_COLLAPSED = 8;

// 「已连接多久」的起点按服务器地址记在模块里:切走再回到这一页不应该从零开始计时。
const connectedSinceByServer = new Map<string, number | null>();

export default function ServerScreen({
  cfg,
  onOpenLogs,
  onOpenAgents,
  onOpenNodes,
  onCreateNode,
  onOpenScheduled,
  onSwitchProfile,
  onAddServer,
}: {
  cfg: HubConfig;
  /** 事件与日志。 */
  onOpenLogs?: () => void;
  /** 点状态卡片 / 分组行:进 Agent 列表并带上筛选。 */
  onOpenAgents?: (filter: AgentListFilter) => void;
  /** 节点管理(不带筛选的列表)。 */
  onOpenNodes?: () => void;
  onCreateNode?: () => void;
  onOpenScheduled?: () => void;
  /** 有多个已保存的服务器时显示「切换服务器」(目前只有桌面端会存多个)。 */
  onSwitchProfile?: (profileId: string) => void | Promise<void>;
  onAddServer?: () => void;
}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [version, setVersion] = useState<string | undefined>();
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [since, setSince] = useState<number | null>(() => connectedSinceByServer.get(cfg.serverUrl) ?? null);
  const [refreshing, setRefreshing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [width, setWidth] = useState(0);
  const [allGroups, setAllGroups] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<HubProfile[]>([]);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    let ok = false;
    try {
      const data = await fetchStatus(cfg);
      setSessions(data.sessions ?? []);
      setFailure(null);
      ok = true;
    } catch (e) {
      setFailure(describeFailure(e));
    }
    const next = nextConnectedSince(connectedSinceByServer.get(cfg.serverUrl) ?? null, ok, Date.now());
    connectedSinceByServer.set(cfg.serverUrl, next);
    setSince(next);
    setReachable(ok);
    setLoaded(true);
    setRefreshing(false);
    setRetrying(false);
    const [v, ms] = await Promise.all([fetchServerVersion(cfg), ok ? pingHealth(cfg) : Promise.resolve(null)]);
    setVersion(v);
    setLatency(ms);
  }, [cfg]);

  usePoll(load, 10000, [load]);

  // 「已连接 N 分钟」每分钟走一格,不必等下一次轮询。
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!onSwitchProfile) return;
    let live = true;
    listHubProfiles().then(r => { if (live) setProfiles(r.profiles); }).catch(() => {});
    return () => { live = false; };
  }, [onSwitchProfile, cfg.profileId]);

  const copy = useCallback((key: string, value: string) => {
    void Clipboard.setStringAsync(value).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(c => (c === key ? null : c)), 1500);
    }).catch(() => {});
  }, []);

  if (!loaded) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const stats = summarize(sessions);
  const cards = statusCards(stats);
  const groups = groupHealth(sessions);
  const shownGroups = allGroups ? groups : groups.slice(0, GROUPS_COLLAPSED);
  const host = cfg.serverUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const wide = width >= WIDE_MIN;
  const hasData = sessions.length > 0;
  const toneColor = { good: colors.running, fair: colors.blocked, slow: colors.failed, unknown: colors.textMuted }[latencyTone(latency)];
  const otherProfiles = profiles.filter(p => p.profileId !== cfg.profileId);
  const retry = () => { setRetrying(true); void load(); };

  const overview = (
    <View style={styles.section} testID="server-overview">
      <View style={styles.cardGrid}>
        {cards.map(card => (
          <Pressable
            key={card.key}
            testID={`server-card-${card.key}`}
            accessibilityRole="button"
            accessibilityLabel={`${card.label} ${card.value}${card.of != null ? ` / ${card.of}` : ''},查看列表`}
            disabled={!onOpenAgents}
            onPress={() => onOpenAgents?.(card.filter)}
            style={({ pressed }) => [styles.statCard, wide ? styles.statCardWide : styles.statCardPhone, pressed && styles.pressed]}
          >
            <View style={styles.statHead}>
              <View style={[styles.statDot, { backgroundColor: colors[card.tone] }]} />
              <Text style={styles.statLabel}>{card.label}</Text>
              {onOpenAgents ? <Ionicons name="chevron-forward" size={14} color={colors.textMuted} style={styles.statChevron} /> : null}
            </View>
            <Text style={styles.statValueLine} numberOfLines={1}>
              <Text style={[styles.statValue, card.key === 'error' && card.value > 0 && { color: colors.failed }]}>
                {hasData || reachable ? String(card.value) : '—'}
              </Text>
              {card.of != null ? <Text style={styles.statOf}>{` / ${card.of}`}</Text> : null}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  const groupPanel = groups.length ? (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>分组</Text>
        <Text style={styles.sectionMeta}>{groups.length} 个分组 · 在线 / 总数</Text>
      </View>
      <View style={styles.panel} testID="server-groups">
        {shownGroups.map((g, i) => (
          <Pressable
            key={g.title}
            testID={`server-group-${g.title}`}
            accessibilityRole="button"
            accessibilityLabel={`${g.title} ${g.online}/${g.total} 在线`}
            disabled={!onOpenAgents}
            onPress={() => onOpenAgents?.({ group: g.title })}
            style={({ pressed }) => [styles.groupRow, i > 0 && styles.groupRowBorder, pressed && styles.pressedRow]}
          >
            <Text style={styles.groupName} numberOfLines={1}>{g.title}</Text>
            <View style={styles.groupTrack}>
              {g.online > 0 ? (
                <View style={[styles.groupFill, { width: `${Math.max(2, Math.round(g.ratio * 100))}%`, backgroundColor: colors.running }]} />
              ) : null}
            </View>
            <Text style={styles.groupCount}>
              <Text style={styles.groupOnline}>{g.online}</Text>
              <Text>{`/${g.total}`}</Text>
            </Text>
          </Pressable>
        ))}
        {groups.length > GROUPS_COLLAPSED ? (
          <Pressable
            testID="server-groups-toggle"
            onPress={() => setAllGroups(v => !v)}
            style={({ pressed }) => [styles.groupRow, styles.groupRowBorder, styles.groupMore, pressed && styles.pressedRow]}
          >
            <Text style={styles.linkText}>{allGroups ? '收起' : `全部 ${groups.length} 个分组`}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  ) : null;

  const connection = (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>连接</Text>
      </View>
      <View style={styles.panel} testID="server-connection">
        {reachable === false ? (
          <View style={styles.failBox} testID="server-disconnected">
            <Ionicons name="alert-circle" size={18} color={colors.failed} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.failTitle}>连接已断开</Text>
              <Text style={styles.failReason}>{failure ?? '无法访问服务器'}</Text>
              {hasData ? <Text style={styles.failHint}>下面的数字是最后一次成功读取的结果</Text> : null}
            </View>
            <Pressable
              testID="server-retry"
              accessibilityRole="button"
              onPress={retry}
              disabled={retrying}
              style={({ pressed }) => [styles.retryBtn, (pressed || retrying) && styles.pressed]}
            >
              {retrying ? <ActivityIndicator size="small" color={colors.onAccent} /> : <Text style={styles.retryText}>重试</Text>}
            </Pressable>
          </View>
        ) : null}
        <InfoRow icon="globe-outline" label="地址" value={host} onCopy={() => copy('host', cfg.serverUrl)} copied={copied === 'host'} />
        <InfoRow icon="pricetag-outline" label="版本" value={version ? `v${version}` : '—'} />
        <InfoRow
          icon="git-network-outline"
          label="网络"
          value={compactId(cfg.networkId)}
          mono
          onCopy={cfg.networkId ? () => copy('net', cfg.networkId!) : undefined}
          copied={copied === 'net'}
        />
        <InfoRow
          icon="speedometer-outline"
          label="延迟"
          value={formatLatency(latency)}
          valueColor={latency == null ? undefined : toneColor}
          testID="server-latency"
        />
        <InfoRow
          icon="time-outline"
          label="已连接"
          value={reachable ? formatDuration(since == null ? null : Date.now() - since) : '—'}
          last
        />
      </View>
    </View>
  );

  const actions = [
    { key: 'nodes', label: '节点管理', icon: 'git-network-outline' as const, onPress: onOpenNodes },
    { key: 'create', label: '新建节点', icon: 'add-circle-outline' as const, onPress: onCreateNode },
    { key: 'scheduled', label: '定时任务', icon: 'time-outline' as const, onPress: onOpenScheduled },
    { key: 'logs', label: '事件与日志', icon: 'pulse-outline' as const, onPress: onOpenLogs },
  ].filter(a => a.onPress);

  const actionPanel = actions.length ? (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>操作</Text>
      </View>
      <View style={styles.actionGrid}>
        {actions.map(a => (
          <Pressable
            key={a.key}
            testID={`server-action-${a.key}`}
            accessibilityRole="button"
            accessibilityLabel={a.label}
            onPress={a.onPress}
            style={({ pressed }) => [styles.actionTile, pressed && styles.pressed]}
          >
            <View style={styles.actionIcon}>
              <Ionicons name={a.icon} size={18} color={colors.accent} />
            </View>
            <Text style={styles.actionLabel} numberOfLines={1}>{a.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  ) : null;

  const switcher = onSwitchProfile && otherProfiles.length ? (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>切换服务器</Text>
      </View>
      <View style={styles.panel} testID="server-switch">
        {otherProfiles.map((p, i) => (
          <Pressable
            key={p.profileId}
            accessibilityRole="button"
            onPress={() => { void onSwitchProfile(p.profileId); }}
            style={({ pressed }) => [styles.groupRow, i > 0 && styles.groupRowBorder, pressed && styles.pressedRow]}
          >
            <Ionicons name="server-outline" size={16} color={colors.textSecondary} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.profileHost} numberOfLines={1}>{p.displayName || p.serverUrl.replace(/^https?:\/\//, '')}</Text>
              <Text style={styles.profileUser} numberOfLines={1}>{p.username}{p.requiresReauth ? ' · 需要重新登录' : ''}</Text>
            </View>
            <Ionicons name="swap-horizontal" size={16} color={colors.textMuted} />
          </Pressable>
        ))}
        {onAddServer ? (
          <Pressable onPress={onAddServer} style={({ pressed }) => [styles.groupRow, styles.groupRowBorder, styles.groupMore, pressed && styles.pressedRow]}>
            <Text style={styles.linkText}>添加服务器</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  ) : null;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, wide && styles.contentWide]}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
          tintColor={colors.accent}
        />
      }
    >
      <View style={styles.header} testID="server-header">
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>服务器</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{host}</Text>
        </View>
        <View style={[styles.pill, { backgroundColor: colors.subtleFill }]} testID="server-status-pill">
          <View style={[styles.dot, { backgroundColor: reachable ? colors.running : colors.failed }]} />
          <Text style={[styles.pillText, { color: reachable ? colors.text : colors.failed }]}>{reachable ? '已连接' : '连接失败'}</Text>
        </View>
      </View>

      {wide ? (
        <View style={styles.columns} testID="server-two-column">
          <View style={styles.colMain}>
            {overview}
            {groupPanel}
          </View>
          <View style={styles.colSide}>
            {connection}
            {actionPanel}
            {switcher}
          </View>
        </View>
      ) : (
        <View testID="server-one-column">
          {overview}
          {connection}
          {actionPanel}
          {switcher}
          {groupPanel}
        </View>
      )}
    </ScrollView>
  );
}

function InfoRow({ icon, label, value, onCopy, copied, mono, valueColor, last, testID }: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  onCopy?: () => void;
  copied?: boolean;
  mono?: boolean;
  valueColor?: string;
  last?: boolean;
  testID?: string;
}) {
  const body = (
    <>
      <Ionicons name={icon} size={15} color={colors.textMuted} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        testID={testID}
        style={[styles.rowValue, mono && styles.mono, valueColor ? { color: valueColor } : null]}
        numberOfLines={1}
      >
        {value}
      </Text>
      {onCopy ? (
        <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={14} color={copied ? colors.running : colors.textMuted} />
      ) : null}
    </>
  );
  return onCopy ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`复制${label}`}
      onPress={onCopy}
      style={({ pressed }) => [styles.row, !last && styles.rowBorder, pressed && styles.pressedRow]}
    >
      {body}
    </Pressable>
  ) : (
    <View style={[styles.row, !last && styles.rowBorder]}>{body}</View>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    content: { padding: spacing.lg, paddingBottom: spacing.xl, width: '100%', maxWidth: 720, alignSelf: 'center' },
    // 两栏:整体上限 1180,再宽就留白居中,不让「地址」和它的值隔着半个屏。
    contentWide: { maxWidth: 1180, paddingHorizontal: spacing.xl, paddingTop: spacing.xl },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
    pressed: { opacity: 0.7 },
    pressedRow: { backgroundColor: colors.rowHover },

    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
    title: { color: colors.text, fontSize: type.heading, fontWeight: weight.strong },
    subtitle: { color: colors.textMuted, fontSize: type.small, marginTop: 2 },
    pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 28, borderRadius: radius.pill },
    dot: { width: 8, height: 8, borderRadius: 4 },
    pillText: { fontSize: type.small, fontWeight: weight.medium },

    columns: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xl },
    colMain: { flex: 3, minWidth: 0 },
    colSide: { flex: 2, minWidth: 0 },

    section: { marginBottom: spacing.lg },
    sectionHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginBottom: spacing.sm },
    sectionTitle: { color: colors.textSecondary, fontSize: type.small, fontWeight: weight.medium },
    sectionMeta: { color: colors.textMuted, fontSize: type.caption, marginLeft: 'auto' },
    panel: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },

    cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    statCard: {
      backgroundColor: colors.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      minHeight: 84,
      justifyContent: 'space-between',
    },
    // 手机 2×2;宽屏一行 4 张。gap 是 8,所以 2 列各让出 4。
    statCardPhone: { flexBasis: '48%', flexGrow: 1 },
    statCardWide: { flexBasis: 0, flexGrow: 1, minWidth: 120 },
    statHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    statDot: { width: 7, height: 7, borderRadius: 4 },
    statLabel: { color: colors.textSecondary, fontSize: type.small },
    statChevron: { marginLeft: 'auto' },
    statValueLine: { marginTop: spacing.sm },
    statValue: { color: colors.text, fontSize: 28, fontWeight: weight.strong, fontVariant: ['tabular-nums'] },
    statOf: { color: colors.textMuted, fontSize: type.title, fontWeight: weight.regular },

    groupRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      minHeight: 44,
      paddingVertical: spacing.sm,
    },
    groupRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    groupName: { color: colors.text, fontSize: type.body, width: 88 },
    groupTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.subtleFill, overflow: 'hidden' },
    groupFill: { height: 6, borderRadius: 3 },
    groupCount: { color: colors.textMuted, fontSize: type.small, minWidth: 52, textAlign: 'right', fontVariant: ['tabular-nums'] },
    groupOnline: { color: colors.text, fontWeight: weight.medium },
    groupMore: { justifyContent: 'center' },
    linkText: { color: colors.accent, fontSize: type.small, fontWeight: weight.medium },

    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, minHeight: 44 },
    rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    rowLabel: { color: colors.textSecondary, fontSize: type.body, width: 52 },
    rowValue: { flex: 1, color: colors.text, fontSize: type.body, textAlign: 'right' },
    mono: { fontFamily: 'monospace', fontSize: type.small },

    failBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      padding: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.subtleFill,
    },
    failTitle: { color: colors.failed, fontSize: type.body, fontWeight: weight.strong },
    failReason: { color: colors.text, fontSize: type.small, marginTop: 2 },
    failHint: { color: colors.textMuted, fontSize: type.caption, marginTop: 2 },
    retryBtn: { backgroundColor: colors.accent, borderRadius: radius.sm, paddingHorizontal: spacing.md, height: 32, minWidth: 56, alignItems: 'center', justifyContent: 'center' },
    retryText: { color: colors.onAccent, fontSize: type.small, fontWeight: weight.strong },

    actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    actionTile: {
      flexBasis: '48%',
      flexGrow: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      minHeight: 52,
    },
    actionIcon: { width: 30, height: 30, borderRadius: radius.sm, backgroundColor: colors.subtleFill, alignItems: 'center', justifyContent: 'center' },
    actionLabel: { flexShrink: 1, color: colors.text, fontSize: type.body, fontWeight: weight.medium },

    profileHost: { color: colors.text, fontSize: type.body },
    profileUser: { color: colors.textMuted, fontSize: type.caption, marginTop: 1 },
  });

let styles = makeStyles();
onThemeChange(() => {
  styles = makeStyles();
});
