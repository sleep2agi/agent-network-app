import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import * as Clipboard from 'expo-clipboard';
import { fetchHostSupervisors, fetchNodeStatus, fetchServerVersion, fetchStatus, HubConfig, Session, type HostSupervisorDaemon } from './api';
import { hostLevels, HOSTS_COLLAPSED, type HostLevel, type LevelTone, type Meter } from './host-levels';
import { pingHealth } from './server-ping';
import { displayHubAddress, maskHubAddress } from './mask-hub-address';
import { PANE_BACK_TEST_ID } from './pane-header';
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
import { colors, mixHex, onThemeChange, radius, spacing, type, weight } from './theme';
import { usePoll } from './usePoll';
import { elevated, buttonStyle, buttonTextStyle } from './elevation';

// 服务器页(手机 / 安卓折叠屏 / 桌面「服务器管理 → 概览」共用)。
//
// Vincent 0.2.107(展开的折叠屏):「你这个服务器部分也难看的要死」。旧版是一张
// 「303 在线 Agents」大卡 + 三行信息,其余全空;而 303 是**全部已注册**会话数,不是在线数
// (见 server-stats.ts 顶部)。现在这一屏回答四件事:
//   1. 网络里的 agent 状态(在线/总数、工作中、异常、离线 —— 点卡片进列表并按该状态筛选);
//   2. 各分组的在线比例(与 Agent 列表同一份分组,点一行进列表并筛到该组);
//   3. 连接本身(地址、hub 版本、网络 id、实测延迟、已连接多久;断开时给原因和重试);
//   4. 常用入口(节点管理 / 新建节点 / 定时任务 / 事件与日志),复用已有的屏。
//   5. 「机器」(#618):节点所在每台机器的 CPU / 内存 / 磁盘水位(host-levels.ts 定规则,点一台进节点列表筛到它)。
// 宽屏(≥ WIDE_MIN)分两栏:左 = 概况 + 机器 + 分组,右 = 连接 + 操作;窄屏单栏(概况之后紧跟机器)。
// 机器放主栏:三根条要横向长度才读得出差别,右栏 ~440px 放三列条每列不到 100px。

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
  onBack,
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
  /** 手机:从 设置 → 服务器 推进来的二级页,左上角「‹」回设置(Vincent 2026-09-29 底部 tab 换成 任务)。宽屏 / 桌面不传。 */
  onBack?: () => void;
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
  // #649:地址默认打码。只放在本屏的 state 里:离开这一屏(组件卸载)就回到打码;切服务器也收回。
  const [revealHost, setRevealHost] = useState(false);
  useEffect(() => { setRevealHost(false); }, [cfg.serverUrl]);
  const [profiles, setProfiles] = useState<HubProfile[]>([]);
  const [, setTick] = useState(0);
  // #618:全量 /api/status(带 host 遥测)。null = 还没读到 / 这个连接读不了(没有 network_id)。
  const [hostRows, setHostRows] = useState<Session[] | null>(null);
  const [allHosts, setAllHosts] = useState(false);
  // 「离线机器 N 台」折叠区默认收起。
  const [showOfflineHosts, setShowOfflineHosts] = useState(false);
  // host_supervisor daemon 列表:只用来给机器起显示名(daemon-alpha → alpha)。读不到 = 空,名字退回 hostname 规则。
  const [daemons, setDaemons] = useState<HostSupervisorDaemon[]>([]);

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

  // 机器水位走全量投影(light 没有 host 字段),比列表轮询慢一档:心跳本身也不是秒级的,
  // 而全量正文在大网络上是 light 的 ~5 倍。读失败就保留上一份 —— 过期判定按心跳时间走,
  // 旧数会自己变灰并写「数据 N 分钟前」,不会被当成现在。
  const loadHosts = useCallback(async () => {
    if (!cfg.networkId) return;
    try {
      const data = await fetchNodeStatus(cfg);
      setHostRows(data.sessions ?? []);
    } catch {}
  }, [cfg]);
  usePoll(loadHosts, 30000, [loadHosts]);
  // daemon 很少增减,一分钟一次足够;读失败保留上一份。
  const loadDaemons = useCallback(async () => {
    try {
      const r = await fetchHostSupervisors(cfg);
      if (r.ok) setDaemons(r.daemons ?? []);
    } catch {}
  }, [cfg]);
  usePoll(loadDaemons, 60000, [loadDaemons]);

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
  const host = displayHubAddress(cfg.serverUrl, revealHost);
  const wide = width >= WIDE_MIN;
  const hasData = sessions.length > 0;
  const toneColor = { good: colors.running, fair: colors.blocked, slow: colors.failed, unknown: colors.textMuted }[latencyTone(latency)];
  const otherProfiles = profiles.filter(p => p.profileId !== cfg.profileId);
  const retry = () => { setRetrying(true); void load(); };
  const { hosts, active: activeHosts, offline: offlineHosts, unreported } = hostLevels(hostRows ?? [], Date.now(), daemons);
  const shownHosts = allHosts ? activeHosts : activeHosts.slice(0, HOSTS_COLLAPSED);
  const openHost = (h: HostLevel) => onOpenAgents?.({ host: h.hostname, aliases: h.aliases, hostLabel: h.displayName });

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

  const hostPanel = hosts.length ? (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>机器</Text>
        <Text style={styles.sectionMeta} numberOfLines={1} testID="server-hosts-summary">
          {`在线机器 ${activeHosts.length} 台 · 离线 ${offlineHosts.length} 台${unreported ? ` · ${unreported} 个节点未上报` : ''}`}
        </Text>
      </View>
      <View style={styles.panel} testID="server-hosts">
        {shownHosts.map((h, i) => (
          <HostRow key={h.hostname} host={h} wide={wide} first={i === 0} onPress={onOpenAgents ? () => openHost(h) : undefined} />
        ))}
        {activeHosts.length > HOSTS_COLLAPSED ? (
          <Pressable
            testID="server-hosts-toggle"
            onPress={() => setAllHosts(v => !v)}
            style={({ pressed }) => [styles.groupRow, styles.groupRowBorder, styles.groupMore, pressed && styles.pressedRow]}
          >
            <Text style={styles.linkText}>{allHosts ? '收起' : `全部 ${activeHosts.length} 台`}</Text>
          </Pressable>
        ) : null}
        {offlineHosts.length ? (
          <Pressable
            testID="server-hosts-offline-toggle"
            accessibilityRole="button"
            accessibilityState={{ expanded: showOfflineHosts }}
            onPress={() => setShowOfflineHosts(v => !v)}
            style={({ pressed }) => [styles.groupRow, activeHosts.length > 0 && styles.groupRowBorder, pressed && styles.pressedRow]}
          >
            <Ionicons name="moon-outline" size={14} color={colors.textMuted} />
            <Text style={styles.offlineHostsLabel} numberOfLines={1}>{`离线机器 ${offlineHosts.length} 台`}</Text>
            <Ionicons name={showOfflineHosts ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} style={styles.offlineHostsChevron} />
          </Pressable>
        ) : null}
        {showOfflineHosts
          ? offlineHosts.map(h => (
            <HostRow key={h.hostname} host={h} wide={wide} first={false} onPress={onOpenAgents ? () => openHost(h) : undefined} />
          ))
          : null}
      </View>
    </View>
  ) : null;

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
              <Text style={styles.failReason}>{failure ?? '无法访问 Hub'}</Text>
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
        <InfoRow
          icon="globe-outline"
          label="地址"
          value={host}
          testID="server-address"
          // 复制的永远是完整地址,和是否展开无关。
          onCopy={() => copy('host', cfg.serverUrl)}
          copied={copied === 'host'}
          revealed={revealHost}
          onToggleReveal={() => setRevealHost(v => !v)}
        />
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
        <Text style={styles.sectionTitle}>切换 Hub</Text>
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
              <Text style={styles.profileHost} numberOfLines={1}>{p.displayName || maskHubAddress(p.serverUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</Text>
              <Text style={styles.profileUser} numberOfLines={1}>{p.username}{p.requiresReauth ? ' · 需要重新登录' : ''}</Text>
            </View>
            <Ionicons name="swap-horizontal" size={16} color={colors.textMuted} />
          </Pressable>
        ))}
        {onAddServer ? (
          <Pressable onPress={onAddServer} style={({ pressed }) => [styles.groupRow, styles.groupRowBorder, styles.groupMore, pressed && styles.pressedRow]}>
            <Text style={styles.linkText}>添加 Hub</Text>
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
        {onBack ? (
          <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="返回设置" testID={PANE_BACK_TEST_ID} style={({ pressed }) => pressed && styles.pressed}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>Hub</Text>
          <Text style={styles.subtitle} numberOfLines={1} testID="server-subtitle">{host}</Text>
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
            {hostPanel}
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
          {hostPanel}
          {connection}
          {actionPanel}
          {switcher}
          {groupPanel}
        </View>
      )}
    </ScrollView>
  );
}

