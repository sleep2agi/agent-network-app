// Full-screen leaf reached from the Server tab's "查看事件流" button.
// Row 6 parity — network-wide event stream via SSE.
//
// 🔴 UI TRUTH (通信龙 07-31 catch): this screen surfaces the
// `/events/network/{netId}` payload, which is ROUTING METADATA ONLY
// (task_id / from / to / status / priority / message_id). It does
// NOT contain message content. The subtitle SAYS that — a screen
// labeled just "日志" would let users think they can read the actual
// message bodies, then realize they can't and file a "broken" bug.
// The interface must promise what it actually delivers. Same rule
// applied on /messages (empty vs not-wired must look different).
//
// Style discipline:
//   - Shared shell (root / center / errorTitle / errorHint / retryBtn)
//     via `import { styles } from './app-styles'` — do NOT destructure
//     or copy (live-binding contract, see app-styles.ts header).
//   - Screen-specific chrome (event rows, chips, sticky bottom pill)
//     via inline `style={{ ... colors.xyz ... }}` so theme colors are
//     read at render time on remount (App wraps in `key={theme}`).
// Same pattern as NodeDetailScreen.

import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, Text, View, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AliasAvatar from './AliasAvatar';
import { HubConfig } from './api';
import {
  pushLog,
  deriveLogsState,
  typeBucket,
  shouldPauseAutoscroll,
  formatEventTime,
  LOGS_MAX,
  AUTOSCROLL_PAUSE_THRESHOLD_PX,
  type LogEvent,
  type ConnState,
  type TypeBucket,
} from './logs-buffer';
import { openNetworkEventStream } from './logs-sse';
import { colors, spacing } from './theme';
import { styles as appStyles } from './app-styles';

const CONN_LABEL: Record<ConnState, string> = {
  connecting: '连接中',
  connected: '已连接',
  disconnected: '断开',
};

const CONN_COLOR: Record<ConnState, string> = {
  connecting: colors.blocked,     // amber = transient
  connected: colors.running,      // green = live
  disconnected: colors.failed,    // red = down
};

const BUCKET_COLOR: Record<TypeBucket, string> = {
  task: colors.accent,
  broadcast: colors.blocked,     // amber = attention
  lifecycle: colors.textSecondary,
  unknown: colors.rest,          // 🔴 gray so a new hub type is VISIBLE
                                 // rather than remapped into a known bucket
};

