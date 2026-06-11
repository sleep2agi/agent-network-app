import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { fetchTasks, sendTask, HubConfig, HubTask } from './api';
import { colors, spacing } from './theme';
import { formatTime } from './time';

// Chat with one agent. Mirrors dashboard M4: open with the newest PAGE
// messages, grow the window when the user scrolls toward older history.
// The FlatList is `inverted`, so index 0 renders at the BOTTOM (newest) —
// the native chat pattern; onEndReached then fires at the visual TOP,
// which is exactly the load-older trigger.

const PAGE = 20;

// Local echo: sent messages appear instantly with a pending mark and
// either get replaced by the server copy on the next reload (delivered)
// or flip to a tappable "未送达 · 点击重试" state (#220 roadmap ②).
type ChatItem = HubTask & { _localId?: string; _pending?: boolean; _failed?: boolean };

interface Props {
  cfg: HubConfig;
  alias: string;
  onBack: () => void;
}

export default function ChatScreen({ cfg, alias, onBack }: Props) {
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [hasOlder, setHasOlder] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState('');
  const sending = false; // optimistic echo frees the input immediately
  const limitRef = useRef(PAGE);

  const load = useCallback(
    async (limit: number) => {
      try {
        const data = await fetchTasks(cfg, { to_name: alias, limit });
        const fetched = data.tasks ?? [];
        if (fetched.length < limit) setHasOlder(false);
        // Hub returns newest-first, which matches inverted-list order.
        // Local echoes stay in front; the send path removes them once
        // the server confirms, so no content-matching is needed here.
        setMessages(prev => [...prev.filter(t => t._localId), ...fetched]);
      } catch {
        /* poll retries */
      } finally {
        setLoaded(true);
      }
    },
    [cfg, alias],
  );

  useEffect(() => {
    limitRef.current = PAGE;
    setMessages([]);
    setLoaded(false);
    setHasOlder(true);
    load(PAGE);
    const t = setInterval(() => load(limitRef.current), 5000);
    return () => clearInterval(t);
  }, [load]);

  const loadOlder = async () => {
    if (loadingOlder || !hasOlder || !loaded) return;
    setLoadingOlder(true);
    limitRef.current += PAGE;
    await load(limitRef.current);
    setLoadingOlder(false);
  };

  const localSeq = useRef(0);

  const doSend = async (content: string, localId: string) => {
    try {
      await sendTask(cfg, alias, content);
      // delivered: drop the echo, the server copy arrives with reload
      setMessages(prev => prev.filter(t => t._localId !== localId));
      await load(limitRef.current);
    } catch {
      setMessages(prev =>
        prev.map(t => (t._localId === localId ? { ...t, _pending: false, _failed: true } : t)),
      );
    }
  };

  const submit = () => {
    const content = draft.trim();
    if (!content || sending) return;
    setDraft('');
    const localId = `local-${++localSeq.current}`;
    setMessages(prev => [
      { content, created_at: new Date().toISOString(), _localId: localId, _pending: true },
      ...prev,
    ]);
    doSend(content, localId);
  };

  const retry = (item: ChatItem) => {
    if (!item._localId || !item.content) return;
    setMessages(prev =>
      prev.map(t => (t._localId === item._localId ? { ...t, _pending: true, _failed: false } : t)),
    );
    doSend(item.content, item._localId);
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {alias}
        </Text>
      </View>

      {!loaded ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          inverted
          data={messages}
          keyExtractor={(m, i) => m._localId ?? m.task_id ?? String(i)}
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
            <View style={styles.bubbleWrap}>
              <View style={styles.bubble}>
                <Text style={styles.bubbleText}>{item.content || '—'}</Text>
              </View>
              {item.reply ? (
                <View style={[styles.bubble, styles.replyBubble]}>
                  <Text style={styles.bubbleText}>{item.reply}</Text>
                </View>
              ) : null}
              {item._pending ? (
                <Text style={styles.pendingMark}>发送中…</Text>
              ) : item._failed ? (
                <Pressable onPress={() => retry(item)} hitSlop={8}>
                  <Text style={styles.failedMark}>未送达 · 点击重试</Text>
                </Pressable>
              ) : item.created_at ? (
                <Text style={styles.time}>{formatTime(item.created_at)}</Text>
              ) : null}
            </View>
          )}
        />
      )}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder={`Message ${alias}…`}
          placeholderTextColor={colors.textMuted}
          value={draft}
          onChangeText={setDraft}
          multiline
        />
        <Pressable
          style={({ pressed }) => [styles.send, (pressed || sending) && { opacity: 0.6 }]}
          onPress={submit}
          disabled={sending || !draft.trim()}
        >
          <Text style={styles.sendText}>↑</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  back: { color: colors.accent, fontSize: 28, lineHeight: 30, paddingRight: spacing.sm },
  title: { color: colors.text, fontSize: 16, fontWeight: '600', flex: 1 },
  beginning: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginVertical: spacing.md,
  },
  bubbleWrap: { marginBottom: spacing.md, gap: spacing.xs },
  time: { color: colors.textMuted, fontSize: 10, alignSelf: 'flex-end' },
  bubble: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  replyBubble: { alignSelf: 'flex-start', backgroundColor: colors.inputBg },
  bubbleText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  pendingMark: { color: colors.textMuted, fontSize: 10, alignSelf: 'flex-end' },
  failedMark: { color: colors.failed, fontSize: 11, alignSelf: 'flex-end', fontWeight: '600' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    backgroundColor: colors.inputBg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    color: colors.text,
    fontSize: 14,
    maxHeight: 120,
  },
  send: {
    backgroundColor: colors.accent,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: { color: colors.bg, fontSize: 18, fontWeight: '700' },
});