const METERS = [
  { key: 'cpu', label: 'CPU' },
  { key: 'mem', label: '内存' },
  { key: 'disk', label: '磁盘' },
] as const;

/**
 * 水位条配色(看板「app 机器水位条配色太丑」,Vincent 2026-10-06「改成那个蓝色,我们蓝色主题的」):
 *   正常 = 主题强调色 accent(晴蓝),轨道 = 强调色的浅底 tonalBg —— 不再是深绿条 + 中性灰轨道。
 *   警告 / 危险仍用主题的 blocked / failed,但向卡片底色淡一档(HOST_ALERT_SOFTEN),
 *   跟晴蓝站在同一亮度上,不再是「泥橙」。全部从主题 token 推出,不写死色值;深浅色各自跟着换。
 *   过期的机器:条灰、轨道也退回中性灰(subtleFill)—— 蓝轨道只给「现在」的数。
 */
const HOST_ALERT_SOFTEN = 0.22;
function toneColor(tone: LevelTone, stale: boolean): string | undefined {
  if (stale) return colors.textMuted;
  if (tone === 'ok') return colors.accent;
  if (tone === 'warn') return mixHex(colors.blocked, colors.card, HOST_ALERT_SOFTEN);
  if (tone === 'danger') return mixHex(colors.failed, colors.card, HOST_ALERT_SOFTEN);
  return undefined;
}

