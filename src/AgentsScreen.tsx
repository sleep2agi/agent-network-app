// 节点列表页 —— 从 App.tsx 抽出(纯搬移;分组/排序/过滤逻辑另见 agents-list.ts)。
//
// 抽出的动机:App.tsx 已 673 行且是多人同时要改的文件(Tasks tab 等),
// 把这 220 行独立出来后,列表页的改动不再和导航结构互相踩。
// 🔴 样式必须从 ./app-styles 引入,不能在本文件复制一份 —— 那是 let 变量,
// 主题切换时整体重新赋值,复制的那份不会跟着变(见 app-styles.ts 头注释)。

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import { isAgentOnline } from './chat-actions';
import { fetchStatus, fetchUserMessages, takeStatusPrefetch, type HubConfig, type Session,
  ackAgentMessages,
  ackUserMessages,
  fetchMessages,
  fetchTasks,
  replyUnreadSince,
} from './api';
import { loadSessionsCache, saveSessionsCache } from './storage';
import { colors, onThemeChange, radius, spacing, statusColor, type, weight } from './theme';
import { ds, fs, listText, uiScale } from './ui-scale';
import { denserRowPitch, publishListFirstRowTop } from './list-rail-align';
import { usePoll } from './usePoll';
import { retryUnreadPersistFromPoll } from './conversation-unread-persist';
import AgentUnreadBadge from './AgentUnreadBadge';
import { formatUnreadBadge, type UnreadState } from './unread-ledger';
import { unreadCountForAgentRow } from './unread-badge';
import {
  bindUnreadAppState,
  getUnreadSnapshot,
  hubHasAgentUnread,
  ingestInboxMessagesBody,
  markAgentReadLocally,
  markAgentServerUnreadCleared,
  unackedIdsForAgent,
  ingestUserMessagesBody,
  replyUnreadCounts,
  subscribeUnread,
} from './unread-store';
import { styles } from './app-styles';
import { applyCollapsed, buildSections, countShown, holdWhileActive, SORT_BY_ACTIVITY, toggleCollapsed } from './agents-list';
import { AGENT_ROW_AVATAR, AGENT_ROW_DOT, AGENT_ROW_GAP, AGENT_ROW_HEIGHT, AGENT_ROW_PAD_X, AGENT_ROW_PAD_Y, AGENT_ROW_SEPARATOR_INSET, AGENT_ROW_TOUCH_MIN, agentRowGeometry, agentRowModel, latestMessageByAgent, rowActivity } from './agent-row-model';
import { TaskTimeResolver } from './agent-task-time';
import { loadCollapsedGroups, saveCollapsedGroups } from './agent-list-prefs';
import { agentUnreadCounts, latestMessageAtByAgent } from './agent-unread-counts';
import { pinyinMatch } from './lib/pinyin';
import { ackAgentUnread } from './agent-ack';
import AgentRowMenu, { type AgentRowMenuTarget } from './AgentRowMenu';
import {
  agentRowMenuItems,
  clearManualUnread,
  hideConversation,
  isConversationHidden,
  markManualUnread,
  partitionHidden,
  pruneRevivedHidden,
  restoreConversation,
  rowBadgeWithManual,
  rowIsUnread,
  type AgentRowMenuKey,
} from './agent-row-menu';
import { bindConversationFlags, getConversationFlags, subscribeConversationFlags, updateConversationFlags } from './conversation-flags';
import { applyAgentFilter, filterLabel, isFilterActive, STATUS_FILTER_LABEL, type AgentListFilter, type AgentStatusFilter } from './server-stats';

