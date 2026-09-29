// 服务器 → 事件与日志 (desktop right pane) / the Server tab's "查看事件流" leaf (phone).
// Network-wide task flow, newest first: recent tasks preloaded from the hub, live SSE events on top.
//
// 🔴 UI TRUTH (通信龙 07-31 catch): this screen surfaces ROUTING METADATA ONLY
// (task_id / from / to / status / priority). It does NOT show message content. The subtitle SAYS
// that — a screen labeled just "日志" would let users think they can read the actual message
// bodies, then realize they can't and file a "broken" bug. The preload reads `/api/tasks` rows,
// which do carry content; event-feed-model.ts copies only the routing fields out of them, so the
// content never reaches this screen's state.
//
// 0.2.124 (owner screenshot, 1200×800): the pane showed a phone 「‹ Server」 back row, 「1 / 500」,
// and one raw `connected` chip — the SSE's own hello frame, because the stream only carries what
// happens after it opens. Now: no back on desktop (pane-header.ts), recent history on open, each
// row reads 「发起 → 接收 · 状态 · 相对时间」, and transport frames fold into the status line.
//
// Style discipline:
//   - Shared shell (root / center) via `import { styles } from './app-styles'` — do NOT
//     destructure or copy (live-binding contract, see app-styles.ts header).
//   - Screen-specific chrome inline so theme colors are read at render time on remount
//     (App wraps in `key={theme}`). Same pattern as NodeDetailScreen.

import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, View, ActivityIndicator } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import { fetchTasks, type HubConfig } from './api';
import { LOGS_MAX, type ConnState } from './logs-buffer';
import { openNetworkEventStream } from './logs-sse';
import {
  FEED_EMPTY_TITLE,
  clickTarget,
  feedRowModel,
  historyFromTasks,
  liveFrameToFeedEvent,
  mergeHistory,
  streamStatusLine,
  type FeedEvent,
  type FeedTone,
} from './event-feed-model';
import { PANE_BACK_TEST_ID, paneShowsBack } from './pane-header';
import { colors, spacing, radius } from './theme';
import { styles as appStyles } from './app-styles';

/** How many recent tasks the screen preloads (hub caps /api/tasks at 200). */
const HISTORY_LIMIT = 50;

const CONN_LABEL: Record<ConnState, string> = {
  connecting: '连接中',
  connected: '已连接',
  disconnected: '断开',
};

const toneColor = (tone: FeedTone): string => ({
  running: colors.running,
  blocked: colors.blocked,
  failed: colors.failed,
  accent: colors.accent,
  rest: colors.textSecondary,
})[tone];