/** 一根水位条。缺数据 = 只有轨道(不画 0% 的条);过期 = 灰色。 */
function MeterBar({ meter, stale, testID, grow }: { meter: Meter; stale: boolean; testID: string; grow?: boolean }) {
  const fill = toneColor(meter.tone, stale);
  return (
    <View style={[styles.meterTrack, stale && styles.meterTrackStale, grow && styles.meterTrackGrow]} testID={testID}>
      {meter.pct != null && fill ? (
        <View style={[styles.meterFill, { width: `${Math.max(2, Math.round(meter.pct))}%`, backgroundColor: fill }, stale && styles.meterFillStale]} />
      ) : null}
    </View>
  );
}

/**
 * 一台机器。宽屏:左边固定宽的名字列,右边三列等宽(CPU / 内存 / 磁盘),每列「标签 … 百分比」/ 条 / 细节。
 * 窄屏:名字一行,下面三行「标签 | 条 | 百分比 · 细节」,标签列定宽 —— 两种布局里条的左边缘逐行对齐。
 */
function HostRow({ host: h, wide, first, onPress }: { host: HostLevel; wide: boolean; first: boolean; onPress?: () => void }) {
  const pctColor = (m: Meter) => (h.stale ? colors.textMuted : m.tone === 'danger' ? colors.failed : colors.text);
  // 完整 hostname:桌面悬停出提示条;手机点名字展开第二行(灰字)。显示名 = hostname 时都不需要。
  const [hovered, setHovered] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const nameText = (
    <Text style={[styles.hostName, h.stale && styles.hostNameStale]} numberOfLines={1} testID={`server-host-name-${h.hostname}`}>{h.displayName}</Text>
  );
  const nameLine = (
    <View style={styles.hostNameLine}>
      {h.alert ? <View style={styles.alertDot} testID={`server-host-alert-${h.hostname}`} accessibilityLabel="告警" /> : null}
      {h.renamed ? (
        <Pressable
          testID={`server-host-namebtn-${h.hostname}`}
          accessibilityRole="button"
          accessibilityLabel={`完整主机名 ${h.hostname}`}
          onPress={wide ? onPress : () => setExpanded(v => !v)}
          onHoverIn={() => setHovered(true)}
          onHoverOut={() => setHovered(false)}
          hitSlop={4}
          style={styles.hostNameBtn}
        >
          {nameText}
          {!wide ? <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={12} color={colors.textMuted} /> : null}
        </Pressable>
      ) : nameText}
      {wide && hovered && h.renamed ? (
        <View style={styles.hostTip} pointerEvents="none" testID={`server-host-tip-${h.hostname}`}>
          <Text style={styles.hostTipText} numberOfLines={1}>{h.hostname}</Text>
        </View>
      ) : null}
    </View>
  );
  const counts = (
    <Text style={styles.hostNodes} numberOfLines={1} testID={`server-host-count-${h.hostname}`}>
      <Text style={styles.groupOnline}>{`${h.online} 在线`}</Text>
      <Text>{` · 共 ${h.total}`}</Text>
    </Text>
  );
  const staleTag = h.staleLabel ? (
    <View style={styles.staleTag} testID={`server-host-stale-${h.hostname}`}>
      <Ionicons name="time-outline" size={11} color={colors.textMuted} />
      <Text style={styles.staleText} numberOfLines={1}>{h.staleLabel}</Text>
    </View>
  ) : null;
  const name = wide ? (
    <View style={styles.hostNameCol}>
      {nameLine}
      {counts}
      {staleTag}
    </View>
  ) : (
    <View style={styles.hostHeadPhoneWrap}>
      <View style={styles.hostHeadPhone}>
        {nameLine}
        <View style={styles.hostHeadPhoneMeta}>
          {staleTag}
          {counts}
        </View>
      </View>
      {expanded && h.renamed ? (
        <Text style={styles.hostFullName} numberOfLines={1} selectable testID={`server-host-full-${h.hostname}`}>{h.hostname}</Text>
      ) : null}
    </View>
  );
  const a11y = `${h.displayName}${h.renamed ? `(${h.hostname})` : ''}${h.alert ? ' 告警' : ''} ${h.online} 在线 · 共 ${h.total} 节点 · ${METERS.map(m => `${m.label} ${h[m.key].value}`).join(' · ')}${h.staleLabel ? ` · ${h.staleLabel}` : ''},查看节点`;
  return (
    <Pressable
      testID={`server-hostrow-${h.hostname}`}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [wide ? styles.hostRowWide : styles.hostRowPhone, !first && styles.groupRowBorder, pressed && styles.pressedRow, hovered && styles.hostRowRaised]}
    >
      {name}
      {wide ? (
        <View style={styles.hostMetersWide}>
          {METERS.map(m => (
            <View key={m.key} style={styles.meterColWide}>
              <View style={styles.meterHead}>
                <Text style={styles.meterLabel}>{m.label}</Text>
                <Text style={[styles.meterPct, { color: pctColor(h[m.key]) }]}>{h[m.key].value}</Text>
              </View>
              <MeterBar meter={h[m.key]} stale={h.stale} testID={`server-host-bar-${m.key}-${h.hostname}`} />
              <Text style={styles.meterDetail} numberOfLines={1}>{h[m.key].detail}</Text>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.hostMetersPhone}>
          {METERS.map(m => (
            <View key={m.key} style={styles.meterLinePhone}>
              <Text style={styles.meterLabelPhone}>{m.label}</Text>
              <MeterBar meter={h[m.key]} stale={h.stale} grow testID={`server-host-bar-${m.key}-${h.hostname}`} />
              <Text style={styles.meterValuePhone} numberOfLines={1}>
                <Text style={[styles.meterPct, { color: pctColor(h[m.key]) }]}>{h[m.key].value}</Text>
                {h[m.key].detail !== '—' ? <Text style={styles.meterDetailInline}>{`  ${h[m.key].detail}`}</Text> : null}
              </Text>
            </View>
          ))}
        </View>
      )}
    </Pressable>
  );
}

function InfoRow({ icon, label, value, onCopy, copied, mono, valueColor, last, testID, revealed, onToggleReveal }: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  onCopy?: () => void;
  copied?: boolean;
  /** #649:有它就在值后面放一个眼睛按钮(打码 ↔ 完整)。 */
  revealed?: boolean;
  onToggleReveal?: () => void;
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
      {onToggleReveal ? (
        <Pressable
          testID={testID ? `${testID}-reveal` : undefined}
          accessibilityRole="button"
          accessibilityLabel={revealed ? `隐藏${label}` : `显示完整${label}`}
          accessibilityState={{ selected: !!revealed }}
          hitSlop={8}
          onPress={onToggleReveal}
          style={({ pressed }) => [styles.revealBtn, pressed && styles.pressed]}
        >
          <Ionicons name={revealed ? 'eye-off-outline' : 'eye-outline'} size={15} color={colors.accent} />
        </Pressable>
      ) : null}
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
    dot: { width: 8, height: 8, borderRadius: radius.pill },
    pillText: { fontSize: type.small, fontWeight: weight.medium },

    columns: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xl },
    colMain: { flex: 3, minWidth: 0 },
    colSide: { flex: 2, minWidth: 0 },

    section: { marginBottom: spacing.lg },
    sectionHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginBottom: spacing.sm },
    sectionTitle: { color: colors.textSecondary, fontSize: type.small, fontWeight: weight.medium },
    sectionMeta: { color: colors.textMuted, fontSize: type.caption, marginLeft: 'auto' },
    panel: { backgroundColor: colors.card, borderRadius: radius.surface, overflow: 'hidden', ...elevated('raised') },

    cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    statCard: {
      backgroundColor: colors.card,
      borderRadius: radius.surface,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      minHeight: 84,
      justifyContent: 'space-between',
      ...elevated('raised'),
    },
    // 手机 2×2;宽屏一行 4 张。gap 是 8,所以 2 列各让出 4。
    statCardPhone: { flexBasis: '48%', flexGrow: 1 },
    statCardWide: { flexBasis: 0, flexGrow: 1, minWidth: 120 },
    statHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    statDot: { width: 7, height: 7, borderRadius: radius.pill },
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
    groupTrack: { flex: 1, height: 6, borderRadius: radius.pill, backgroundColor: colors.subtleFill, overflow: 'hidden' },
    groupFill: { height: 6, borderRadius: radius.pill },
    groupCount: { color: colors.textMuted, fontSize: type.small, minWidth: 52, textAlign: 'right', fontVariant: ['tabular-nums'] },
    groupOnline: { color: colors.text, fontWeight: weight.medium },
    groupMore: { justifyContent: 'center' },
    hostRowWide: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
    hostRowPhone: { paddingHorizontal: spacing.md, paddingVertical: spacing.md, gap: spacing.sm },
    hostNameCol: { width: 128, gap: 2, zIndex: 2 },
    hostRowRaised: { zIndex: 5 },
    hostNameLine: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0, flexShrink: 1 },
    hostNameBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, minWidth: 0, flexShrink: 1 },
    alertDot: { width: 7, height: 7, borderRadius: radius.pill, backgroundColor: colors.failed, flexShrink: 0 },
    // 提示条落在名字下方(盖住「N 在线」那行),不出这一行的上下边界 —— 面板 overflow:hidden 会裁掉出界的部分。
    hostTip: { position: 'absolute', top: '100%', left: 0, marginTop: 2, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.item, backgroundColor: colors.railTooltipBg, zIndex: 40 },
    hostTipText: { color: colors.railTooltipText, fontSize: 12, lineHeight: 16 },
    hostHeadPhoneWrap: { gap: 2 },
    hostHeadPhone: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    hostHeadPhoneMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginLeft: 'auto', flexShrink: 0 },
    hostFullName: { color: colors.textMuted, fontSize: type.caption, fontVariant: ['tabular-nums'] },
    offlineHostsLabel: { color: colors.textSecondary, fontSize: type.small, flexShrink: 1 },
    offlineHostsChevron: { marginLeft: 'auto' },
    hostName: { color: colors.text, fontSize: type.body, fontWeight: weight.medium, flexShrink: 1 },
    hostNameStale: { color: colors.textSecondary },
    hostNodes: { color: colors.textMuted, fontSize: type.small, fontVariant: ['tabular-nums'] },
    staleTag: { flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-start', paddingHorizontal: 6, height: 18, borderRadius: radius.pill, backgroundColor: colors.subtleFill },
    staleText: { color: colors.textMuted, fontSize: type.caption },
    hostMetersWide: { flex: 1, minWidth: 0, flexDirection: 'row', gap: spacing.lg },
    meterColWide: { flex: 1, flexBasis: 0, minWidth: 0, gap: 4 },
    meterHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.xs },
    meterLabel: { color: colors.textSecondary, fontSize: type.small },
    meterPct: { fontSize: type.small, fontWeight: weight.medium, fontVariant: ['tabular-nums'] },
    meterDetail: { color: colors.textMuted, fontSize: type.caption, fontVariant: ['tabular-nums'] },
    meterTrackGrow: { flex: 1, minWidth: 0 },
    meterTrack: { height: 6, borderRadius: radius.pill, backgroundColor: colors.tonalBg, overflow: 'hidden' },
    meterTrackStale: { backgroundColor: colors.subtleFill },
    meterFill: { height: 6, borderRadius: radius.pill },
    meterFillStale: { opacity: 0.55 },
    hostMetersPhone: { gap: 6 },
    meterLinePhone: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 20 },
    meterLabelPhone: { color: colors.textSecondary, fontSize: type.small, width: 32 },
    meterValuePhone: { width: 148, textAlign: 'right', fontVariant: ['tabular-nums'] },
    meterDetailInline: { color: colors.textMuted, fontSize: type.caption, fontWeight: weight.regular },
    linkText: { color: colors.accent, fontSize: type.small, fontWeight: weight.medium },

    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, minHeight: 44 },
    rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    rowLabel: { color: colors.textSecondary, fontSize: type.body, width: 52 },
    rowValue: { flex: 1, color: colors.text, fontSize: type.body, textAlign: 'right' },
    revealBtn: { paddingHorizontal: 2, alignItems: 'center', justifyContent: 'center' },
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
    retryBtn: { ...buttonStyle('primary'), minWidth: 56 },
    retryText: { ...buttonTextStyle('primary') },

    actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    actionTile: {
      flexBasis: '48%',
      flexGrow: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.card,
      borderRadius: radius.surface,
      paddingHorizontal: spacing.md,
      minHeight: 52,
      ...elevated('raised'),
    },
    actionIcon: { width: 30, height: 30, borderRadius: radius.item, backgroundColor: colors.subtleFill, alignItems: 'center', justifyContent: 'center' },
    actionLabel: { flexShrink: 1, color: colors.text, fontSize: type.body, fontWeight: weight.medium },

    profileHost: { color: colors.text, fontSize: type.body },
    profileUser: { color: colors.textMuted, fontSize: type.caption, marginTop: 1 },
  });

let styles = makeStyles();
onThemeChange(() => {
  styles = makeStyles();
});
