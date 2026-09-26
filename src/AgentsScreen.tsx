// 节点列表页 —— 从 App.tsx 抽出(纯搬移;分组/排序/过滤逻辑另见 agents-list.ts)。
//
// 抽出的动机:App.tsx 已 673 行且是多人同时要改的文件(Tasks tab 等),
// 把这 220 行独立出来后,列表页的改动不再和导航结构互相踩。
// 🔴 样式必须从 ./app-styles 引入,不能在本文件复制一份 —— 那是 let 变量,
// 主题切换时整体重新赋值,复制的那份不会跟着变(见 app-styles.ts 头注释)。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AliasAvatar from './AliasAvatar';
import { isAgentOnline } from './chat-actions';
import { fetchStatus, fetchUserMessages, takeStatusPrefetch, type HubConfig, type Session,
  fetchMessages,
  replyUnreadSince,
} from './api';
import { loadSessionsCache, saveSessionsCache } from './storage';
import { colors, radius, spacing, statusColor, type, weight } from './theme';
import { usePoll } from './usePoll';
import { retryUnreadPersistFromPoll } from './conversation-unread-persist';
import AgentUnreadBadge from './AgentUnreadBadge';
import { formatUnreadBadge, type UnreadState } from './unread-ledger';
import { unreadCountForAgentRow } from './unread-badge';
import {
  bindUnreadAppState,
  getUnreadSnapshot,
  ingestInboxMessagesBody,
  ingestUserMessagesBody,
  replyUnreadCounts,
  subscribeUnread,
} from './unread-store';
import { styles } from './app-styles';
import { applyCollapsed, buildSections, countShown, holdWhileActive, toggleCollapsed } from './agents-list';
import { AGENT_ROW_AVATAR, AGENT_ROW_DOT, AGENT_ROW_GAP, AGENT_ROW_HEIGHT, AGENT_ROW_PAD_X, AGENT_ROW_SEPARATOR_INSET, agentRowModel, latestMessageByAgent } from './agent-row-model';
import { loadCollapsedGroups, saveCollapsedGroups } from './agent-list-prefs';
import { agentUnreadCounts, latestMessageAtByAgent } from './agent-unread-counts';
import { pinyinMatch } from './lib/pinyin';

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
}: {
  cfg: HubConfig;
  onOpenChat: (alias: string) => void;
  /** #338 — top-right `+` opens the host_supervisor picker modal. */
  onOpenPicker: () => void;
  /** issue #8 row 4 (V1) — long-press a row opens the per-node detail
   *  screen. `onPress` remains the high-frequency path to chat and is
   *  NOT changed (通信龙 red-line 71ee862d). */
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
}) {
  const [sessions, setSessions] = useState<Session[]>(preview?.sessions ?? []);
  const [loading, setLoading] = useState(!preview);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<{ alias: string; x: number; y: number } | null>(null);
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
  useEffect(() => {
    const doc = (globalThis as any).document;
    if (!compact || !doc?.addEventListener) return;
    const handleContextMenu = (event: any) => {
      const row = event.target?.closest?.('[data-agent-alias]');
      const alias = row?.getAttribute?.('data-agent-alias');
      if (!alias) return;
      event.preventDefault?.();
      event.stopPropagation?.();
      event.stopImmediatePropagation?.();
      const pageX = event.pageX ?? 180;
      const pageY = event.pageY ?? 180;
      setContextMenu({
        alias,
        x: Math.max(8, Math.min(pageX, ((globalThis as any).innerWidth ?? 1000) - 194)),
        y: Math.max(8, Math.min(pageY, ((globalThis as any).innerHeight ?? 700) - 112)),
      });
    };
    doc.addEventListener('contextmenu', handleContextMenu, true);
    return () => doc.removeEventListener('contextmenu', handleContextMenu, true);
  }, [compact]);

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
  const sections = useMemo(
    () => buildSections(sessions, query, {
      match: pinyinMatch,
      sort: { pinned: alias => pinnedAliases.includes(alias) },
      unread: { count: alias => floatInput.counts[alias] ?? 0, lastMessageAt: alias => floatInput.lastAt[alias] ?? 0 },
    }),
    [sessions, query, pinnedAliases, floatInput],
  );
  const shownCount = countShown(sections);
  const shownSections = useMemo(() => applyCollapsed(sections, collapsed, query), [sections, collapsed, query]);
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
  const rowBadge = (alias: string) => formatUnreadBadge(unreadCountForAgentRow(
    preview?.serverBody ?? unreadSnap.serverBody,
    preview?.ledger ?? unreadSnap.ledger,
    alias,
    preview ? undefined : replyUnreadCounts(unreadSnap),
  ));

  // Desktop (Tauri) sidebar row — unchanged by the 0.2.106 phone / two-pane redesign.
  const renderCompactRow = (item: Session) => {
    return (
    <Pressable
      {...(compact ? ({ dataSet: { agentAlias: item.alias } } as any) : {})}
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
      onPress={() => onOpenChat(item.alias)}
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
        <Text selectable={false} style={[styles.alias, compact && { fontSize: 13, fontWeight: '600' }]} numberOfLines={1}>
          {pinnedAliases.includes(item.alias) ? '📌 ' : ''}
          {item.alias}
          {mutedAliases.includes(item.alias) ? ' 🔕' : ''}
        </Text>
        {item.task ? (
          <Text selectable={false} style={[styles.task, compact && { fontSize: 11 }]} numberOfLines={1}>
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
    const model = agentRowModel(item, { latest: latestByAgent[item.alias], pinned, nowMs });
    const selected = selectedAlias === item.alias;
    const rowBg = selected ? colors.rowActive : colors.bg;
    const badge = rowBadge(item.alias);
    return (
      <Pressable
        testID={`agent-row-${item.alias}`}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        style={({ pressed }) => [
          rowStyles.row,
          { backgroundColor: selected ? colors.rowActive : pressed ? colors.rowHover : colors.bg },
        ]}
        onPress={() => onOpenChat(item.alias)}
        onLongPress={() => onOpenNodeDetail(item.alias)}
        delayLongPress={400}
      >
        <View style={rowStyles.avatar}>
          <View style={!model.status.online ? rowStyles.avatarOffline : null}>
            <AliasAvatar alias={item.alias} size={AGENT_ROW_AVATAR} />
          </View>
          <View
            testID={`agent-dot-${item.alias}`}
            style={[rowStyles.dot, { backgroundColor: colors[model.status.dot], borderColor: rowBg }]}
          />
        </View>
        <View style={rowStyles.body}>
          <View style={rowStyles.line}>
            <Text selectable={false} numberOfLines={1} style={[rowStyles.name, { color: model.status.online ? colors.text : colors.textSecondary }]}>
              {item.alias}
            </Text>
            {pinned ? <Ionicons name="pin" size={12} color={colors.textMuted} accessibilityLabel="已置顶" style={rowStyles.pin} /> : null}
            {mutedAliases.includes(item.alias) ? <Ionicons name="notifications-off-outline" size={12} color={colors.textMuted} accessibilityLabel="消息免打扰" style={rowStyles.pin} testID={`agent-muted-${item.alias}`} /> : null}
            <Text selectable={false} numberOfLines={1} style={[rowStyles.time, { color: colors.textMuted }]}>{model.time}</Text>
          </View>
          {/* No second line when there is nothing to say (and no badge): the name then centres. */}
          {model.status.label || model.preview || badge ? <View style={rowStyles.line}>
            {model.status.label && model.status.labelTone ? (
              <Text selectable={false} style={[rowStyles.label, { color: colors[model.status.labelTone] }]}>{model.status.label}</Text>
            ) : null}
            <Text selectable={false} numberOfLines={1} style={[rowStyles.preview, { color: colors.textMuted }]}>{model.preview}</Text>
            <AgentUnreadBadge inline badge={badge} testID={`unread-badge-${item.alias}`} />
          </View> : null}
        </View>
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: compact ? colors.listBg : colors.bg }}>
      {compact ? (
        <View style={{ paddingHorizontal: compact ? spacing.sm : spacing.lg, paddingTop: compact ? spacing.sm : spacing.lg, backgroundColor: compact ? colors.listBg : colors.bg }}>
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
        <View style={[rowStyles.head, { backgroundColor: colors.bg }]}>
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
      <SectionList
      sections={shownSections}
      keyExtractor={s => s.alias}
      onScroll={markListActive}
      scrollEventThrottle={100}
      stickySectionHeadersEnabled={false}
      renderSectionHeader={({ section }) => (
        // Small section label + online/total; tap folds the group (not 新消息, not while searching).
        <Pressable
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
            {q ? `没有匹配「${q}」的 agent` : '还没有 agent'}
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
          ) : null}
        </View>
      }
      renderItem={({ item }) => (compact ? renderCompactRow(item) : renderPhoneRow(item))}
      />
      {contextMenu ? (<>
        <Pressable accessibilityLabel="关闭会话菜单" onPress={() => setContextMenu(null)} style={{ position: 'fixed' as any, inset: 0, zIndex: 999 } as any} />
        <View style={{ position: 'fixed' as any, left: contextMenu.x, top: contextMenu.y, zIndex: 1000, minWidth: 178, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, boxShadow: '0 8px 28px rgba(0,0,0,0.24)' as any }}>
          <Pressable accessibilityLabel={pinnedAliases.includes(contextMenu.alias) ? '取消置顶会话' : '置顶会话'} style={{ paddingHorizontal: 14, paddingVertical: 11 }} onPress={() => { onTogglePin?.(contextMenu.alias); setContextMenu(null); }}>
            <Text style={{ color: colors.text, fontSize: 13 }}>{pinnedAliases.includes(contextMenu.alias) ? '取消置顶会话' : '置顶会话'}</Text>
          </Pressable>
          {onToggleMute ? (
            <Pressable accessibilityLabel={mutedAliases.includes(contextMenu.alias) ? '取消消息免打扰' : '消息免打扰'} style={{ paddingHorizontal: 14, paddingVertical: 11 }} onPress={() => { onToggleMute(contextMenu.alias); setContextMenu(null); }}>
              <Text style={{ color: colors.text, fontSize: 13 }}>{mutedAliases.includes(contextMenu.alias) ? '取消消息免打扰' : '消息免打扰'}</Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityLabel="在新窗口打开" style={{ paddingHorizontal: 14, paddingVertical: 11 }} onPress={() => { onOpenChatWindow?.(contextMenu.alias); setContextMenu(null); }}>
            <Text style={{ color: colors.text, fontSize: 13 }}>在新窗口打开</Text>
          </Pressable>
        </View>
      </>) : null}
    </View>
  );
}

// Phone / two-pane list chrome (0.2.106). A plain object, and no colours here: it is built once at import,
// and a colour captured now would not follow a theme switch (theme-restyle-coverage.test.ts) —
// colours are passed inline from `colors` at render time.
const rowStyles = {
  head: { paddingHorizontal: AGENT_ROW_PAD_X, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 36 },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, borderRadius: radius.md, paddingHorizontal: 10 },
  searchInput: { flex: 1, minWidth: 0, fontSize: type.body, paddingVertical: 0, height: 36 },
  searchCount: { marginTop: spacing.xs },
  group: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: AGENT_ROW_PAD_X, paddingTop: spacing.md, paddingBottom: spacing.xs },
  groupCompact: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  groupTitle: { flexShrink: 1, fontSize: type.small, fontWeight: weight.medium, letterSpacing: 0.4 },
  groupCount: { fontSize: type.caption, marginLeft: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: AGENT_ROW_GAP,
    minHeight: AGENT_ROW_HEIGHT,
    paddingHorizontal: AGENT_ROW_PAD_X,
    paddingVertical: (AGENT_ROW_HEIGHT - AGENT_ROW_AVATAR) / 2,
  },
  avatar: { width: AGENT_ROW_AVATAR, height: AGENT_ROW_AVATAR },
  avatarOffline: { opacity: 0.45 },
  dot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: AGENT_ROW_DOT,
    height: AGENT_ROW_DOT,
    borderRadius: AGENT_ROW_DOT / 2,
    borderWidth: 2,
  },
  body: { flex: 1, minWidth: 0, gap: 3 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 20 },
  name: { flexShrink: 1, fontSize: type.title, fontWeight: weight.medium },
  pin: { marginLeft: -2 },
  time: { marginLeft: 'auto', fontSize: type.small, paddingLeft: spacing.sm },
  label: { fontSize: type.small, fontWeight: weight.medium },
  preview: { flex: 1, minWidth: 0, fontSize: type.body },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: AGENT_ROW_SEPARATOR_INSET },
} as const;
