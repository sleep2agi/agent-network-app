import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { fetchMessages, HubConfig, HubMessage } from './api';
import { colors, onThemeChange, spacing } from './theme';
import { formatTime } from './time';

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

  const load = useCallback(
    async (limit: number) => {
      try {
        const data = await fetchMessages(cfg, limit);
        const fetched = data.messages ?? [];
        if (fetched.length < limit) setHasOlder(false);
        setMessages(fetched);
      } catch {
        /* poll retries */
      } finally {
        setLoaded(true);
      }
    },
    [cfg],
  );

  useEffect(() => {
    limitRef.current = PAGE;
    setLoaded(false);
    setHasOlder(true);
    load(PAGE);
    const t = setInterval(() => load(limitRef.current), 10000);
    return () => clearInterval(t);
  }, [load]);

  const loadOlder = async () => {
    if (loadingOlder || !hasOlder || !loaded) return;
    setLoadingOlder(true);
    limitRef.current += PAGE;
    await load(limitRef.current);
    setLoadingOlder(false);
  };

  if (!loaded) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
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
