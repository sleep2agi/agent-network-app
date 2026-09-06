import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import {
  fetchHostSupervisors,
  HostSupervisorDaemon,
  HostSupervisorListResult,
  HubConfig,
} from './api';
import { describeDaemonCapability } from './daemon-capability';
import LocalDaemonSetupCard from './LocalDaemonSetupCard';
import { LOCAL_HUB_PROFILE_ID } from './local-hub';
import { isTauriDesktop } from './clipboard-attachment';
import { colors, onThemeChange, spacing } from './theme';
import { usePoll } from './usePoll';

// RFC-026 §9.4 / #338 mobile picker — design locked by 通信龙 + Vincent UX.
// 3 states, mirroring dashboard PR4 but with RN primitives:
//   count=0 → onboarding card with install command (tap-to-copy via Clipboard)
//   count=1 → collapsed auto-pick card; user taps "下一步" to confirm OR
//             "详情" to flip into the picker-list view (preserves selection)
//   count≥2 → vertical FlatList of daemon cards; tap to pick (radio-row)
// Plus loading (ActivityIndicator) and 501 degrade (hub < preview.8).
//
// Reuse src/theme.ts tokens; mirror ServerScreen's card+row+divider pattern.
// 10s foreground poll via usePoll (same cadence as Agents/Server).
//
// Wizard rest (name/runtime/model/flags/confirm) is a follow-up PR; 下一步
// shows a "TODO" alert for now so the picker can ship + be reviewed alone.

export interface HostSupervisorPickerScreenProps {
  cfg: HubConfig;
  onBack: () => void;
  /** Called when the user confirms a selection with 下一步. Wizard not in this PR. */
  onPicked?: (daemon: HostSupervisorDaemon) => void;
}

type ViewMode = 'auto' | 'list';

