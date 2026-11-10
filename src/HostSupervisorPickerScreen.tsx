import { describeAllowedSecretKeys } from './daemon-secret-keys';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from './icons';
import {
  fetchHostSupervisors,
  HostSupervisorDaemon,
  HostSupervisorListResult,
  HubConfig,
} from './api';
import { describeDaemonCapability } from './daemon-capability';
import { chipTitle, hiddenChipsLabel, readinessChips, splitReadinessChips, type ReadinessChip } from './runtime-readiness';
import LocalDaemonSetupCard from './LocalDaemonSetupCard';
import { LOCAL_HUB_PROFILE_ID } from './local-hub';
import { isTauriDesktop } from './clipboard-attachment';
import { colors, onThemeChange, spacing, radius } from './theme';
import { usePoll } from './usePoll';
import { PANE_BACK_TEST_ID, paneShowsBack } from './pane-header';
import { pointerUi } from './pointer-ui';
import { buttonStyle, buttonTextStyle } from './elevation';

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
  /** Tauri desktop workspace: the server sidebar selects this page — no phone back (pane-header.ts). */
  desktop?: boolean;
}

type ViewMode = 'auto' | 'list';

/** 机器健康的旁注文字(hub 的 alert_level 原样映射,不在客户端重算判据)。 */
const ALERT_LABEL: Record<string, string> = {
  green: '在线',
  yellow: '有告警',
  red: '异常',
  gray: '未上报',
};

