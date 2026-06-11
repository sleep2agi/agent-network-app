import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AliasAvatar from './AliasAvatar';
import { fetchStatus, fetchTasks, sendTask, HubConfig, HubTask, TaskAttachment } from './api';
import {
  ATTACH_ENABLED,
  attachmentTextHint,
  pickDocument,
  pickImage,
  uploadImage,
  toTaskAttachment,
  PickedImage,
} from './attach';
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
type ChatItem = HubTask & {
  _localId?: string;
  _pending?: boolean;
  _failed?: boolean;
  _img?: PickedImage;
};

// Received tasks carry attachments inside meta_json (#221).
const attachmentNames = (item: ChatItem): string[] => {
  if (item._img) return [item._img.fileName];
  const raw = (item as any).meta_json;
  if (!raw) return [];
  try {
    const meta = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return (meta?.attachments ?? [])
      .filter((a: any) => a?.type === 'file')
      .map((a: any) => String(a.name ?? a.file_id));
  } catch {
    return [];
  }
};

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
  const [attached, setAttached] = useState<PickedImage | null>(null);

  const doSend = async (content: string, localId: string, img?: PickedImage) => {
    try {
      let attachments: TaskAttachment[] | undefined;
      let outgoing = content;
      if (img) {
        const up = await uploadImage(cfg, img);
        attachments = [toTaskAttachment(img, up)];
        outgoing = `${content}${attachmentTextHint(img, up)}`;
      }
      await sendTask(cfg, alias, outgoing, attachments);
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
    const content = draft.trim() || (attached ? `[图片] ${attached.fileName}` : '');
    if ((!content && !attached) || sending) return;
    const img = attached ?? undefined;
    setDraft('');
    setAttached(null);
    const localId = `local-${++localSeq.current}`;
    setMessages(prev => [
      { content, created_at: new Date().toISOString(), _localId: localId, _pending: true, _img: img },
      ...prev,
    ]);
    doSend(content, localId, img);
  };

  const retry = (item: ChatItem) => {
    if (!item._localId || !item.content) return;
    setMessages(prev =>
      prev.map(t => (t._localId === item._localId ? { ...t, _pending: true, _failed: false } : t)),
    );
    doSend(item.content, item._localId, item._img);
  };

  // Header subtitle, Telegram-style (Vincent tg 739-741): show 正在处理…
  // while a recent task has no result yet, otherwise the session status
  // so he can tell whether the agent is even online.
  const [sessionStatus, setSessionStatus] = useState('');
  useEffect(() => {
    let live = true;
    const poll = async () => {
      try {
        const data = await fetchStatus(cfg);
        const s = (data.sessions ?? []).find(x => x.alias === alias);
        if (live) setSessionStatus(s?.status ?? 'offline');
      } catch {
        /* keep last */
      }
    };
    poll();
    const t = setInterval(poll, 30000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [cfg, alias]);

  const processing = messages.some(
    m =>
      !m._localId &&
      !m.result &&
      ['created', 'delivered', 'started'].includes(m.status ?? '') &&
      m.created_at &&
      Date.now() - new Date(`${m.created_at.replace(' ', 'T')}Z`).getTime() < 10 * 60 * 1000,
  );
  const subtitle = processing
    ? '••• 正在处理…'
    : sessionStatus === 'working' || sessionStatus === 'running'
      ? '工作中'
      : sessionStatus === 'offline'
        ? '离线'
        : sessionStatus
          ? '在线'
          : '';

  const attach = () => {
    // Native gets a 图片/文件 choice; web (test harness) goes straight
    // to the image picker — Alert multi-button is unsupported there.
    if (Platform.OS === 'web') {
      pickImage().then(img => img && setAttached(img));
      return;
    }
    Alert.alert('发送附件', undefined, [
      { text: '图片', onPress: () => pickImage().then(img => img && setAttached(img)) },
      { text: '文件', onPress: () => pickDocument().then(f => f && setAttached(f)) },
      { text: '取消', style: 'cancel' },
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      // Edge-to-edge Android ignores adjustResize, so behavior=undefined
      // left the keyboard covering the input (Vincent tg 738). 'padding'
      // works on both platforms under edge-to-edge.
      behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
      keyboardVerticalOffset={Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0}
    >
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <AliasAvatar alias={alias} size={32} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title} numberOfLines={1}>
            {alias}
          </Text>
          {subtitle ? (
            <Text
              style={[
                styles.subtitle,
                processing && { color: colors.accent },
                sessionStatus === 'offline' && !processing && { color: colors.textMuted },
              ]}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
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
                {attachmentNames(item).map(n => (
                  <Text key={n} style={styles.attachmentLine}>
                    📎 {n}
                  </Text>
                ))}
              </View>
              {item.result || item.reply ? (
                <View style={[styles.bubble, styles.replyBubble]}>
                  <Text style={styles.bubbleText}>{item.result ?? item.reply}</Text>
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

      {attached ? (
        <View style={styles.attachPreview}>
          <Text style={styles.attachName} numberOfLines={1}>
            📎 {attached.fileName}
          </Text>
          <Pressable onPress={() => setAttached(null)} hitSlop={10}>
            <Text style={styles.attachRemove}>✕</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.inputRow}>
        {ATTACH_ENABLED ? (
          <Pressable
            style={({ pressed }) => [styles.attachBtn, pressed && { opacity: 0.6 }]}
            onPress={attach}
            hitSlop={6}
          >
            <Text style={styles.attachBtnText}>＋</Text>
          </Pressable>
        ) : null}
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
          disabled={sending || (!draft.trim() && !attached)}
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
  title: { color: colors.text, fontSize: 16, fontWeight: '600' },
  subtitle: { color: colors.running, fontSize: 11, marginTop: 1 },
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
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  typingText: { color: colors.textMuted, fontSize: 12 },
  attachmentLine: { color: colors.accent, fontSize: 12, marginTop: spacing.xs },
  attachPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  attachName: { color: colors.textSecondary, fontSize: 12, flexShrink: 1 },
  attachRemove: { color: colors.textMuted, fontSize: 14 },
  attachBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderColor: colors.border,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachBtnText: { color: colors.textSecondary, fontSize: 20, lineHeight: 22 },
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