export default function HostSupervisorPickerScreen({
  cfg,
  onBack,
  onPicked,
}: HostSupervisorPickerScreenProps) {
  const [result, setResult] = useState<HostSupervisorListResult | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('auto');
  // Read-latest pattern (NB-2 follow-up issue #27 discipline ahead-of-time):
  // poll callback reads current selection from a ref instead of closure to
  // avoid stale-closure double-pick on next tick.
  const selectedRef = useRef(selected);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  const load = useCallback(async () => {
    const r = await fetchHostSupervisors(cfg);
    setResult(r);
    setRefreshing(false);
    // count=1 auto-pick (only if user hasn't manually picked yet)
    if (r.ok && r.count === 1 && !selectedRef.current) {
      setSelected(r.daemons[0].daemon_node_id);
    }
  }, [cfg]);

  // 10s foreground poll, same as ServerScreen/Agents. Background-paused
  // by the shared hook so a backgrounded modal doesn't burn battery.
  usePoll(load, 10000, [load]);

  // ── render branches ──────────────────────────────────────────────

  // loading (initial)
  if (!result) {
    return (
      <View style={styles.root}>
        <Header onBack={onBack} title="选服务器" />
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.loadingText}>正在查询…</Text>
        </View>
      </View>
    );
  }

  // hub < preview.8 — honest degrade rather than silently rendering an
  // empty list (which is indistinguishable from "supported hub, no
  // daemons yet")
  if (!result.ok && result.unconfirmed) {
    return (
      <View style={styles.root}>
        <Header onBack={onBack} title="选服务器" />
        <ScrollView contentContainerStyle={styles.contentPad}>
          <View style={styles.warnCard}>
            <Text style={styles.warnTitle}>⚠  服务器未升级</Text>
            <Text style={styles.warnBody}>{result.error}</Text>
            <Text style={styles.warnHint}>
              当前 hub 在 设置 → 服务器 → 版本 可见；升级到 0.9.0-preview.8+ 后此功能才会出现。
            </Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  // generic error
  if (!result.ok) {
    return (
      <View style={styles.root}>
        <Header onBack={onBack} title="选服务器" />
        <View style={styles.center}>
          <Text style={styles.errorTitle}>查询失败</Text>
          <Text style={styles.errorHint}>{result.error}</Text>
          <Pressable
            style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.7 }]}
            onPress={() => { setRefreshing(true); load(); }}
          >
            <Text style={styles.retryBtnText}>重试</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const { count, daemons } = result;

  // count=0 → onboarding
  if (count === 0) {
    return (
      <View style={styles.root}>
        <Header onBack={onBack} title="选服务器" />
        <ScrollView
          contentContainerStyle={styles.contentPad}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={colors.accent}
            />
          }
        >
          {/* app#253 —— 桌面端 + Local workspace:这台机器就是「那台机器」,给一键扫描/安装卡片 */}
          {cfg.profileId === LOCAL_HUB_PROFILE_ID && isTauriDesktop() ? <LocalDaemonSetupCard onInstalled={() => { setRefreshing(true); void load(); }} /> : null}
          <View style={styles.onboardingCard}>
            <Text style={styles.onboardingTitle}>ⓘ  还没有可用的 host_supervisor 节点</Text>
            <Text style={styles.onboardingBody}>
              要在某台机器上创建节点，先在那台机器上跑一次 daemon 初始化命令：
            </Text>
            <CopyableCommand text="anet daemon up my-daemon" />
            <Text style={styles.onboardingHint}>
              注册成功后这里会自动出现（10s 自动刷新）。
            </Text>
          </View>
        </ScrollView>
        <Footer
          disabled
          label="下一步"
          onPress={() => { /* never called when disabled */ }}
        />
      </View>
    );
  }

  // count=1 + viewMode=auto → collapsed auto-pick card
  if (count === 1 && viewMode === 'auto') {
    const d = daemons[0];
    return (
      <View style={styles.root}>
        <Header onBack={onBack} title="选服务器" />
        <ScrollView
          contentContainerStyle={styles.contentPad}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={colors.accent}
            />
          }
        >
          <DaemonCard
            daemon={d}
            selected={true}
            radio={false}
            rightAction={{ label: '详情', onPress: () => setViewMode('list') }}
          />
          <Text style={styles.autoPickHint}>
            将在 {d.alias} 上创建（仅此一台）
          </Text>
          {/* 🔴 只有一台、且它现在建不了节点时,上面那句会把人直接送进一次
              必然失败的提交。这里把它说出来 —— 但**不禁用「下一步」**:
              判据的权威在 hub(它在派发那一刻用新鲜数据再判一次),
              而这份列表可能已经旧了几分钟;禁用会把一个 daemon
              已经恢复的用户彻底卡死,且没有任何出路。
              让他知道 + 让他能试,而不是替他下结论。 */}
          {describeDaemonCapability(d, Date.now()).kind === 'blocked' ? (
            <Text style={styles.autoPickBlocked}>
              ⚠ 这台现在报告「建不了节点」——照上面的原因修好再试，或下拉刷新。
            </Text>
          ) : null}
        </ScrollView>
        <Footer
          disabled={!selected}
          label="下一步"
          onPress={() => handleNext(daemons.find(x => x.daemon_node_id === selected) || d, onPicked)}
        />
      </View>
    );
  }

  // count≥2 (or count=1 in forced list view) → picker list
  return (
    <View style={styles.root}>
      <Header onBack={onBack} title="选服务器" />
      <View style={styles.contentPad}>
        <Text style={styles.listHeader}>
          选择一台 host_supervisor 节点 ({count})
        </Text>
      </View>
      <FlatList
        data={daemons}
        keyExtractor={d => d.daemon_node_id}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={colors.accent}
          />
        }
        renderItem={({ item }) => (
          <DaemonCard
            daemon={item}
            selected={item.daemon_node_id === selected}
            radio
            onPress={() => setSelected(item.daemon_node_id)}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      />
      <Footer
        disabled={!selected}
        label="下一步"
        onPress={() => {
          const d = daemons.find(x => x.daemon_node_id === selected);
          if (d) handleNext(d, onPicked);
        }}
      />
    </View>
  );
}

// ── subcomponents ────────────────────────────────────────────────────

function handleNext(d: HostSupervisorDaemon, onPicked?: (d: HostSupervisorDaemon) => void) {
  if (onPicked) { onPicked(d); return; }
  // Wizard rest is a follow-up PR — surface that honestly instead of
  // pretending to do something. The user pressing "next" and getting a
  // dialog telling them the flow isn't wired yet is much better than a
  // silent no-op that reads as a broken button.
  Alert.alert(
    `已选择 ${d.alias}`,
    '节点创建向导（name / runtime / model / flags / confirm）在后续 PR ship。当前 PR 只实现选服务器步骤。',
    [{ text: '好' }],
  );
}