export default function HostSupervisorPickerScreen({
  cfg,
  onBack,
  onPicked,
  desktop = false,
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

  // 下拉刷新只有手指拉得动(RN-web 的 RefreshControl 什么都不画):鼠标 + 键盘(pointer-ui.ts)在标题栏右侧给一个「刷新」。
  const pointer = pointerUi(desktop);
  const refresh = () => { setRefreshing(true); void load(); };
  const headerRefresh = pointer ? { onRefresh: refresh, refreshing } : {};

  // ── render branches ──────────────────────────────────────────────

  // loading (initial)
  if (!result) {
    return (
      <View style={styles.root}>
        <Header onBack={onBack} showBack={paneShowsBack(desktop)} title="选服务器" {...headerRefresh} />
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
        <Header onBack={onBack} showBack={paneShowsBack(desktop)} title="选服务器" {...headerRefresh} />
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
        <Header onBack={onBack} showBack={paneShowsBack(desktop)} title="选服务器" {...headerRefresh} />
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
        <Header onBack={onBack} showBack={paneShowsBack(desktop)} title="选服务器" {...headerRefresh} />
        <ScrollView
          contentContainerStyle={[styles.contentPad, styles.column]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={colors.accent}
            />
          }
        >
          {/* app#253 —— 桌面端 + Local workspace:这台机器就是「那台机器」,给一键扫描/安装卡片 */}
          {cfg.profileId === LOCAL_HUB_PROFILE_ID && isTauriDesktop() ? <LocalDaemonSetupCard cfg={cfg} onInstalled={() => { setRefreshing(true); void load(); }} /> : null}
          <View style={styles.onboardingCard}>
            <Text style={styles.onboardingTitle}>还没有可用的服务器</Text>
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
          hint="还没有可用的服务器：先按上面的命令注册一台"
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
        <Header onBack={onBack} showBack={paneShowsBack(desktop)} title="选服务器" {...headerRefresh} />
        <ScrollView
          contentContainerStyle={[styles.contentPad, styles.column]}
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
              {`⚠ 这台现在报告「建不了节点」——照上面的原因修好再试，或${pointer ? '点右上角「刷新」' : '下拉刷新'}。`}
            </Text>
          ) : null}
        </ScrollView>
        <Footer
          disabled={!selected}
          label="下一步"
          hint="确认用这台服务器"
          onPress={() => handleNext(daemons.find(x => x.daemon_node_id === selected) || d, onPicked)}
        />
      </View>
    );
  }

  // count≥2 (or count=1 in forced list view) → picker list
  const picked = daemons.find(x => x.daemon_node_id === selected);
  return (
    <View style={styles.root}>
      <Header onBack={onBack} showBack={paneShowsBack(desktop)} title="选服务器" {...headerRefresh} />
      <View style={[styles.contentPad, styles.listHeaderPad]}>
        <Text style={[styles.listHeader, styles.column]}>
          选择服务器（{count}）
        </Text>
      </View>
      <FlatList
        data={daemons}
        keyExtractor={d => d.daemon_node_id}
        contentContainerStyle={[styles.column, { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }]}
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
        hint="先选一台服务器，再继续"
        selectedLabel={picked ? `将在 ${picked.alias} 上创建` : undefined}
        onPress={() => {
          if (picked) handleNext(picked, onPicked);
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

function Header({ onBack, showBack, title, onRefresh, refreshing = false }: { onBack: () => void; showBack: boolean; title: string; onRefresh?: () => void; refreshing?: boolean }) {
  const refreshBtn = onRefresh ? <HeaderRefresh onRefresh={onRefresh} refreshing={refreshing} /> : null;
  // Desktop: no back, and the title starts on the content's left edge (a centred phone title
  // between two empty 40 px slots reads as a stray label in a wide pane).
  return showBack ? (
    <View style={styles.header} testID="screen-header">
      <Pressable
        testID={PANE_BACK_TEST_ID}
        style={({ pressed }) => [styles.headerBack, pressed && { opacity: 0.6 }]}
        onPress={onBack}
        hitSlop={8}
      >
        <Ionicons name="chevron-back" size={26} color={colors.text} />
      </Pressable>
      <Text style={styles.headerTitle}>{title}</Text>
      {refreshBtn ?? <View style={styles.headerSpacer} />}
    </View>
  ) : (
    <View style={[styles.header, styles.headerWide]} testID="screen-header">
      <Text style={[styles.headerTitle, styles.headerTitleWide]}>{title}</Text>
      {refreshBtn}
    </View>
  );
}

function HeaderRefresh({ onRefresh, refreshing }: { onRefresh: () => void; refreshing: boolean }) {
  return (
    <Pressable
      testID="picker-refresh"
      accessibilityRole="button"
      accessibilityLabel="刷新"
      disabled={refreshing}
      onPress={onRefresh}
      style={({ pressed, hovered }: any) => [styles.headerRefresh, hovered && styles.headerRefreshHover, pressed && { opacity: 0.6 }]}
    >
      {refreshing ? <ActivityIndicator size="small" color={colors.textMuted} /> : <Ionicons name="refresh-outline" size={16} color={colors.textSecondary} />}
      <Text style={styles.headerRefreshText}>刷新</Text>
    </Pressable>
  );
}

function Footer({ disabled, label, onPress, hint, selectedLabel }: { disabled: boolean; label: string; onPress: () => void; hint?: string; selectedLabel?: string }) {
  // admin 2026-10-21:灰掉的「下一步」不能是一条沉默的大灰条 —— 旁边说明为什么不能点。
  // Vincent 2026-11-10:说明和按钮同一行(说明在左、按钮在右),灰 = 实心中性灰,能点 = 实心强调色 + ›。
  const note = disabled ? hint : selectedLabel;
  return (
    <View style={styles.footer}>
      <View style={[styles.footerInner, styles.column]}>
        {note ? (
          <Text testID={disabled ? 'picker-footer-hint' : 'picker-footer-selected'} style={styles.footerHint} numberOfLines={2}>{note}</Text>
        ) : <View style={styles.footerSpacer} />}
        <Pressable
          testID="picker-next"
          accessibilityRole="button"
          accessibilityState={{ disabled }}
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
          {disabled ? null : <Ionicons name="chevron-forward" size={16} color={colors.onAccent} />}
        </Pressable>
      </View>
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
  const readiness = readinessChips(daemon);
  const alertColor = {
    green: colors.running,
    yellow: colors.blocked,
    red: colors.failed,
    gray: colors.rest,
  }[alert];
  // admin 2026-10-21:健康绿点不能紧挨着选中 radio(看着像同一套控件)——它在标题下面的旁注行里,带字。
  const health = daemon.online === false
    ? { color: colors.rest, label: '离线' }
    : { color: alertColor, label: ALERT_LABEL[alert] ?? ALERT_LABEL.gray };
  const telemetry = [
    daemon.host_telemetry?.cpu_cores != null ? `${daemon.host_telemetry.cpu_cores} 核` : '',
    daemon.host_telemetry?.mem_gb != null ? `${daemon.host_telemetry.mem_gb} GB` : '',
  ].filter(Boolean).join(' · ');
  const keys = describeAllowedSecretKeys(daemon.allowed_secret_keys);
  // Vincent 2026-11-10:整张卡就是选择目标。radio 在最前面,选中时整卡描边 + 浅强调底 —— 一个控件,两处同一信号。
  const inner = (
    <View style={styles.cardRow}>
      {radio ? (
        <View testID="daemon-radio" style={[styles.radio, selected && styles.radioSelected]}>
          {selected ? <View style={styles.radioInner} /> : null}
        </View>
      ) : null}
      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
          <Text testID="daemon-card-title" style={styles.cardTitle} numberOfLines={1}>{daemon.alias}</Text>
          {rightAction ? (
            <Pressable
              onPress={rightAction.onPress}
              hitSlop={6}
              style={({ pressed }) => [pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.rightActionText}>{rightAction.label}</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.metaRow}>
          <View testID="daemon-health-dot" style={[styles.dot, { backgroundColor: health.color }]} />
          <Text style={styles.metaText}>{health.label}</Text>
          {telemetry ? <Text style={styles.metaText}>· {telemetry}</Text> : null}
        </View>
        {/* #623 —— daemon 报了 runtime_readiness:能建的露出来,建不了 / 未检测的收进「+N」。
            机器级闸门(can_create_nodes)不变:建不了 / 未知时那一行照旧在。没报 ⇒ 声明支持的 runtime 名照旧列出。 */}
        {readiness ? <ReadinessChips chips={readiness} /> : <RuntimeChips runtimes={daemon.runtimes_supported} />}
        {readiness && describeDaemonCapability(daemon, Date.now()).kind === 'ready' ? null : <CapabilityRow daemon={daemon} />}
        {/* 机器 ID 与密钥授权(#1475)是旁注:一行小灰字,窄屏自动折行。
            密钥没上报(旧 Hub/daemon)就不显示,不替它说「未授权」。 */}
        {daemon.hostname || keys.kind !== 'unknown' ? (
          <View style={styles.footnoteRow}>
            {daemon.hostname ? (
              <Text testID="daemon-card-id" style={styles.footnote} numberOfLines={1}>机器 ID · {daemon.hostname}</Text>
            ) : null}
            {keys.kind !== 'unknown' ? (
              <Text testID={`daemon-secret-keys-${keys.kind}`} style={styles.footnote} numberOfLines={2}>{keys.text}</Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
  if (onPress) {
    return (
      <Pressable
        testID={`daemon-card-${daemon.daemon_node_id}`}
        accessibilityRole="radio"
        accessibilityState={{ selected, checked: selected }}
        aria-checked={selected}
        accessibilityLabel={daemon.alias}
        style={({ pressed, hovered }: any) => [styles.card, selected && styles.cardSelected, hovered && !selected && styles.cardHover, pressed && { opacity: 0.85 }]}
        onPress={onPress}
      >
        {inner}
      </Pressable>
    );
  }
  return <View testID={`daemon-card-${daemon.daemon_node_id}`} style={[styles.card, selected && styles.cardSelected]}>{inner}</View>;
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

// #623 —— 每个 runtime 一颗胶囊:✓ 能建(绿)/ ✗ 建不了 / ? 未检测(都是中性灰,admin 2026-10-21)。
// Vincent 2026-11-10:默认只露 ✓ 的;✗ / ? 收成一颗「+N」,点开在同一排展开,再点收起。
// 原因:指针悬停出提示条(桌面),点按在胶囊排下面展开同一句(手机,再点收起)。
// 完整原因始终在 accessibilityLabel 里。判据与措辞都不在这里产生:见 src/runtime-readiness.ts。
// 提示条朝**上**弹(同 DegradedBadge):列表里后面的卡片会盖住前面卡片里绝对定位的东西。
function ReadinessChips({ chips }: { chips: ReadinessChip[] }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  // 提示条 260 宽、默认左对齐胶囊;胶囊在排的右半边时改成右对齐,不然会伸出卡片 / 视口。
  const [rowWidth, setRowWidth] = useState(0);
  const [chipX, setChipX] = useState<Record<string, number>>({});
  const { shown, hidden } = splitReadinessChips(chips);
  const visible = showAll ? [...shown, ...hidden] : shown;
  const open = visible.find(c => c.runtime === expanded) ?? null;
  const toggleAll = () => {
    if (showAll && expanded && !shown.some(c => c.runtime === expanded)) setExpanded(null);
    setShowAll(!showAll);
  };
  return (
    <View testID="picker-readiness">
      <View style={styles.chipRow} onLayout={e => setRowWidth(e.nativeEvent.layout.width)}>
        {shown.length === 0 && !showAll ? (
          <Text testID="readiness-none" style={styles.noneText}>没有可直接创建的 runtime</Text>
        ) : null}
        {visible.map(c => {
          const tone = c.view.chip === 'ready' ? colors.running : colors.rest;
          const title = chipTitle(c);
          return (
            <View
              key={c.runtime}
              style={styles.rChipWrap}
              onLayout={e => { const x = e.nativeEvent.layout.x; setChipX(m => (m[c.runtime] === x ? m : { ...m, [c.runtime]: x })); }}
            >
              <Pressable
                testID={`readiness-chip-${c.runtime}`}
                accessibilityRole="button"
                accessibilityLabel={title}
                accessibilityState={{ expanded: expanded === c.runtime }}
                onPress={() => setExpanded(expanded === c.runtime ? null : c.runtime)}
                onHoverIn={() => setHovered(c.runtime)}
                onHoverOut={() => setHovered(h => (h === c.runtime ? null : h))}
                hitSlop={4}
                style={({ pressed }: any) => [
                  styles.rChip,
                  c.view.chip === 'ready' ? { borderColor: tone, backgroundColor: tone + '1f' } : styles.rChipMuted,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text dense selectable={false} numberOfLines={1} style={[styles.rChipText, { color: tone }]}>
                  {`${c.view.icon} ${c.runtime}`}
                </Text>
              </Pressable>
              {hovered === c.runtime && expanded !== c.runtime ? (
                <View testID={`readiness-tip-${c.runtime}`} pointerEvents="none" style={[styles.rTip, rowWidth > 0 && (chipX[c.runtime] ?? 0) > rowWidth / 2 && styles.rTipRight]}>
                  <Text style={styles.rTipText}>{title}</Text>
                </View>
              ) : null}
            </View>
          );
        })}
        {hidden.length > 0 ? (
          <Pressable
            testID="readiness-more"
            accessibilityRole="button"
            accessibilityLabel={showAll ? '收起' : hiddenChipsLabel(hidden)}
            accessibilityState={{ expanded: showAll }}
            onPress={toggleAll}
            hitSlop={4}
            style={({ pressed, hovered: h }: any) => [styles.moreChip, h && styles.moreChipHover, pressed && { opacity: 0.7 }]}
          >
            <Text dense selectable={false} numberOfLines={1} style={styles.moreChipText}>
              {showAll ? '收起' : `+${hidden.length}`}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {open ? (
        <Text testID={`readiness-detail-${open.runtime}`} style={styles.rDetail}>
          {chipTitle(open)}
        </Text>
      ) : null}
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
  headerWide: { paddingHorizontal: spacing.lg, minHeight: 57 },
  headerTitleWide: { textAlign: 'left' },
  // 桌面「刷新」:与标题同一行、垂直居中;32 高,图标 + 字,悬停一档中性底。
  headerRefresh: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 32, paddingHorizontal: spacing.sm, borderRadius: radius.item },
  headerRefreshHover: { backgroundColor: colors.rowHover },
  headerRefreshText: { color: colors.textSecondary, fontSize: 13 },

  // count=0 onboarding
  onboardingCard: {
    backgroundColor: colors.card,
    borderRadius: radius.surface,
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
    borderRadius: radius.item,
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

  // 平板 / 桌面上内容不铺满整个窗格:列表、说明和底栏都收在同一条居中的列里。
  column: { width: '100%', maxWidth: 760, alignSelf: 'center' },

  // count≥2 list
  listHeaderPad: { paddingBottom: 0 },
  listHeader: { color: colors.textMuted, fontSize: 12, marginBottom: spacing.sm },

  // Daemon card (shared between count=1 + count≥2 + forced-list)
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.surface,
    borderWidth: 1.5,
    borderColor: 'transparent',
    padding: spacing.md + 2,
  },
  cardSelected: { borderColor: colors.accent, backgroundColor: colors.tonalBg },
  cardHover: { backgroundColor: colors.rowHover },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  cardBody: { flex: 1, minWidth: 0 },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '600', flex: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2, marginBottom: spacing.xs },
  metaText: { color: colors.textSecondary, fontSize: 12 },
  footnoteRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: 2, marginTop: spacing.sm },
  footnote: { color: colors.textMuted, fontSize: 11, flexShrink: 1 },
  rightActionText: { color: colors.accent, fontSize: 13, fontWeight: '600' },

  // Radio (count≥2 list)
  radio: {
    width: 20,
    height: 20,
    marginTop: 1,
    borderRadius: radius.pill,
    borderColor: colors.textMuted,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: colors.accent },
  radioInner: { width: 10, height: 10, borderRadius: radius.pill, backgroundColor: colors.accent },

  // Chips + telemetry
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  chip: {
    backgroundColor: colors.inputBg,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  chipText: { color: colors.textSecondary, fontSize: 10 },
  // #623 readiness 胶囊
  rChipWrap: { zIndex: 20, maxWidth: '100%' },
  rChip: { borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: spacing.sm, paddingVertical: 2, maxWidth: '100%' },
  rChipMuted: { borderColor: colors.border, backgroundColor: 'transparent' },
  rChipText: { fontSize: 11, fontWeight: '600' },
  moreChip: { borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.inputBg, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  moreChipHover: { borderColor: colors.textMuted },
  moreChipText: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
  noneText: { color: colors.textMuted, fontSize: 12, alignSelf: 'center' },
  rTip: { position: 'absolute', bottom: '100%', marginBottom: 6, left: 0, width: 260, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.item, backgroundColor: colors.railTooltipBg, zIndex: 40 },
  rTipRight: { left: 'auto', right: 0 },
  rTipText: { color: colors.railTooltipText, fontSize: 12, lineHeight: 17 },
  rDetail: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: spacing.xs },
  runtimeEmpty: { color: colors.textMuted, fontSize: 11, marginTop: spacing.xs },
  telemetry: { color: colors.textMuted, fontSize: 11, marginTop: spacing.xs },

  // Footer (primary button)
  footer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    backgroundColor: colors.bg,
  },
  footerInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  footerSpacer: { flex: 1 },
  primaryBtn: { ...buttonStyle('primary'), flexDirection: 'row', gap: 4, minWidth: 128 },
  primaryBtnDisabled: { backgroundColor: colors.border },
  primaryBtnText: { ...buttonTextStyle('primary') },
  primaryBtnTextDisabled: { color: colors.textMuted },
  footerHint: { flex: 1, color: colors.textSecondary, fontSize: 12, lineHeight: 17 },

  // 501 degrade
  warnCard: {
    backgroundColor: colors.card,
    borderColor: colors.blocked,
    borderWidth: 1,
    borderRadius: radius.surface,
    padding: spacing.lg,
  },
  warnTitle: { color: colors.blocked, fontSize: 15, fontWeight: '600', marginBottom: spacing.sm },
  warnBody: { color: colors.text, fontSize: 13, lineHeight: 20, marginBottom: spacing.md },
  warnHint: { color: colors.textMuted, fontSize: 12 },

  // Generic error
  errorTitle: { color: colors.failed, fontSize: 17, fontWeight: '600', marginBottom: spacing.sm },
  errorHint: { color: colors.textSecondary, fontSize: 14, marginBottom: spacing.lg, textAlign: 'center' },
  retryBtn: { ...buttonStyle('primary') },
  retryBtnText: { ...buttonTextStyle('primary') },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