export default function LogsScreen({
  cfg,
  onBack,
}: {
  cfg: HubConfig;
  onBack: () => void;
}) {
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [conn, setConn] = useState<ConnState>('connecting');
  const [connErr, setConnErr] = useState<string | undefined>();
  const [droppedTotal, setDroppedTotal] = useState(0);
  const [paused, setPaused] = useState(false);
  const distanceFromBottomRef = useRef(0);
  const listRef = useRef<FlatList<LogEvent> | null>(null);

  const netId = cfg.networkId;

  useEffect(() => {
    if (!netId) {
      // 没有 network_id 就没法订阅 —— 明说，不静默空转
      setConn('disconnected');
      setConnErr('当前 hub 配置无 network_id — 无法订阅网络事件流');
      return;
    }
    setEvents([]);
    setDroppedTotal(0);
    setConn('connecting');
    setConnErr(undefined);

    const close = openNetworkEventStream(cfg, netId, {
      onEvent: (ev) => {
        setEvents((prev) => {
          const { entries, dropped } = pushLog(prev, ev, LOGS_MAX);
          if (dropped > 0) setDroppedTotal((n) => n + dropped);
          return entries;
        });
      },
      onState: (s, err) => {
        setConn(s);
        setConnErr(err);
      },
    });
    return close;
  }, [cfg, netId]);

  // Auto-scroll to bottom on new events UNLESS the user has scrolled
  // up past the pause threshold — otherwise their reading row gets
  // yanked away every time a new event arrives.
  useEffect(() => {
    if (paused) return;
    if (events.length === 0) return;
    // requestAnimationFrame gives the list a beat to insert the row
    // before we scroll.
    const id = requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: false });
    });
    return () => cancelAnimationFrame(id);
  }, [events.length, paused]);

  const onScroll = useCallback((e: { nativeEvent: { contentSize: { height: number }; layoutMeasurement: { height: number }; contentOffset: { y: number } } }) => {
    const { contentSize, layoutMeasurement, contentOffset } = e.nativeEvent;
    const distance = contentSize.height - layoutMeasurement.height - contentOffset.y;
    distanceFromBottomRef.current = distance;
    const nextPaused = shouldPauseAutoscroll(distance);
    // Only setState when the boolean actually flips — avoids a re-render
    // per scroll event.
    setPaused((prev) => (prev === nextPaused ? prev : nextPaused));
  }, []);

  const jumpToBottom = () => {
    listRef.current?.scrollToEnd({ animated: true });
    setPaused(false);
  };

  const state = deriveLogsState({ conn, events, error: connErr });

  return (
    <View style={appStyles.root}>
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          gap: spacing.sm,
        }}
      >
        <Pressable
          onPress={onBack}
          style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs }}
          testID="logs-back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
          <Text style={{ color: colors.text, fontSize: 15 }}>Server</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        {/* Connection state pill — 3 states, distinct visually */}
        <View
          testID={`logs-conn-${conn}`}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: spacing.sm,
            paddingVertical: 4,
            borderRadius: 999,
            backgroundColor: CONN_COLOR[conn] + '22',
            borderColor: CONN_COLOR[conn],
            borderWidth: 1,
          }}
        >
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: CONN_COLOR[conn] }} />
          <Text style={{ color: CONN_COLOR[conn], fontSize: 11, fontWeight: '700' }}>
            {CONN_LABEL[conn]}
          </Text>
        </View>
      </View>

      {/* Title + subtitle — the "UI truth" line */}
      <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm }}>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>事件流</Text>
        <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2, lineHeight: 17 }}>
          显示网络任务流转（task_id / 发起 → 接收 / 状态 / 优先级），
          <Text style={{ fontWeight: '700' }}>不含消息内容</Text> — 看内容请到对应会话
        </Text>
      </View>

      {/* Counter */}
      {state.kind === 'ready' ? (
        <View
          testID="logs-count"
          style={{
            paddingHorizontal: spacing.lg,
            paddingBottom: spacing.sm,
            flexDirection: 'row',
            justifyContent: 'space-between',
          }}
        >
          <Text style={{ color: colors.textMuted, fontSize: 11 }}>
            {events.length} / {LOGS_MAX}
            {droppedTotal > 0 ? `（已丢弃 ${droppedTotal}）` : ''}
          </Text>
          {paused ? (
            <Text style={{ color: colors.accent, fontSize: 11 }}>已暂停自动滚</Text>
          ) : null}
        </View>
      ) : null}

      {/* Body */}
      {state.kind === 'connecting' ? (
        <View style={appStyles.center} testID="logs-connecting">
          <ActivityIndicator color={colors.accent} />
          <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: spacing.sm }}>
            正在连接事件流…
          </Text>
        </View>
      ) : state.kind === 'disconnected' && events.length === 0 ? (
        <View style={appStyles.center} testID="logs-disconnected">
          <Text style={{ color: colors.failed, fontSize: 15, fontWeight: '700' }}>连接失败</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 12, textAlign: 'center', marginTop: spacing.sm, paddingHorizontal: spacing.xl }}>
            {connErr || '未知错误'}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: spacing.md }}>
            正在自动重连…
          </Text>
        </View>
      ) : state.kind === 'empty-connected' ? (
        <View style={appStyles.center} testID="logs-empty-connected">
          <Text style={{ color: colors.textSecondary, fontSize: 14, fontWeight: '600' }}>
            连接已建立，暂无事件
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: spacing.sm }}>
            这个网络当前很安静 — 事件到达后会自动追加到底部
          </Text>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <FlatList
            ref={listRef}
            data={events}
            keyExtractor={(_, i) => `ev-${i}`}
            contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
            onScroll={onScroll}
            scrollEventThrottle={16}
            testID="logs-list"
            renderItem={({ item }) => <EventRow ev={item} now={Date.now()} />}
          />
          {paused ? (
            <Pressable
              onPress={jumpToBottom}
              testID="logs-jump-bottom"
              style={{
                position: 'absolute',
                bottom: spacing.xl,
                alignSelf: 'center',
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.sm,
                borderRadius: 999,
                backgroundColor: colors.accent,
              }}
            >
              <Text style={{ color: colors.bg, fontSize: 13, fontWeight: '700' }}>
                ↓ 跳到底
              </Text>
            </Pressable>
          ) : null}
          {/* Transient disconnected banner (when we DO have prior events —
              keep them visible; overlay the state) */}
          {state.kind === 'disconnected' && events.length > 0 ? (
            <View
              testID="logs-disconnected-banner"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                backgroundColor: colors.failed + '22',
                borderBottomColor: colors.failed,
                borderBottomWidth: 1,
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.sm,
              }}
            >
              <Text style={{ color: colors.failed, fontSize: 12, fontWeight: '600' }}>
                连接已断，正在重连… {connErr ? `(${connErr})` : ''}
              </Text>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