function Header({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <View style={styles.header}>
      <Pressable
        style={({ pressed }) => [styles.headerBack, pressed && { opacity: 0.6 }]}
        onPress={onBack}
        hitSlop={8}
      >
        <Ionicons name="chevron-back" size={26} color={colors.text} />
      </Pressable>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

function Footer({ disabled, label, onPress }: { disabled: boolean; label: string; onPress: () => void }) {
  return (
    <View style={styles.footer}>
      <Pressable
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.primaryBtn,
          disabled && styles.primaryBtnDisabled,
          pressed && !disabled && { opacity: 0.8 },
        ]}
      >
        <Text style={[styles.primaryBtnText, disabled && styles.primaryBtnTextDisabled]}>
          {label}
        </Text>
      </Pressable>
    </View>
  );
}

function DaemonCard({
  daemon,
  selected,
  radio,
  onPress,
  rightAction,
}: {
  daemon: HostSupervisorDaemon;
  selected: boolean;
  radio: boolean;
  onPress?: () => void;
  rightAction?: { label: string; onPress: () => void };
}) {
  const alert = daemon.host_telemetry?.alert_level || 'gray';
  const alertColor = {
    green: colors.running,
    yellow: colors.blocked,
    red: colors.failed,
    gray: colors.rest,
  }[alert];
  const cardStyle = [
    styles.card,
    selected && styles.cardSelected,
  ];
  const inner = (
    <>
      <View style={styles.cardHeader}>
        <View style={[styles.dot, { backgroundColor: alertColor }]} />
        <Text style={styles.cardTitle} numberOfLines={1}>{daemon.alias}</Text>
        {radio ? (
          <View style={[styles.radio, selected && styles.radioSelected]}>
            {selected ? <View style={styles.radioInner} /> : null}
          </View>
        ) : rightAction ? (
          <Pressable
            onPress={rightAction.onPress}
            hitSlop={6}
            style={({ pressed }) => [pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.rightActionText}>{rightAction.label}</Text>
          </Pressable>
        ) : null}
      </View>
      {daemon.hostname ? (
        <Text style={styles.cardSubtitle} numberOfLines={1}>{daemon.hostname}</Text>
      ) : null}
      <RuntimeChips runtimes={daemon.runtimes_supported} />
      <CapabilityRow daemon={daemon} />
      {(daemon.host_telemetry?.cpu_cores != null || daemon.host_telemetry?.mem_gb != null) ? (
        <Text style={styles.telemetry}>
          {daemon.host_telemetry?.cpu_cores != null ? `${daemon.host_telemetry.cpu_cores} 核` : ''}
          {daemon.host_telemetry?.cpu_cores != null && daemon.host_telemetry?.mem_gb != null ? ' · ' : ''}
          {daemon.host_telemetry?.mem_gb != null ? `${daemon.host_telemetry.mem_gb} GB` : ''}
        </Text>
      ) : null}
    </>
  );
  if (onPress) {
    return (
      <Pressable style={({ pressed }) => [cardStyle, pressed && { opacity: 0.85 }]} onPress={onPress}>
        {inner}
      </Pressable>
    );
  }
  return <View style={cardStyle}>{inner}</View>;
}

// #1545 —— 卡片上那一行「它现在能不能建节点」。
// 三态各一句话,措辞与判据都不在这里产生:见 src/daemon-capability.ts。
function CapabilityRow({ daemon }: { daemon: HostSupervisorDaemon }) {
  const v = describeDaemonCapability(daemon, Date.now());
  const tone = {
    ready: colors.running,
    blocked: colors.failed,
    unknown: colors.rest,
  }[v.kind];
  return (
    <View style={styles.capBlock}>
      <Text style={[styles.capLabel, { color: tone }]}>
        {v.kind === 'ready' ? '✓ ' : v.kind === 'blocked' ? '✕ ' : '? '}
        {v.label}
      </Text>
      {v.detail ? <Text style={styles.capDetail}>{v.detail}</Text> : null}
    </View>
  );
}

function RuntimeChips({ runtimes }: { runtimes?: string[] }) {
  if (!runtimes || runtimes.length === 0) {
    return <Text style={styles.runtimeEmpty}>runtimes_supported: —</Text>;
  }
  return (
    <View style={styles.chipRow}>
      {runtimes.map(r => (
        <View key={r} style={styles.chip}>
          <Text style={styles.chipText}>{r}</Text>
        </View>
      ))}
    </View>
  );
}

function CopyableCommand({ text }: { text: string }) {
  // In-card text swap on tap — Vincent / 通信龙 lock (no Toast dep).
  // "复制" → tap → "已复制 ✓" for 1.5s → back to "复制".
  const [justCopied, setJustCopied] = useState(false);
  const onCopy = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(text);
      setJustCopied(true);
      setTimeout(() => setJustCopied(false), 1500);
    } catch {
      // Fail-silent; user can long-press the code text as a fallback.
    }
  }, [text]);
  return (
    <View style={styles.codeBlock}>
      <Text style={styles.codeText} selectable>{text}</Text>
      <Pressable
        onPress={onCopy}
        hitSlop={8}
        style={({ pressed }) => [pressed && { opacity: 0.6 }]}
      >
        <Text style={[styles.copyBtn, justCopied && styles.copyBtnDone]}>
          {justCopied ? '已复制 ✓' : '复制'}
        </Text>
      </Pressable>
    </View>
  );
}

