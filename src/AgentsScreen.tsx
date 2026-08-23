// 节点列表页 —— 从 App.tsx 抽出(纯搬移;分组/排序/过滤逻辑另见 agents-list.ts)。
//
// 抽出的动机:App.tsx 已 673 行且是多人同时要改的文件(Tasks tab 等),
// 把这 220 行独立出来后,列表页的改动不再和导航结构互相踩。
// 🔴 样式必须从 ./app-styles 引入,不能在本文件复制一份 —— 那是 let 变量,
// 主题切换时整体重新赋值,复制的那份不会跟着变(见 app-styles.ts 头注释)。

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AliasAvatar from './AliasAvatar';
import { agentStatusLabel, isAgentOnline } from './chat-actions';
import { fetchStatus, takeStatusPrefetch, type HubConfig, type Session } from './api';
import { loadSessionsCache, saveSessionsCache } from './storage';
import { colors, spacing, statusColor, themeMode } from './theme';
import { usePoll } from './usePoll';
import { styles } from './app-styles';
import { buildSections, countShown } from './agents-list';
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
}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<{ alias: string; x: number; y: number } | null>(null);
  const [hoveredAlias, setHoveredAlias] = useState<string | null>(null);

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
    try {
      // First load consumes the boot prefetch if it's still in-flight/fresh;
      // polls and later loads fall through to a normal fetch.
      const data = await (takeStatusPrefetch(cfg) ?? fetchStatus(cfg));
      const next = data.sessions ?? [];
      setSessions(next);
      setFailed(false);
      // Persist for the next cold start's stale-while-revalidate paint.
      saveSessionsCache(next);
    } catch {
      /* keep last good list; with nothing loaded yet, surface the failure */
      setFailed(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cfg]);

  // Perf (load time): paint the last-known agents from the disk cache
  // immediately so cold start shows content instead of a blank spinner; the
  // live fetch below refreshes within the same tick. Only fills in if the
  // fetch hasn't already populated the list (prev.length guard), so fresh
  // data always wins the race.
  useEffect(() => {
    let live = true;
    loadSessionsCache().then(cached => {
      if (live && cached && cached.length) {
        setSessions(prev => (prev.length ? prev : cached));
        setLoading(false);
      }
    });
    return () => { live = false; };
  }, []);

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
    }),
    [sessions, query, pinnedAliases],
  );
  const shownCount = countShown(sections);

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

  return (
    <View style={{ flex: 1, backgroundColor: compact && themeMode() === 'light' ? '#fafafb' : colors.bg }}>
      <View style={{ paddingHorizontal: compact ? spacing.sm : spacing.lg, paddingTop: compact ? spacing.sm : spacing.lg, backgroundColor: compact && themeMode() === 'light' ? '#fafafb' : colors.bg }}>
        <View style={styles.listHeaderRow}>
          <Text style={styles.listHeader}>
            {q ? `${shownCount} / ${sessions.length} agents` : `${sessions.length} agents`}
          </Text>
          <Pressable onPress={onOpenPicker} hitSlop={10} accessibilityLabel="新建节点" style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.6 }]}>
            <Ionicons name="add" size={24} color={colors.accent} />
          </Pressable>
        </View>
        {sessions.length > 10 ? (
          <TextInput style={[styles.search, compact && themeMode() === 'light' && { backgroundColor: '#f0f1f3', borderWidth: 0, borderRadius: 8 }]} placeholder="搜索 agent…" placeholderTextColor={colors.textMuted} autoCapitalize="none" autoCorrect={false} value={query} onChangeText={setQuery} />
        ) : null}
      </View>
      <SectionList
      sections={sections}
      keyExtractor={s => s.alias}
      stickySectionHeadersEnabled={false}
      renderSectionHeader={({ section }) => (
        <View style={[styles.sectionHeaderRow, compact && themeMode() === 'light' && { backgroundColor: '#fafafb' }]}>
          <Text style={styles.sectionHeader}>{section.title}</Text>
          <Text style={styles.sectionCount}>
            {section.online}/{section.total} 在线
          </Text>
        </View>
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
      contentContainerStyle={{ paddingHorizontal: compact ? spacing.sm : spacing.lg, paddingBottom: compact ? spacing.sm : spacing.lg }}
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
      renderItem={({ item }) => {
        return (
        <Pressable
          {...(compact ? ({ dataSet: { agentAlias: item.alias } } as any) : {})}
          onHoverIn={compact ? () => setHoveredAlias(item.alias) : undefined}
          onHoverOut={compact ? () => setHoveredAlias(current => current === item.alias ? null : current) : undefined}
          style={({ pressed }) => [
            styles.card,
            compact && ({ userSelect: 'none', cursor: 'default' } as any),
            compact && {
              borderWidth: 0,
              borderBottomWidth: 0,
              borderRadius: 9,
              paddingHorizontal: spacing.md,
              paddingVertical: 10,
              marginBottom: 2,
              backgroundColor: themeMode() === 'light' ? 'transparent' : colors.card,
            },
            selectedAlias === item.alias && { backgroundColor: themeMode() === 'light' ? '#e7e9ec' : colors.inputBg },
            compact && hoveredAlias === item.alias && ({
              backgroundColor: themeMode() === 'light' ? '#f1f3f5' : colors.inputBg,
              boxShadow: themeMode() === 'light'
                ? '0 4px 14px rgba(31, 41, 55, 0.12)'
                : '0 4px 16px rgba(0, 0, 0, 0.38)',
              zIndex: 2,
            } as any),
            item.status === 'offline' && styles.cardOffline,
            pressed && { opacity: 0.7 },
          ]}
          onPress={() => onOpenChat(item.alias)}
          onLongPress={compact ? undefined : () => onOpenNodeDetail(item.alias)}
          delayLongPress={400}
        >
          <View style={[
            styles.avatarWrap,
            compact && hoveredAlias === item.alias && ({
              borderRadius: 18,
              boxShadow: themeMode() === 'light'
                ? '0 3px 10px rgba(7, 153, 168, 0.24)'
                : '0 3px 12px rgba(34, 211, 238, 0.25)',
            } as any),
          ]}>
            <AliasAvatar alias={item.alias} size={34} />
            {/* 更像微信·round-5: 头像右下在线态圆点(带描边环·offline 灰暗) */}
            <View
              style={[
                styles.statusDot,
                { backgroundColor: statusColor(item.status ?? '', true) },
                !isAgentOnline(item.status) && styles.statusDotOffline,
              ]}
            />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text selectable={false} style={[styles.alias, compact && { fontSize: 13, fontWeight: '600' }]} numberOfLines={1}>
              {pinnedAliases.includes(item.alias) ? '📌 ' : ''}
              {item.alias}
            </Text>
            {item.task ? (
              <Text selectable={false} style={[styles.task, compact && { fontSize: 11 }]} numberOfLines={1}>
                {item.task}
              </Text>
            ) : null}
          </View>
          {!compact ? <Text style={[styles.status, { color: statusColor(item.status ?? '', true) }]}>{agentStatusLabel(item.status)}</Text> : null}
        </Pressable>
        );
      }}
      />
      {contextMenu ? (<>
        <Pressable accessibilityLabel="关闭会话菜单" onPress={() => setContextMenu(null)} style={{ position: 'fixed' as any, inset: 0, zIndex: 999 } as any} />
        <View style={{ position: 'fixed' as any, left: contextMenu.x, top: contextMenu.y, zIndex: 1000, minWidth: 178, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, boxShadow: '0 8px 28px rgba(0,0,0,0.24)' as any }}>
          <Pressable accessibilityLabel={pinnedAliases.includes(contextMenu.alias) ? '取消置顶会话' : '置顶会话'} style={{ paddingHorizontal: 14, paddingVertical: 11 }} onPress={() => { onTogglePin?.(contextMenu.alias); setContextMenu(null); }}>
            <Text style={{ color: colors.text, fontSize: 13 }}>{pinnedAliases.includes(contextMenu.alias) ? '取消置顶会话' : '置顶会话'}</Text>
          </Pressable>
          <Pressable accessibilityLabel="在新窗口打开" style={{ paddingHorizontal: 14, paddingVertical: 11 }} onPress={() => { onOpenChatWindow?.(contextMenu.alias); setContextMenu(null); }}>
            <Text style={{ color: colors.text, fontSize: 13 }}>在新窗口打开</Text>
          </Pressable>
        </View>
      </>) : null}
    </View>
  );
}