export default function LogsScreen({
  cfg,
  onBack,
  onOpenChat,
  onOpenTask,
  desktop = false,
}: {
  cfg: HubConfig;
  onBack: () => void;
  onOpenChat?: (alias: string) => void;
  onOpenTask?: (taskId: string) => void;
  /** Tauri desktop workspace: the server sidebar selects this page — no phone back (pane-header.ts). */
  desktop?: boolean;
}) {
  const [history, setHistory] = useState<FeedEvent[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [live, setLive] = useState<FeedEvent[]>([]);
  const [conn, setConn] = useState<ConnState>('connecting');
  const [connErr, setConnErr] = useState<string | undefined>();
  const [now, setNow] = useState(() => Date.now());
  const seqRef = useRef(0);

  const netId = cfg.networkId;

  // Recent history: the same network-scoped /api/tasks read the 任务 page makes.
  useEffect(() => {
    let alive = true;
    setHistory(null);
    setHistoryError(null);
    fetchTasks(cfg, { limit: HISTORY_LIMIT, skipStats: true })
      .then(body => { if (alive) setHistory(historyFromTasks(body.tasks)); })
      .catch(error => {
        if (!alive) return;
        setHistory([]);
        setHistoryError(error instanceof Error ? error.message : String(error));
      });
    return () => { alive = false; };
  }, [cfg]);

  useEffect(() => {
    if (!netId) {
      // 没有 network_id 就没法订阅 —— 明说，不静默空转
      setConn('disconnected');
      setConnErr('当前 hub 配置无 network_id — 无法订阅网络事件流');
      return;
    }
    setLive([]);
    setConn('connecting');
    setConnErr(undefined);

    const close = openNetworkEventStream(cfg, netId, {
      onEvent: (frame) => {
        const at = typeof frame._at === 'number' ? frame._at : Date.now();
        const ev = liveFrameToFeedEvent(frame, at, ++seqRef.current);
        if (!ev) return; // transport frame (`connected` …) — the status line says it instead
        setLive(prev => (prev.length >= LOGS_MAX ? [...prev.slice(prev.length - LOGS_MAX + 1), ev] : [...prev, ev]));
      },
      onState: (s, err) => {
        setConn(s);
        setConnErr(err);
      },
    });
    return close;
  }, [cfg, netId]);

  // Relative times ("3 分钟前") age while the screen is open.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Newest first, like the dashboard's feeds: the first thing on screen is what just happened, and a
  // new event never has to scroll the list (the old bottom-follow logic raced the preload's layout
  // and left the list parked mid-way with 「已暂停自动滚」 showing).
  const events = useMemo(() => mergeHistory(history ?? [], live, LOGS_MAX).reverse(), [history, live]);

  const openEvent = (ev: FeedEvent) => {
    const target = clickTarget(ev, cfg.username);
    if (target?.kind === 'chat' && onOpenChat) onOpenChat(target.alias);
    else if (target?.kind === 'task' && onOpenTask) onOpenTask(target.taskId);
  };

  const connColor = conn === 'connected' ? colors.running : conn === 'connecting' ? colors.blocked : colors.failed;
  const showBack = paneShowsBack(desktop);
  const statusLine = streamStatusLine({ conn, historyCount: history?.length ?? 0, liveCount: live.length, historyError });
  const loading = history === null && events.length === 0;
  const hardFailure = events.length === 0 && history !== null && !!historyError && conn === 'disconnected';

  return (
    <View style={appStyles.root}>
      <View
        testID="screen-header"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 57,
          paddingLeft: showBack ? spacing.md : spacing.lg,
          paddingRight: spacing.lg,
          paddingVertical: spacing.sm,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          gap: spacing.sm,
        }}
      >
        {showBack ? (
          <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="返回服务器" testID={PANE_BACK_TEST_ID}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
        ) : null}
        <Text testID="logs-title" style={{ flex: 1, color: colors.text, fontSize: 17, fontWeight: '600' }} numberOfLines={1}>事件流</Text>
        {/* Connection state pill — 3 states, distinct visually */}
        <View
          testID={`logs-conn-${conn}`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: spacing.sm,
            paddingVertical: 4,
            borderRadius: radius.pill,
            backgroundColor: connColor + '22',
            borderColor: connColor,
            borderWidth: 1,
          }}
        >
          <View style={{ width: 6, height: 6, borderRadius: radius.pill, backgroundColor: connColor }} />
          <Text style={{ color: connColor, fontSize: 11, fontWeight: '600' }}>{CONN_LABEL[conn]}</Text>
        </View>
      </View>

      {/* Subtitle — the "UI truth" line — and the stream's own status (was a `connected` row). */}
      <View testID="logs-intro" style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, gap: 4 }}>
        <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 17 }}>
          显示网络任务流转（发起 → 接收 / 状态 / task_id），
          <Text style={{ fontWeight: '600' }}>不含消息内容</Text> — 看内容请到对应会话
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Text testID="logs-status-line" style={{ flex: 1, color: colors.textMuted, fontSize: 11 }} numberOfLines={1}>{statusLine}</Text>
        </View>
      </View>

      {loading ? (
        <View style={appStyles.center} testID="logs-connecting">
          <ActivityIndicator color={colors.accent} />
          <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: spacing.sm }}>正在加载最近的任务…</Text>
        </View>
      ) : hardFailure ? (
        <View style={appStyles.center} testID="logs-disconnected">
          <Text style={{ color: colors.failed, fontSize: 15, fontWeight: '600' }}>连接失败</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 12, textAlign: 'center', marginTop: spacing.sm, paddingHorizontal: spacing.xl }}>
            {connErr || historyError || '未知错误'}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: spacing.md }}>正在自动重连…</Text>
        </View>
      ) : events.length === 0 ? (
        <View style={appStyles.center} testID="logs-empty">
          <Ionicons name="pulse-outline" size={36} color={colors.textMuted} />
          <Text style={{ color: colors.textSecondary, fontSize: 14, fontWeight: '600', marginTop: spacing.sm }}>{FEED_EMPTY_TITLE}</Text>
          <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: spacing.xs }}>有新的任务派发或回复时会实时出现在这里</Text>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {conn === 'disconnected' ? (
            <View
              testID="logs-disconnected-banner"
              style={{
                backgroundColor: colors.failed + '22',
                borderRadius: radius.control,
                marginHorizontal: spacing.lg,
                marginBottom: spacing.sm,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
              }}
            >
              <Text style={{ color: colors.failed, fontSize: 12, fontWeight: '600' }}>
                实时流已断开，正在重连… {connErr ? `(${connErr})` : ''}
              </Text>
            </View>
          ) : null}
          <FlatList
            data={events}
            keyExtractor={item => item.key}
            contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.sm }}
            testID="logs-list"
            renderItem={({ item }) => (
              <EventRow ev={item} now={now} onPress={clickTarget(item, cfg.username) ? () => openEvent(item) : undefined} />
            )}
          />
        </View>
      )}
    </View>
  );
}