export default function AgentsScreen({
  cfg,
  onOpenChat,
  onOpenPicker,
  onOpenNodeDetail,
  compact = false,
  selectedAlias,
  pinnedAliases = [],
  onTogglePin,
  onOpenChatWindow,
  mutedAliases = [],
  onToggleMute,
  preview,
  filter,
}: {
  cfg: HubConfig;
  onOpenChat: (alias: string) => void;
  /** #338 — top-right `+` opens the host_supervisor picker modal. */
  onOpenPicker: () => void;
  /** 会话行菜单里的「节点详情」(2026-09-26 起长按改成弹菜单,以前长按直接进这里)。
   *  没有 onTogglePin 的列表(桌面「服务器 → 节点」)没有菜单,长按仍直接进节点详情。
   *  `onPress` remains the high-frequency path to chat and is NOT changed (通信龙 red-line 71ee862d). */
  onOpenNodeDetail: (alias: string) => void;
  compact?: boolean;
  selectedAlias?: string;
  pinnedAliases?: string[];
  onTogglePin?: (alias: string) => void;
  onOpenChatWindow?: (alias: string) => void;
  /** 0.2.107:本账号下「消息免打扰」的 agent —— 行上画一个静音铃铛。 */
  mutedAliases?: readonly string[];
  /** 桌面右键菜单里的「消息免打扰」开关(手机在会话页右上角)。 */
  onToggleMute?: (alias: string) => void;
  /** GUI 夹具：跳过 Hub 拉取，用同一套行渲染钉死徽标。 */
  preview?: { sessions: Session[]; ledger: UnreadState; serverBody: unknown };
  /** 从服务器页的状态卡片 / 分组行进来时带的筛选(server-stats.ts)。每次导航是一个新对象;
   *  undefined 不清除已有筛选 —— 双栏里点开会话时列表不该丢掉筛选。 */
  filter?: AgentListFilter | null;
}) {
  const [sessions, setSessions] = useState<Session[]>(preview?.sessions ?? []);
  const [loading, setLoading] = useState(!preview);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<AgentListFilter | null>(filter ?? null);
  useEffect(() => { if (filter) setActiveFilter(filter); }, [filter]);
  const filtering = isFilterActive(activeFilter);
  // 会话行菜单(长按 / 右键,AgentRowMenu):对着哪一行、按在哪。只有会话列表有菜单 —— 能置顶的列表才是会话列表。
  const rowMenu = !!onTogglePin;
  const [menuFor, setMenuFor] = useState<AgentRowMenuTarget | null>(null);
  const openRowMenu = useCallback((alias: string, x: number, y: number) => setMenuFor({ alias, x, y }), []);
  // 本机的「不显示该对话」「标为未读」(conversation-flags.ts),按账号分。
  useEffect(() => { bindConversationFlags(cfg); }, [cfg.profileId, cfg.serverUrl, cfg.username]);
  const convFlags = useSyncExternalStore(subscribeConversationFlags, getConversationFlags, getConversationFlags);
  const [showHidden, setShowHidden] = useState(false);
  const [hoveredAlias, setHoveredAlias] = useState<string | null>(null);
  const [unreadSnap, setUnreadSnap] = useState(getUnreadSnapshot);
  useEffect(() => subscribeUnread(() => setUnreadSnap(getUnreadSnapshot())), []);
  useEffect(() => { bindUnreadAppState(); }, []);

  // 「新消息」组(Vincent 2026-09-25「有消息的那些节点,你要置顶」):未读数取自 agentUnreadCounts ——
  // 托盘角标用的同一个函数,列表和托盘永远是同一组会话。
  const liveUnread = useMemo(() => {
    const src = preview
      ? { serverBody: preview.serverBody, ledger: preview.ledger, replyRows: [], replyUsername: '', replyWatermarks: {} }
      : unreadSnap;
    return { counts: agentUnreadCounts(src), lastAt: latestMessageAtByAgent(src) };
  }, [preview, unreadSnap]);
  // Row right column + preview line (phone / two-pane rows): the same snapshot as the counts.
  const latestByAgent = useMemo(() => latestMessageByAgent(preview
    ? { serverBody: preview.serverBody, replyRows: [], replyUsername: '' }
    : unreadSnap), [preview, unreadSnap]);
  // Rows whose second line is the task text get the time of the task that text came from
  // (agent-task-time.ts). One resolver per hub + network; a heartbeat never triggers a read.
  const taskTimes = useMemo(() => new TaskTimeResolver(async alias =>
    (await fetchTasks(cfg, { to_name: alias, limit: 1, skipStats: true })).tasks ?? []),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [cfg.serverUrl, cfg.token, cfg.networkId]);
  const [taskTimesTick, setTaskTimesTick] = useState(0);
  useEffect(() => taskTimes.subscribe(() => setTaskTimesTick(n => n + 1)), [taskTimes]);
  useEffect(() => {
    if (preview) return;
    void taskTimes.request(sessions
      .filter(s => s.task && !latestByAgent[s.alias]?.text)
      .map(s => ({ alias: s.alias, text: s.task ?? '', online: isAgentOnline(s.status) })));
  }, [preview, sessions, latestByAgent, taskTimes]);
  // Row activity time per alias — what `sortByActivity` orders by (off by default: SORT_BY_ACTIVITY).
  const activityByAlias = useMemo(() => {
    const out = new Map<string, number>();
    for (const s of sessions) out.set(s.alias, rowActivity(s, latestByAgent[s.alias], taskTimes.timeFor(s.alias, s.task)).at);
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, latestByAgent, taskTimes, taskTimesTick]);
  // Folded group headers, remembered per device (agent-list-prefs.ts).
  const [collapsed, setCollapsed] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    loadCollapsedGroups().then(v => { if (live) setCollapsed(v); }).catch(() => {});
    return () => { live = false; };
  }, []);
  const toggleGroup = useCallback((title: string) => {
    setCollapsed(prev => {
      const next = toggleCollapsed(prev, title);
      void saveCollapsedGroups(next);
      return next;
    });
  }, []);
  // 指针在列表行间移动 / 滚动的这一小段时间里,先按住上一份分组输入,停手 1.2s 后再换成最新的 ——
  // 否则新消息把行顶下去,光标底下的那一行会跳走。只按住「活动中」,鼠标停在列表上不动时照常上浮。
  const [listActive, setListActive] = useState(false);
  const activeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markListActive = useCallback(() => {
    setListActive(true);
    if (activeTimer.current) clearTimeout(activeTimer.current);
    activeTimer.current = setTimeout(() => setListActive(false), 1200);
  }, []);
  useEffect(() => () => { if (activeTimer.current) clearTimeout(activeTimer.current); }, []);
  const heldUnread = useRef<typeof liveUnread | null>(null);
  const floatInput = holdWhileActive(heldUnread.current, liveUnread, listActive);
  heldUnread.current = floatInput;

  // RN Web's bubbling onContextMenu can run after WKWebView has already
  // decided to show its native "Reload" menu. Intercept in the capture phase
  // at document level so desktop agent rows only ever show our own menu.
  // 手机布局的 web 导出(安卓 UA 的浏览器)行上也挂了 data-agent-alias,右键同样出这份菜单。
  useEffect(() => {
    const doc = (globalThis as any).document;
    if (!rowMenu || Platform.OS !== 'web' || !doc?.addEventListener) return;
    const handleContextMenu = (event: any) => {
      const row = event.target?.closest?.('[data-agent-alias]');
      const alias = row?.getAttribute?.('data-agent-alias');
      if (!alias) return;
      event.preventDefault?.();
      event.stopPropagation?.();
      event.stopImmediatePropagation?.();
      // 夹进窗口由 anchorRowMenu 做(菜单高度随项数变,这里不猜)。
      openRowMenu(alias, event.clientX ?? event.pageX ?? 180, event.clientY ?? event.pageY ?? 180);
    };
    doc.addEventListener('contextmenu', handleContextMenu, true);
    return () => doc.removeEventListener('contextmenu', handleContextMenu, true);
  }, [rowMenu, openRowMenu]);

  const load = useCallback(async () => {
    if (preview) {
      setSessions(preview.sessions);
      setFailed(false);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      // First load consumes the boot prefetch if it's still in-flight/fresh;
      // polls and later loads fall through to a normal fetch.
      const data = await (takeStatusPrefetch(cfg) ?? fetchStatus(cfg));
      const next = data.sessions ?? [];
      setSessions(next);
      setFailed(false);
      // Persist for the next cold start's stale-while-revalidate paint.
      saveSessionsCache(next, cfg.profileId);
    } catch {
      /* keep last good list; with nothing loaded yet, surface the failure */
      setFailed(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
      void retryUnreadPersistFromPoll();
    }
    try {
      ingestUserMessagesBody(await fetchUserMessages(cfg, 50));
    } catch {
      /* 列表照常显示；服务端未读拿不到时 unreadCountForAgentRow 退回 ledger */
    }
    try {
      // agent 回给用户的消息在 inbox 表(alias 分支),不在 user_inbox —— 红点的另一半(reply-unread.ts)
      ingestInboxMessagesBody(await fetchMessages(cfg, 300, replyUnreadSince()), cfg.username);
    } catch {
      /* 拿不到就沿用上一份 replyRows */
    }
  }, [cfg, preview]);

  // Perf (load time): paint the last-known agents from the disk cache
  // immediately so cold start shows content instead of a blank spinner; the
  // live fetch below refreshes within the same tick. Only fills in if the
  // fetch hasn't already populated the list (prev.length guard), so fresh
  // data always wins the race.
  useEffect(() => {
    if (preview) return;
    let live = true;
    loadSessionsCache(cfg.profileId).then(cached => {
      if (live && cached && cached.length) {
        setSessions(prev => (prev.length ? prev : cached));
        setLoading(false);
      }
    });
    return () => { live = false; };
  }, [cfg.profileId]);

  // Foreground-only polling: 10s while visible, paused in background, instant
  // refresh on resume (shared hook — see usePoll).
  usePoll(load, 10000, [load]);

  // 153 agents on the real hub made the flat list unusable. Vincent (tg
  // 1094): group by team so agents are findable, and stop showing offline
  // ones up front. We bucket by team prefix (derived from the alias), order
  // rows inside each team working → idle-online → offline, and sink teams
  // that have no online member to the bottom — so offline never floats up.
  // NOTE: this useMemo MUST stay above the early returns below — a hook after
  // a conditional return changes hook order between renders and crashes (the
  // v0.1.28 launch-crash regression, Vincent tg 1098).
  // 分组/过滤/排序全部下沉到 agents-list.ts(纯逻辑,有 21 条断言钉住;
  // 组内排序的三级与 web 的数据源差异见那边的注释)。
  // NOTE: 这个 useMemo 必须留在下面的 early return 之上 —— hook 出现在条件
  // 返回之后会改变 hook 顺序并崩溃(v0.1.28 launch-crash,Vincent tg 1098)。
  const q = query.trim();
  // 「不显示该对话」的行不进分组,收在列表底部「已隐藏的对话」里;来了更新的消息自动回来(agent-row-menu.ts)。
  const { visible: visibleSessions, hidden: hiddenSessions } = useMemo(
    () => partitionHidden(sessions, convFlags, alias => liveUnread.lastAt[alias] ?? 0, !!q),
    [sessions, convFlags, liveUnread, q],
  );
  useEffect(() => {
    updateConversationFlags(f => pruneRevivedHidden(f, liveUnread.lastAt));
  }, [liveUnread]);
  const sections = useMemo(
    () => buildSections(applyAgentFilter(visibleSessions, activeFilter), query, {
      match: pinyinMatch,
      sort: {
        pinned: alias => pinnedAliases.includes(alias),
        sortByActivity: SORT_BY_ACTIVITY,
        activityAt: alias => activityByAlias.get(alias) ?? 0,
      },
      unread: { count: alias => floatInput.counts[alias] ?? 0, lastMessageAt: alias => floatInput.lastAt[alias] ?? 0 },
    }),
    [visibleSessions, activeFilter, query, pinnedAliases, floatInput, activityByAlias],
  );
  const shownCount = countShown(sections);
  const shownSections = useMemo(() => applyCollapsed(sections, collapsed, query), [sections, collapsed, query]);
  // 更紧凑 (two-pane): tell the nav rail where the first row is and how tall rows are, so rail item n
  // sits beside row n (list-rail-align.ts). Only when the first section has rows on screen
  // (row height/pitch is not measured: both sides compute it with denserRowPitch).
  const alignFirstRow = !compact && uiScale().listDense && (shownSections[0]?.data?.length ?? 0) > 0;
  const listYRef = useRef<number | null>(null); // bottom of head + filter bar
  const firstHeaderHRef = useRef<number | null>(null);
  const publishFirstRowTop = () => {
    if (listYRef.current == null || firstHeaderHRef.current == null) return;
    publishListFirstRowTop(listYRef.current + firstHeaderHRef.current);
  };
  const nowMs = Date.now();

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  // First load failed with nothing cached: a spinner forever is a dead end
  // (Vincent tg 841) — say so and give a retry button.
  if (failed && sessions.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>连接失败</Text>
        <Text style={styles.errorHint}>网络不稳定或服务器未响应，请重试</Text>
        <Pressable
          style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.7 }]}
          onPress={() => {
            setLoading(true);
            load();
          }}
        >
          <Text style={styles.retryBtnText}>重试</Text>
        </Pressable>
      </View>
    );
  }

  // Unread badge for one row — the same computation for the desktop row and the phone row.
  const rowUnreadCount = (alias: string) => unreadCountForAgentRow(
    preview?.serverBody ?? unreadSnap.serverBody,
    preview?.ledger ?? unreadSnap.ledger,
    alias,
    preview ? undefined : replyUnreadCounts(unreadSnap),
  );
  // 手动「标为未读」且没有真实未读时:一个不带数字的红点(微信同款),打开会话即消失。
  const rowBadge = (alias: string) => rowBadgeWithManual(formatUnreadBadge(rowUnreadCount(alias)), convFlags.manualUnread.includes(alias));

  const menuItems = menuFor ? agentRowMenuItems({
    unread: rowIsUnread(rowUnreadCount(menuFor.alias), convFlags.manualUnread.includes(menuFor.alias)),
    pinned: pinnedAliases.includes(menuFor.alias),
    muted: mutedAliases.includes(menuFor.alias),
    hidden: isConversationHidden(convFlags, menuFor.alias, liveUnread.lastAt[menuFor.alias] ?? 0),
    canPin: !!onTogglePin,
    canMute: !!onToggleMute,
    canOpenWindow: !!onOpenChatWindow,
  }) : [];
  const onRowMenu = (key: AgentRowMenuKey, alias: string) => {
    switch (key) {
      case 'read':
        if (rowIsUnread(rowUnreadCount(alias), convFlags.manualUnread.includes(alias))) {
          // 标为已读:手动红点去掉 + 真实未读按「会话渲染到底」同一套清法清掉(本地 + hub ack)。
          updateConversationFlags(f => clearManualUnread(f, alias));
          if (preview) return;
          markAgentReadLocally(alias);
          if (hubHasAgentUnread()) {
            void ackAgentUnread(alias, {
              ackAgent: agent => ackAgentMessages(cfg, agent),
              ackIds: ids => ackUserMessages(cfg, ids),
              idsFor: agent => unackedIdsForAgent(agent),
              clearServerUnread: agent => markAgentServerUnreadCleared(agent),
              warn: (message, error) => console.warn(message, error),
            });
          }
        } else {
          updateConversationFlags(f => markManualUnread(f, alias));
        }
        return;
      case 'pin': onTogglePin?.(alias); return;
      case 'mute': onToggleMute?.(alias); return;
      case 'openWindow': onOpenChatWindow?.(alias); return;
      case 'detail': onOpenNodeDetail(alias); return;
      case 'hide':
        if (isConversationHidden(convFlags, alias, liveUnread.lastAt[alias] ?? 0)) updateConversationFlags(f => restoreConversation(f, alias));
        else updateConversationFlags(f => hideConversation(f, alias, liveUnread.lastAt[alias] ?? 0));
        return;
    }
  };
  // 点开一条隐藏的会话 = 把它找回来(和微信从搜索里点开隐藏会话一样)。
  const openChat = (alias: string) => {
    if (alias in convFlags.hidden) updateConversationFlags(f => restoreConversation(f, alias));
    onOpenChat(alias);
  };

  // Desktop (Tauri) sidebar row — unchanged by the 0.2.106 phone / two-pane redesign.
  const renderCompactRow = (item: Session) => {
    return (
    <Pressable
      {...(compact && rowMenu ? ({ dataSet: { agentAlias: item.alias } } as any) : {})}
      onHoverIn={compact ? () => { setHoveredAlias(item.alias); markListActive(); } : undefined}
      onHoverOut={compact ? () => setHoveredAlias(current => current === item.alias ? null : current) : undefined}
      style={({ pressed }) => [
        styles.card,
        compact && ({ userSelect: 'none', cursor: 'default' } as any),
        compact && {
          borderWidth: 0,
          borderBottomWidth: 0,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
          paddingVertical: 10,
          marginBottom: 2,
          // 极简:两种主题的行都是平铺(不成卡片),只靠悬停/选中的一档中性底色表达状态。
          backgroundColor: 'transparent',
        },
        compact && hoveredAlias === item.alias && { backgroundColor: colors.rowHover },
        selectedAlias === item.alias && { backgroundColor: colors.rowActive },
        item.status === 'offline' && styles.cardOffline,
        pressed && { opacity: 0.7 },
      ]}
      onPress={() => openChat(item.alias)}
      onLongPress={compact ? undefined : () => onOpenNodeDetail(item.alias)}
      delayLongPress={400}
    >
      <View style={styles.avatarWrap}>
        <AliasAvatar alias={item.alias} size={34} />
        {/* 更像微信·round-5: 头像右下在线态圆点(带描边环·offline 灰暗) */}
        <View
          style={[
            styles.statusDot,
            { backgroundColor: statusColor(item.status ?? '', true) },
            !isAgentOnline(item.status) && styles.statusDotOffline,
          ]}
        />
        <AgentUnreadBadge badge={rowBadge(item.alias)} testID={`unread-badge-${item.alias}`} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text dense selectable={false} style={[styles.alias, compact && { fontSize: 13, fontWeight: '600' }]} numberOfLines={1}>
          {pinnedAliases.includes(item.alias) ? '📌 ' : ''}
          {item.alias}
          {mutedAliases.includes(item.alias) ? ' 🔕' : ''}
        </Text>
        {item.task ? (
          <Text dense selectable={false} style={[styles.task, compact && { fontSize: 11 }]} numberOfLines={1}>
            {item.task}
          </Text>
        ) : null}
      </View>
    </Pressable>
    );
  };

  // Phone / Android two-pane row (0.2.106, WeChat-style): flat 68 dp, 44 dp avatar with the
  // online dot, name + last message on two lines, time + unread badge on the right.
  // Model (status → dot / label, time format): agent-row-model.ts.
  const renderPhoneRow = (item: Session) => {
    const pinned = pinnedAliases.includes(item.alias);
    const model = agentRowModel(item, { latest: latestByAgent[item.alias], taskAt: taskTimes.timeFor(item.alias, item.task), pinned, nowMs });
    const selected = selectedAlias === item.alias;
    const rowBg = selected ? colors.rowActive : colors.bg;
    const badge = rowBadge(item.alias);
    return (
      <Pressable
        testID={`agent-row-${item.alias}`}
        {...(rowMenu ? ({ dataSet: { agentAlias: item.alias } } as any) : {})}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityHint={rowMenu ? '长按打开会话菜单' : undefined}
        style={({ pressed }) => [
          rowStyles.row,
          // 菜单开着时,被按住的那一行保持按下态的底色(微信同款:看得出菜单是对哪一行的)。
          { backgroundColor: selected ? colors.rowActive : pressed || menuFor?.alias === item.alias ? colors.rowHover : colors.bg },
        ]}
        onPress={() => openChat(item.alias)}
        onLongPress={rowMenu ? e => openRowMenu(item.alias, e.nativeEvent.pageX, e.nativeEvent.pageY) : () => onOpenNodeDetail(item.alias)}
        delayLongPress={400}
      >
        <View style={rowStyles.avatar}>
          <View style={!model.status.online ? rowStyles.avatarOffline : null}>
            <AliasAvatar alias={item.alias} size={rowGeom().avatar} fixedSize />
          </View>
          <View
            testID={`agent-dot-${item.alias}`}
            style={[rowStyles.dot, { backgroundColor: colors[model.status.dot], borderColor: rowBg }]}
          />
        </View>
        <View style={rowStyles.body}>
          <View style={rowStyles.line}>
            <Text dense selectable={false} numberOfLines={1} style={[rowStyles.name, { color: model.status.online ? colors.text : colors.textSecondary }]}>
              {item.alias}
            </Text>
            {pinned ? <Ionicons name="pin" size={12} color={colors.textMuted} accessibilityLabel="已置顶" style={rowStyles.pin} /> : null}
            {mutedAliases.includes(item.alias) ? <Ionicons name="notifications-off-outline" size={12} color={colors.textMuted} accessibilityLabel="消息免打扰" style={rowStyles.pin} testID={`agent-muted-${item.alias}`} /> : null}
            <Text dense selectable={false} numberOfLines={1} style={[rowStyles.time, { color: colors.textMuted }]}>{model.time}</Text>
          </View>
          {/* No second line when there is nothing to say (and no badge): the name then centres. */}
          {model.status.label || model.preview || badge ? <View style={rowStyles.line}>
            {model.status.label && model.status.labelTone ? (
              <Text dense selectable={false} style={[rowStyles.label, { color: colors[model.status.labelTone] }]}>{model.status.label}</Text>
            ) : null}
            <Text dense selectable={false} numberOfLines={1} style={[rowStyles.preview, { color: colors.textMuted }]}>{model.preview}</Text>
            <AgentUnreadBadge inline badge={badge} testID={`unread-badge-${item.alias}`} />
          </View> : null}
        </View>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: compact ? colors.listBg : colors.bg }}>
      {/* Everything above the list (head + filter bar): its height is where the first group header starts. */}
      <View onLayout={alignFirstRow ? e => { listYRef.current = e.nativeEvent.layout.y + e.nativeEvent.layout.height; publishFirstRowTop(); } : undefined}>
      {compact ? (
        <View testID="agents-list-head" style={{ paddingHorizontal: compact ? spacing.sm : spacing.lg, paddingTop: compact ? spacing.sm : spacing.lg, backgroundColor: compact ? colors.listBg : colors.bg }}>
        <View style={styles.listHeaderRow}>
          <Text style={styles.listHeader}>
            {q ? `${shownCount} / ${sessions.length} agents` : `${sessions.length} agents`}
          </Text>
          <Pressable onPress={onOpenPicker} hitSlop={10} accessibilityLabel="新建节点" style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.6 }]}>
            <Ionicons name="add" size={24} color={colors.accent} />
          </Pressable>
        </View>
        {sessions.length > 10 ? (
          <TextInput style={[styles.search, compact && { backgroundColor: colors.subtleFill, borderWidth: 0, borderRadius: radius.sm }]} placeholder="搜索 agent…" placeholderTextColor={colors.textMuted} autoCapitalize="none" autoCorrect={false} value={query} onChangeText={setQuery} />
        ) : null}
      </View>
      ) : (
        <View testID="agents-list-head" style={[rowStyles.head, { backgroundColor: colors.bg }]}>
          <View style={rowStyles.headRow}>
            {sessions.length > 10 ? (
              <View style={[rowStyles.searchBox, { backgroundColor: colors.subtleFill }]}>
                <Ionicons name="search" size={16} color={colors.textMuted} />
                <TextInput
                  style={[rowStyles.searchInput, { color: colors.text }]}
                  placeholder={`搜索 ${sessions.length} 个 agent`}
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={query}
                  onChangeText={setQuery}
                />
              </View>
            ) : (
              <Text style={[styles.listHeader, { flex: 1 }]}>{`${sessions.length} agents`}</Text>
            )}
            <Pressable onPress={onOpenPicker} hitSlop={10} accessibilityLabel="新建节点" style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.6 }]}>
              <Ionicons name="add" size={24} color={colors.accent} />
            </Pressable>
          </View>
          {q ? <Text style={[styles.listHeader, rowStyles.searchCount]}>{`${shownCount} / ${sessions.length} agents`}</Text> : null}
        </View>
      )}
      {filtering ? (
        <View testID="agent-filter-bar" style={[rowStyles.filterBar, { backgroundColor: compact ? colors.listBg : colors.bg }]}>
          {(['all', 'online', 'working', 'error', 'offline'] as const).map(k => {
            const on = k === 'all' ? !activeFilter?.status : activeFilter?.status === k;
            return (
              <Pressable
                key={k}
                testID={`agent-filter-${k}`}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => setActiveFilter(f => ({ ...f, status: k === 'all' ? undefined : (k as AgentStatusFilter) }))}
                style={[rowStyles.filterChip, { backgroundColor: on ? colors.railActiveBg : colors.subtleFill }]}
              >
                <Text style={[rowStyles.filterChipText, { color: on ? colors.accent : colors.textSecondary }]}>{k === 'all' ? '全部' : STATUS_FILTER_LABEL[k]}</Text>
              </Pressable>
            );
          })}
          {activeFilter?.group ? (
            <View style={[rowStyles.filterChip, { backgroundColor: colors.railActiveBg }]}>
              <Text style={[rowStyles.filterChipText, { color: colors.accent }]}>{`分组 ${activeFilter.group}`}</Text>
            </View>
          ) : null}
          <Pressable testID="agent-filter-clear" accessibilityRole="button" accessibilityLabel="清除筛选" hitSlop={8} onPress={() => setActiveFilter(null)} style={rowStyles.filterClear}>
            <Text style={[rowStyles.filterChipText, { color: colors.textMuted }]}>{`${shownCount} 个`}</Text>
            <Ionicons name="close-circle" size={16} color={colors.textMuted} />
          </Pressable>
        </View>
      ) : null}
      </View>
      <SectionList
      sections={shownSections}
      keyExtractor={s => s.alias}
      onScroll={markListActive}
      scrollEventThrottle={100}
      stickySectionHeadersEnabled={false}
      renderSectionHeader={({ section }) => (
        // Small section label + online/total; tap folds the group (not 新消息, not while searching).
        <Pressable
          onLayout={alignFirstRow && section === shownSections[0] ? e => { firstHeaderHRef.current = e.nativeEvent.layout.height; publishFirstRowTop(); } : undefined}
          testID={`agent-group-${section.title}`}
          disabled={!section.collapsible}
          onPress={() => toggleGroup(section.title)}
          accessibilityRole={section.collapsible ? 'button' : 'header'}
          accessibilityLabel={`${section.title} ${section.online}/${section.total} 在线${section.collapsible ? (section.collapsed ? ',已折叠' : ',已展开') : ''}`}
          accessibilityState={section.collapsible ? { expanded: !section.collapsed } : undefined}
          style={[rowStyles.group, compact ? rowStyles.groupCompact : null, { backgroundColor: compact ? colors.listBg : colors.bg }]}
        >
          {section.collapsible ? (
            <Ionicons name={section.collapsed ? 'chevron-forward' : 'chevron-down'} size={12} color={colors.textMuted} />
          ) : null}
          <Text selectable={false} numberOfLines={1} style={[rowStyles.groupTitle, { color: colors.textMuted }]}>{section.title}</Text>
          <Text selectable={false} style={[rowStyles.groupCount, { color: colors.textMuted }]}>{section.online}/{section.total}</Text>
        </Pressable>
      )}
      ItemSeparatorComponent={compact ? undefined : () => (
        <View style={[rowStyles.separator, { backgroundColor: colors.border }]} />
      )}
      // Perf (render time): the real fleet is 150+ agents. Without these the
      // default virtualization renders/retains far more rows than fit on
      // screen, spiking first-paint cost and scroll jank. Cap the initial
      // batch to ~one screenful and shrink the retained window. (Deliberately
      // NOT using removeClippedSubviews — it can blank rows / break taps on
      // some RN versions, and correctness beats the marginal extra saving.)
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={9}
      updateCellsBatchingPeriod={50}
      contentContainerStyle={compact ? { paddingHorizontal: spacing.sm, paddingBottom: spacing.sm } : { paddingBottom: spacing.sm }}
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
      ListEmptyComponent={
        // 搜不到时必须说出"为什么空",否则用户分不清「搜挂了」和「真没有」
        // ——空白屏是这两种情况唯一相同的表现。加载中/加载失败在上面的
        // early return 里已经各自有屏,走到这里必然是"数据到了但没有匹配"。
        <View style={styles.center}>
          <Text style={styles.errorTitle}>
            {q ? `没有匹配「${q}」的 agent` : filtering ? `没有「${filterLabel(activeFilter!)}」的 agent` : '还没有 agent'}
          </Text>
          <Text style={styles.errorHint}>
            {q
              ? `已在 ${sessions.length} 个 agent 里搜过(支持拼音,如 zf → 支付助手)`
              : '用右上角 + 新建一个'}
          </Text>
          {q ? (
            <Pressable style={styles.retryBtn} onPress={() => setQuery('')}>
              <Text style={styles.retryBtnText}>清空搜索</Text>
            </Pressable>
          ) : filtering ? (
            <Pressable style={styles.retryBtn} onPress={() => setActiveFilter(null)}>
              <Text style={styles.retryBtnText}>清除筛选</Text>
            </Pressable>
          ) : null}
        </View>
      }
      renderItem={({ item }) => (compact ? renderCompactRow(item) : renderPhoneRow(item))}
      ListFooterComponent={hiddenSessions.length ? (
        // 「不显示该对话」收在这里:列表最底下一行入口,点开就地展开,每行长按 → 恢复显示(点开会话也会恢复)。
        <View testID="agent-hidden-footer">
          <Pressable
            testID="agent-hidden-toggle"
            accessibilityRole="button"
            accessibilityState={{ expanded: showHidden }}
            accessibilityLabel={`已隐藏的对话 ${hiddenSessions.length} 个,${showHidden ? '已展开' : '已折叠'}`}
            onPress={() => setShowHidden(v => !v)}
            style={[rowStyles.group, compact ? rowStyles.groupCompact : null, { backgroundColor: compact ? colors.listBg : colors.bg }]}
          >
            <Ionicons name={showHidden ? 'chevron-down' : 'chevron-forward'} size={12} color={colors.textMuted} />
            <Text selectable={false} numberOfLines={1} style={[rowStyles.groupTitle, { color: colors.textMuted }]}>已隐藏的对话</Text>
            <Text selectable={false} style={[rowStyles.groupCount, { color: colors.textMuted }]}>{hiddenSessions.length}</Text>
          </Pressable>
          {showHidden ? hiddenSessions.map(item => (
            <View key={item.alias}>{compact ? renderCompactRow(item) : renderPhoneRow(item)}</View>
          )) : null}
        </View>
      ) : null}
      />
      {rowMenu ? (
        <AgentRowMenu target={menuFor} items={menuItems} touch={!compact} onSelect={onRowMenu} onClose={() => setMenuFor(null)} />
      ) : null}
    </View>
  );
}

