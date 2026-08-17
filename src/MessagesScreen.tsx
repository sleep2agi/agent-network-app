import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { fetchMessages, HubConfig, HubMessage } from './api';
import { connectivityState } from './connectivity';
import { messagesViewState } from './messages-view-state';
import { colors, onThemeChange, spacing } from './theme';
import { formatTime } from './time';
import { usePoll } from './usePoll';
import { Pressable } from 'react-native';

// Network-wide message feed. Same lazy-window discipline as the chat
// screen (and dashboard M5): open with the newest PAGE, grow the limit
// when the user reaches the visual top of the inverted list.

const PAGE = 30;

const TYPE_COLOR: Record<string, string> = {
  task: colors.running,
  reply: colors.accent,
  broadcast: '#a78bfa',
};

export default function MessagesScreen({ cfg }: { cfg: HubConfig }) {
  const [messages, setMessages] = useState<HubMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [hasOlder, setHasOlder] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const limitRef = useRef(PAGE);

  // PR2(通信龙 App战线①):记录**本页自己那次 fetch 的结局**——三态空态的判定源。
  // 之前 catch 静默吞掉+setLoaded(true) → 断网首开 = 空白列表,什么都不声称也什么
  // 都不承认;更糟的变体是合成一种空态,把「连不上」说成「暂无消息」。
  const [lastLoadFailed, setLastLoadFailed] = useState(false);
  const load = useCallback(
    async (limit: number) => {
      try {
        const data = await fetchMessages(cfg, limit);
        const fetched = data.messages ?? [];
        if (fetched.length < limit) setHasOlder(false);
        setMessages(fetched);
        setLastLoadFailed(false);
      } catch {
        setLastLoadFailed(true); // poll 会重试;有旧数据时列表照常显示,陈旧性归全局横幅
      } finally {
        setLoaded(true);
      }
    },
    [cfg],
  );

  // Reset the lazy window when the config changes; usePoll does the initial
  // fetch + polling (it fires fn() right after this effect, so limit is PAGE).
  useEffect(() => {
    limitRef.current = PAGE;
    setLoaded(false);
    setHasOlder(true);
  }, [load]);

  // Foreground-only polling: 10s while visible, paused in background, instant
  // refresh on resume (shared hook). Reads the live window via limitRef.
  usePoll(() => load(limitRef.current), 10000, [load]);

  const loadOlder = async () => {
    if (loadingOlder || !hasOlder || !loaded) return;
    setLoadingOlder(true);
    limitRef.current += PAGE;
    await load(limitRef.current);
    setLoadingOlder(false);
  };

  // 🔴 三态分开渲染(loading / 真空 / 失败),不合成一种——合成=对用户说谎。
  const view = messagesViewState(loaded, messages.length, lastLoadFailed);

  if (view === 'loading') {
    return (
      <View style={styles.center} testID="messages-loading">
        <ActivityIndicator color={colors.accent} />
        <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: spacing.md }}>正在加载消息…</Text>
      </View>
    );
  }

  if (view === 'failed') {
    // 失败文案里的时刻复用全局 connectivity 的 lastSuccessAt(一处时间真相源,不再造)。
    const t = connectivityState().lastSuccessAt;
    const since = t
      ? `上次成功连接 ${String(new Date(t).getHours()).padStart(2, '0')}:${String(new Date(t).getMinutes()).padStart(2, '0')}`
      : '本次启动尚未连接成功';
    return (
      <View style={styles.center} testID="messages-failed">
        <Text style={{ fontSize: 30, marginBottom: spacing.sm }}>📡</Text>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>消息加载失败</Text>
        <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: spacing.xs }}>
          无法连接服务器（{since}）
        </Text>
        <Pressable
          testID="messages-retry"
          onPress={() => { setLoaded(false); void load(limitRef.current); }}
          style={{ marginTop: spacing.lg, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm, borderRadius: 8, backgroundColor: colors.accent }}
        >
          <Text style={{ color: colors.bg, fontSize: 14, fontWeight: '600' }}>重试</Text>
        </Pressable>
      </View>
    );
  }

  if (view === 'empty') {
    return (
      <View style={styles.center} testID="messages-empty">
        <Text style={{ fontSize: 30, marginBottom: spacing.sm }}>💬</Text>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>暂无消息</Text>
        <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: spacing.xs }}>
          网络内的任务与回复会出现在这里
        </Text>
      </View>
    );
  }

  return (
    // `inverted` flips the list geometry: index 0 (newest) renders at the
    // visual bottom, so the feed opens already scrolled to the latest
    // message. The flip also means `onEndReached` fires at the visual TOP
    // (the list's geometric end) — which is exactly where we want to pull
    // OLDER history, hence onEndReached → loadOlder, not a "load newer".
    <FlatList
      inverted
      data={messages}
      keyExtractor={m => m.id}
      contentContainerStyle={{ padding: spacing.lg }}
      onEndReached={loadOlder}
      onEndReachedThreshold={0.2}
      ListFooterComponent={
        loadingOlder ? (
          <ActivityIndicator color={colors.textMuted} style={{ marginVertical: spacing.md }} />
        ) : !hasOlder && messages.length > 0 ? (
          <Text style={styles.beginning}>— beginning of history —</Text>
        ) : null
      }
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View
              style={[styles.typeDot, { backgroundColor: TYPE_COLOR[item.type ?? ''] ?? colors.rest }]}
            />
            <Text style={styles.route} numberOfLines={1}>
              {item.from_alias ?? '?'} → {item.to_alias ?? '?'}
            </Text>
            {item.priority === 'high' ? <Text style={styles.high}>HIGH</Text> : null}
            <Text style={styles.time}>{formatTime(item.created_at)}</Text>
          </View>
          <Text style={styles.content} numberOfLines={4}>
            {item.content || '—'}
          </Text>
        </View>
      )}
    />
  );
}

const makeStyles = () =>
  StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  beginning: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginVertical: spacing.md,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  typeDot: { width: 6, height: 6, borderRadius: 3 },
  route: { color: colors.textSecondary, fontSize: 12, fontWeight: '600', flex: 1 },
  high: { color: colors.failed, fontSize: 10, fontWeight: '700' },
  time: { color: colors.textMuted, fontSize: 10 },
  content: { color: colors.text, fontSize: 13, lineHeight: 19 },
});

let styles = makeStyles();
onThemeChange(() => {
  styles = makeStyles();
});