function EventRow({ ev, now, onPress }: { ev: FeedEvent; now: number; onPress?: () => void }) {
  const m = feedRowModel(ev, now);
  const chipColor = toneColor(m.chip.tone);
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={m.a11y}
      testID="logs-row"
      style={state => {
        const hovered = (state as { hovered?: boolean }).hovered;
        return {
          backgroundColor: onPress && (hovered || state.pressed) ? colors.rowHover : colors.card,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: radius.control,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          gap: 4,
        };
      }}
    >
      {/* 发起 → 接收 · 状态 · 时间. Names shrink (truncate) first; the arrow, chip and time never
          shrink or wrap, so a phone-width row stays one line. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
        <AliasAvatar alias={m.from} size={18} />
        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600', flexShrink: 1, minWidth: 0 }} numberOfLines={1}>{m.from}</Text>
        <Text style={{ color: colors.textMuted, fontSize: 12, flexShrink: 0 }}>→</Text>
        <AliasAvatar alias={m.to} size={18} />
        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600', flexShrink: 1, minWidth: 0 }} numberOfLines={1}>{m.to}</Text>
        <View
          testID="logs-row-status"
          style={{ flexShrink: 0, marginLeft: spacing.xs, paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill, backgroundColor: chipColor + '22' }}
        >
          <Text style={{ color: chipColor, fontSize: 11, fontWeight: '600' }} numberOfLines={1}>{m.chip.label}</Text>
        </View>
        <View style={{ flex: 1, minWidth: spacing.xs }} />
        <Text style={{ color: colors.textMuted, fontSize: 11, flexShrink: 0 }} numberOfLines={1}>{m.time}</Text>
      </View>
      {m.taskId || m.high ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          {m.high ? <Text style={{ color: colors.failed, fontSize: 10, fontWeight: '600', flexShrink: 0 }}>高优先</Text> : null}
          {m.taskId ? (
            <Text selectable style={{ flexShrink: 1, color: colors.textMuted, fontFamily: 'monospace', fontSize: 10, lineHeight: 14 }} numberOfLines={1}>
              {m.taskId}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}