// Phone / two-pane list chrome (0.2.106). No colours here — they are passed inline from `colors` at
// render time. Rebuilt on every restyle (theme or 界面密度, src/ui-scale.ts): the row geometry goes
// through ds(), and `spacing` itself is density-scaled.
const rowGeom = () => agentRowGeometry(uiScale().listDense, uiScale().densityFactor);
const makeRowStyles = () => ({
  head: { paddingHorizontal: ds(AGENT_ROW_PAD_X), paddingTop: spacing.sm, paddingBottom: spacing.xs },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: ds(36) },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: ds(6), minHeight: ds(36), borderRadius: radius.md, paddingHorizontal: ds(10) },
  searchInput: { flex: 1, minWidth: 0, fontSize: type.body, paddingVertical: 0, height: Math.max(ds(36), fs(type.body) + 14) },
  searchCount: { marginTop: spacing.xs },
  // 服务器页带来的筛选:一行小胶囊,只在有筛选时出现(平时列表不变)。
  filterBar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingHorizontal: ds(AGENT_ROW_PAD_X), paddingVertical: spacing.xs },
  filterChip: { minHeight: ds(26), borderRadius: radius.pill, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  filterChipText: { fontSize: type.small, fontWeight: weight.medium },
  filterClear: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto' },
  group: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: rowGeom().padX, paddingTop: rowGeom().groupPadTop, paddingBottom: rowGeom().groupPadBottom },
  groupCompact: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  groupTitle: { flexShrink: 1, ...listText('meta'), fontWeight: weight.medium, letterSpacing: 0.4 },
  groupCount: { ...listText('count'), marginLeft: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: rowGeom().gap,
    // agentRowGeometry (agent-row-model.ts): 标准 68 dp / 44 dp avatar; 紧凑 58 / 37; 宽松 78 / 51;
    // 更紧凑 (the Android wide default) 44 / 28 with 14/18 + 12/16 text — the rail's scale. Two text
    // lines + 2 × padY can make a row taller than minHeight (OS font 1.15), never shorter than 44.
    // 更紧凑: every row is exactly the pitch (one- and two-line rows alike) so the rail can match it.
    ...(uiScale().listDense ? { height: denserRowPitch(uiScale().denseFontMultiplier) } : { minHeight: rowGeom().height }),
    paddingHorizontal: rowGeom().padX,
    paddingVertical: rowGeom().padY,
  },
  // AliasAvatar gets the same resolved size with fixedSize, so the dot sits on the avatar's corner.
  avatar: { width: rowGeom().avatar, height: rowGeom().avatar },
  avatarOffline: { opacity: 0.45 },
  dot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: rowGeom().dot,
    height: rowGeom().dot,
    borderRadius: rowGeom().dot / 2,
    borderWidth: 2,
  },
  body: { flex: 1, minWidth: 0, gap: rowGeom().bodyGap },
  line: { flexDirection: 'row', alignItems: 'center', gap: ds(6), minHeight: rowGeom().lineMin },
  // listText(): 16 / 14 / 12 at 紧凑·标准·宽松; 14 / 12 / 10 at 更紧凑 (time + group = the rail label).
  name: { flexShrink: 1, ...listText('name'), fontWeight: weight.medium },
  pin: { marginLeft: -2 },
  time: { marginLeft: 'auto', ...listText('meta'), paddingLeft: spacing.sm },
  label: { ...listText('meta'), fontWeight: weight.medium },
  preview: { flex: 1, minWidth: 0, ...listText('preview') },
  // 更紧凑: the hairline overlaps the row above (negative margin) so the row pitch is exactly the
  // row height — the rail's item pitch is set to the same number (list-rail-align.ts).
  separator: { height: StyleSheet.hairlineWidth, marginLeft: rowGeom().padX + rowGeom().avatar + rowGeom().gap, ...(rowGeom().separatorOverlap ? { marginTop: -StyleSheet.hairlineWidth } : null) },
} as const);
let rowStyles = makeRowStyles();
onThemeChange(() => { rowStyles = makeRowStyles(); });