function EventRow({ ev, now }: { ev: LogEvent; now: number }) {
  const rawType = typeof ev.type === 'string' ? ev.type : '(unknown)';
  const bucket = typeBucket(ev.type);
  const bucketColor = BUCKET_COLOR[bucket];
  const from = typeof ev.from === 'string' ? ev.from : '';
  const to = typeof ev.to === 'string' ? ev.to : '';
  const taskId = typeof ev.task_id === 'string' ? ev.task_id : '';
  const priority = typeof ev.priority === 'string' ? ev.priority : '';
  const status = typeof ev.status === 'string' ? ev.status : '';
  const at = typeof ev._at === 'number' ? ev._at : now;
  const time = formatEventTime(at, now);

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: 10,
        padding: spacing.md,
        gap: spacing.xs,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        {/* Type chip — colored by bucket; unknown types keep their raw
            text so a new hub type doesn't get silently remapped */}
        <View
          testID={`logs-row-type-${bucket}`}
          style={{
            paddingHorizontal: spacing.sm,
            paddingVertical: 2,
            borderRadius: 6,
            backgroundColor: bucketColor + '22',
            borderColor: bucketColor,
            borderWidth: 1,
          }}
        >
          <Text style={{ color: bucketColor, fontSize: 10, fontWeight: '700' }}>{rawType}</Text>
        </View>
        {status ? (
          <Text style={{ color: colors.textSecondary, fontSize: 11 }}>{status}</Text>
        ) : null}
        {priority === 'high' ? (
          <Text style={{ color: colors.failed, fontSize: 10, fontWeight: '700' }}>HIGH</Text>
        ) : null}
        <View style={{ flex: 1 }} />
        <Text style={{ color: colors.textMuted, fontSize: 10 }}>{time}</Text>
      </View>
      {(from || to) ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          {from ? <AliasAvatar alias={from} size={18} /> : null}
          {from ? <Text style={{ color: colors.text, fontSize: 12 }} numberOfLines={1}>{from}</Text> : null}
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>→</Text>
          {to ? <AliasAvatar alias={to} size={18} /> : null}
          <Text style={{ color: colors.text, fontSize: 12 }} numberOfLines={1}>{to || '(未指定)'}</Text>
        </View>
      ) : null}
      {taskId ? (
        <Text
          selectable
          style={{ color: colors.textMuted, fontFamily: 'monospace', fontSize: 10 }}
          numberOfLines={1}
        >
          {taskId}
        </Text>
      ) : null}
    </View>
  );
}