// ── styles ───────────────────────────────────────────────────────────

const makeStyles = () => StyleSheet.create({
  capBlock: { marginTop: spacing.sm },
  capLabel: { fontSize: 12, fontWeight: '600' },
  capDetail: { color: colors.textMuted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  autoPickBlocked: { color: colors.failed, fontSize: 12, marginTop: spacing.sm, lineHeight: 17, textAlign: 'center' },
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  contentPad: { padding: spacing.lg },
  loadingText: { color: colors.textMuted, marginTop: spacing.md, fontSize: 13 },

  // Header — back button + title (matches existing ChatScreen header tone)
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  headerBack: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { color: colors.text, fontSize: 17, fontWeight: '600', flex: 1, textAlign: 'center' },
  headerSpacer: { width: 40 },

  // count=0 onboarding
  onboardingCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.lg,
  },
  onboardingTitle: { color: colors.text, fontSize: 15, fontWeight: '600', marginBottom: spacing.sm },
  onboardingBody: { color: colors.textSecondary, fontSize: 13, lineHeight: 20, marginBottom: spacing.md },
  onboardingHint: { color: colors.textMuted, fontSize: 12, marginTop: spacing.md },

  // Code block with copy
  codeBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.inputBg,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  codeText: {
    color: colors.accent,
    fontSize: 13,
    flex: 1,
    fontFamily: 'Courier',
  },
  copyBtn: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  copyBtnDone: { color: colors.running },

  // count=1 auto-pick collapsed
  autoPickHint: { color: colors.textMuted, fontSize: 12, marginTop: spacing.md, textAlign: 'center' },

  // count≥2 list
  listHeader: { color: colors.textMuted, fontSize: 12, marginBottom: spacing.sm },

  // Daemon card (shared between count=1 + count≥2 + forced-list)
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md + 2,
  },
  cardSelected: { borderColor: colors.accent },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '600', flex: 1 },
  cardSubtitle: { color: colors.textMuted, fontSize: 12, marginBottom: spacing.xs },
  rightActionText: { color: colors.accent, fontSize: 13, fontWeight: '600' },

  // Radio (count≥2 list)
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderColor: colors.border,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: colors.accent },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },

  // Chips + telemetry
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  chip: {
    backgroundColor: colors.inputBg,
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  chipText: { color: colors.textSecondary, fontSize: 10 },
  runtimeEmpty: { color: colors.textMuted, fontSize: 11, marginTop: spacing.xs },
  telemetry: { color: colors.textMuted, fontSize: 11, marginTop: spacing.xs },

  // Footer (primary button)
  footer: {
    padding: spacing.lg,
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  primaryBtn: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryBtnDisabled: { backgroundColor: colors.border },
  primaryBtnText: { color: colors.onAccent, fontSize: 15, fontWeight: '600' },
  primaryBtnTextDisabled: { color: colors.textMuted },

  // 501 degrade
  warnCard: {
    backgroundColor: colors.card,
    borderColor: colors.blocked,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.lg,
  },
  warnTitle: { color: colors.blocked, fontSize: 15, fontWeight: '600', marginBottom: spacing.sm },
  warnBody: { color: colors.text, fontSize: 13, lineHeight: 20, marginBottom: spacing.md },
  warnHint: { color: colors.textMuted, fontSize: 12 },

  // Generic error
  errorTitle: { color: colors.failed, fontSize: 17, fontWeight: '700', marginBottom: spacing.sm },
  errorHint: { color: colors.textSecondary, fontSize: 14, marginBottom: spacing.lg, textAlign: 'center' },
  retryBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: 10,
  },
  retryBtnText: { color: colors.onAccent, fontSize: 14, fontWeight: '600' },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
