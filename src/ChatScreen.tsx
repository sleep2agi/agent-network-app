import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AliasAvatar from './AliasAvatar';
import AuthedThumb, { AttachmentFile, AuthedVideo, mimeFromName } from './AuthedThumb';
import { fetchStatus, fetchTasks, sendTask, HubConfig, HubTask, TaskAttachment } from './api';
import { outboxAdd, outboxForAlias, outboxMarkFailed, outboxMarkPending, outboxRemove } from './outbox';
import {
  ATTACH_ENABLED,
  attachmentTextHint,
  pickDocument,
  pickImage,
  uploadImage,
  toTaskAttachment,
  PickedImage,
} from './attach';
import { attachmentFromClipboard, isTauriDesktop, releaseClipboardAttachment } from './clipboard-attachment';
import { colors, onThemeChange, spacing } from './theme';
import { formatChatHeader, shouldShowTimeHeader } from './time';
import { agentStatusLabel, applyQuote, removeMessage, shouldShowJumpPill, nextUnread, jumpPillLabel, canSend, shouldSendOnEnter } from './chat-actions';
import type { NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { usePoll } from './usePoll';
import { appFetch } from './app-fetch';
import MarkdownMessage from './MarkdownMessage';

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
  /** PR3 review①:恢复自 outbox 且原带图片——说明文案走这个标志单独渲染,
   *  🔴 绝不拼进 content:content 是「要发出去的字」,注解是「给用户看的字」,
   *  共用一个字段迟早串(重试会把注解原样发给对方 agent)。 */
  _restoredNoImage?: boolean;
};

// Received tasks carry attachments inside meta_json (#221). Images get
// tappable thumbnails (Vincent tg 748), other files a 📎 line.
interface AttachmentView {
  key: string;
  name: string;
  isImage: boolean;
  isVideo: boolean;
  /** local file uri for fresh echoes, authed API uri otherwise */
  uri?: string;
  /** authed API uris need RN Image headers — unavailable on web <img> */
  needsAuth?: boolean;
  mime?: string;
  size?: number;
}

const isImageLike = (name?: string, mime?: string) =>
  (mime ?? '').startsWith('image/') || /\.(png|jpe?g|gif|webp|heic)$/i.test(name ?? '');

const isVideoLike = (_name?: string, mime?: string) => (mime ?? '').startsWith('video/');

const makePusher = (serverUrl: string, out: AttachmentView[]) => {
  const seen = new Set<string>();
  return (fileId: string, name: string, mime?: string, size?: number) => {
    if (seen.has(fileId)) return;
    seen.add(fileId);
    // text refs carry no mime — derive it from the extension so the
    // share sheet can pick a player (Vincent tg 791)
    const resolved = mime ?? mimeFromName(name);
    out.push({
      key: fileId,
      name,
      isImage: isImageLike(name, resolved),
      isVideo: isVideoLike(name, resolved),
      uri: `${serverUrl}/api/files/${fileId}`,
      needsAuth: true,
      mime: resolved,
      size,
    });
  };
};

// Agents reference uploads in plain text, not meta (Vincent tg 765):
// render any /api/files/<id> mention as an openable attachment —
// markdown [name](…/api/files/id) keeps its name, bare refs get a stub.
const pushTextRefs = (text: string, push: (id: string, name: string, mime?: string) => void) => {
  for (const m of text.matchAll(/\[([^\]]+)\]\([^()\s]*\/api\/files\/([A-Za-z0-9_-]{8,64})\)/g)) {
    push(m[2], m[1]);
  }
  for (const m of text.matchAll(/\/api\/files\/([A-Za-z0-9_-]{8,64})/g)) {
    push(m[1], `文件 ${m[1].slice(0, 8)}…`);
  }
};

/** Attachments belonging to the SENT bubble: local echo, meta, content refs. */
const sentAttachmentViews = (item: ChatItem, serverUrl: string): AttachmentView[] => {
  if (item._img) {
    return [
      {
        key: item._img.uri,
        name: item._img.fileName,
        isImage: isImageLike(item._img.fileName, item._img.mimeType),
        isVideo: isVideoLike(item._img.fileName, item._img.mimeType),
        uri: item._img.uri,
        size: item._img.fileSize,
      },
    ];
  }
  const out: AttachmentView[] = [];
  const push = makePusher(serverUrl, out);

  const raw = (item as any).meta_json;
  if (raw) {
    try {
      const meta = typeof raw === 'string' ? JSON.parse(raw) : raw;
      for (const a of meta?.attachments ?? []) {
        if (a?.type === 'file' && a.file_id) {
          push(
            String(a.file_id),
            String(a.name ?? a.file_id),
            a.mime ? String(a.mime) : undefined,
            typeof a.size === 'number' ? a.size : undefined,
          );
        }
      }
    } catch {
      /* fall through to text refs */
    }
  }
  pushTextRefs(item.content ?? '', push);
  return out;
};

/** Attachments the AGENT sent back — rendered inside the reply bubble
 *  (Vincent tg 771: thumbnail was stranded under the sent bubble while the
 *  reply showed raw markdown). */
const replyAttachmentViews = (item: ChatItem, serverUrl: string): AttachmentView[] => {
  const out: AttachmentView[] = [];
  pushTextRefs(item.result ?? (item as any).reply ?? '', makePusher(serverUrl, out));
  return out;
};

/** Replace markdown file links with just the file name — the attachment
 *  itself renders as a thumbnail/📎 row below the text. */
const stripFileLinks = (text: string) =>
  text.replace(/\[([^\]]+)\]\([^()\s]*\/api\/files\/[A-Za-z0-9_-]{8,64}\)/g, '$1');

interface Props {
  cfg: HubConfig;
  alias: string;
  onBack: () => void;
  desktop?: boolean;
  onOpenNodeSettings?: () => void;
}

export default function ChatScreen({ cfg, alias, onBack, desktop = false, onOpenNodeSettings }: Props) {
  // Android edge-to-edge draws the composer under the gesture bar (same
  // class of bug as the tg 802 tab bar) — pad by the real bottom inset.
  const insets = useSafeAreaInsets();
  const composerInset = Platform.OS === 'android' ? insets.bottom : 0;
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [currentUsername, setCurrentUsername] = useState('我');
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

  // Reset the lazy window when the chat target changes; usePoll does the
  // initial fetch + polling (fires fn() right after this effect → limit=PAGE).
  // PR3 判据C:同时把该会话的 outbox 未送达条目并回列表(上次 app 被杀时留下的)。
  // 恢复项带 _localId → :188 的 merge 会让它们在轮询重载中存活;_failed → 渲染成
  // 「未送达 · 点击重试」,retry 复用同一 id。恢复项无 _img(附件不持久化,见 outbox.ts)。
  useEffect(() => {
    limitRef.current = PAGE;
    const restored = outboxForAlias(alias).map<ChatItem>((e) => ({
      content: e.content, // 保持原文——重试发的就是它
      created_at: new Date(e.createdAt).toISOString(),
      _localId: e.id,
      _pending: e.state === 'pending',
      _failed: e.state === 'failed',
      _restoredNoImage: !!e.hadImage,
    }));
    setMessages(restored.reverse()); // inverted 列表:新的在前
    setLoaded(false);
    setHasOlder(true);
  }, [load, alias]);

  // Foreground-only message polling: 5s while visible, paused in background,
  // instant refresh on resume (shared hook). Reads the live window via limitRef.
  usePoll(() => load(limitRef.current), 5000, [load]);

  useEffect(() => {
    let alive = true;
    appFetch(`${cfg.serverUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${cfg.token}` },
    })
      .then(res => res.json())
      .then(data => {
        const username = data?.user?.username;
        if (alive && typeof username === 'string' && username.trim()) setCurrentUsername(username.trim());
      })
      .catch(() => { /* the stable “我” avatar remains available offline */ });
    return () => { alive = false; };
  }, [cfg.serverUrl, cfg.token]);

  const loadOlder = async () => {
    if (loadingOlder || !hasOlder || !loaded) return;
    setLoadingOlder(true);
    limitRef.current += PAGE;
    await load(limitRef.current);
    setLoadingOlder(false);
  };

  const localSeq = useRef(0);
  const [attached, setAttached] = useState<PickedImage | null>(null);
  const replaceAttachment = useCallback((next: PickedImage | null) => {
    setAttached(previous => {
      if (previous !== next) releaseClipboardAttachment(previous);
      return next;
    });
  }, []);

  // React Native Web does not expose clipboard files through TextInput's
  // onChangeText. Listen at the window while this chat is mounted so Ctrl+V
  // (Windows/Linux) and Cmd+V (macOS) can reuse the normal attachment flow.
  // Text-only pastes are deliberately untouched.
  useEffect(() => {
    if (!isTauriDesktop() || typeof window === 'undefined') return;
    const onPaste = (event: ClipboardEvent) => {
      const pasted = attachmentFromClipboard(event.clipboardData?.items);
      if (!pasted) return;
      event.preventDefault();
      replaceAttachment(pasted);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [replaceAttachment]);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  // 更像微信·round-2: 长按气泡的动作菜单(引用/删除)。null = 未打开。
  const [menuFor, setMenuFor] = useState<ChatItem | null>(null);
  // 更像微信·round-3: 滚离底部时的「回到最新」pill + 未读计数。
  const listRef = useRef<FlatList<ChatItem>>(null);
  const [showJump, setShowJump] = useState(false);
  const [unread, setUnread] = useState(0);
  const newestKeyRef = useRef<string | undefined>(undefined);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y; // inverted: 0 = 底部(最新)
    setShowJump(shouldShowJumpPill(y));
    if (y < 40) setUnread(0); // 回到底部 → 清未读
  };
  const jumpToLatest = () => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    setUnread(0);
    setShowJump(false);
  };
  // 滚在上面时来了新消息(最新条 key 变化)→ 未读 +1;停在底部则清零。
  useEffect(() => {
    const k = messages[0] && (messages[0]._localId ?? messages[0].task_id);
    if (newestKeyRef.current !== undefined && k !== newestKeyRef.current) {
      setUnread(u => nextUnread(u, !showJump, 1));
    }
    newestKeyRef.current = k;
  }, [messages, showJump]);

  // shared by the sent bubble and the reply bubble (tg 771)
  const renderAttachment = (a: AttachmentView) =>
    a.isImage && a.uri && !a.needsAuth ? (
      <Pressable key={a.key} onPress={() => setViewerUri(a.uri!)}>
        <Image source={{ uri: a.uri }} style={styles.thumb} resizeMode="cover" />
      </Pressable>
    ) : a.isImage && a.needsAuth && Platform.OS !== 'web' ? (
      <AuthedThumb
        key={a.key}
        fileId={a.key}
        name={a.name}
        serverUrl={cfg.serverUrl}
        token={cfg.token}
        onPress={localUri => setViewerUri(localUri)}
      />
    ) : a.isVideo && a.needsAuth && Platform.OS !== 'web' ? (
      <AuthedVideo
        key={a.key}
        fileId={a.key}
        name={a.name}
        mime={a.mime}
        size={a.size}
        serverUrl={cfg.serverUrl}
        token={cfg.token}
      />
    ) : a.needsAuth && Platform.OS !== 'web' ? (
      <AttachmentFile
        key={a.key}
        fileId={a.key}
        name={a.name}
        mime={a.mime}
        serverUrl={cfg.serverUrl}
        token={cfg.token}
      />
    ) : (
      <Text key={a.key} style={styles.attachmentLine}>
        📎 {a.name}
      </Text>
    );

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
      releaseClipboardAttachment(img ?? null);
      // delivered: drop the echo, the server copy arrives with reload.
      // 🔴 outbox 唯一删除路径=此处(sendTask 确认成功)。
      outboxRemove(localId);
      setMessages(prev => prev.filter(t => t._localId !== localId));
      await load(limitRef.current);
    } catch {
      outboxMarkFailed(localId); // 盘上也是 failed——杀 app 重开仍可重试
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
    // Optimistic echo: render the message instantly tagged with a
    // client-only _localId (NOT the server task id, which we don't have
    // yet). doSend drops this echo on success — the subsequent reload brings
    // the real server row — or flags _failed so retry() can resend with the
    // same _localId. localSeq just guarantees each echo's id is unique.
    // PR3 判据C:id 跨次启动唯一(重开恢复的旧 local-N 不能和新 id 撞车);
    // 🔴 提交即落盘(网络尝试之前)——发送中被杀,重开后它还在。
    const localId = `local-${Date.now()}-${++localSeq.current}`;
    outboxAdd({ id: localId, alias, content, createdAt: Date.now(), state: 'pending', hadImage: !!img });
    setMessages(prev => [
      { content, created_at: new Date().toISOString(), _localId: localId, _pending: true, _img: img },
      ...prev,
    ]);
    doSend(content, localId, img);
  };

  const retry = (item: ChatItem) => {
    if (!item._localId || !item.content) return;
    outboxMarkPending(item._localId); // 重试中被杀照样恢复(仍在盘上)
    setMessages(prev =>
      prev.map(t => (t._localId === item._localId ? { ...t, _pending: true, _failed: false } : t)),
    );
    doSend(item.content, item._localId, item._img);
  };

  // Header subtitle, Telegram-style (Vincent tg 739-741): show 正在处理…
  // while a recent task has no result yet, otherwise the session status
  // so he can tell whether the agent is even online.
  const [sessionStatus, setSessionStatus] = useState('');
  // Deliberately a slower, separate poll than the 5s message poll above:
  // an agent's online/offline state changes far less often than messages
  // do, so 30s keeps the status badge fresh without doubling the chat's
  // request rate. Don't merge the two — they have different freshness needs.
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

  // "正在处理…" only while a real (non-echo) task is still in a pre-result
  // state AND was created within the last 10 min. The 10-min cutoff is a
  // staleness guard: a task that never produced a result (agent crashed,
  // went offline mid-run) would otherwise leave the subtitle spinning
  // forever — after the window we fall back to the plain online/offline
  // status instead. `created_at` is the hub's space-separated UTC string,
  // so swap space→T and append Z before parsing (cf. time.ts).
  const processing = messages.some(
    m =>
      !m._localId &&
      !m.result &&
      ['created', 'delivered', 'started'].includes(m.status ?? '') &&
      m.created_at &&
      Date.now() - new Date(`${m.created_at.replace(' ', 'T')}Z`).getTime() < 10 * 60 * 1000,
  );
  const subtitle = processing ? '••• 正在处理…' : sessionStatus ? agentStatusLabel(sessionStatus) : '';

  const attach = () => {
    // Native gets a 图片/文件 choice; web (test harness) goes straight
    // to the image picker — Alert multi-button is unsupported there.
    if (Platform.OS === 'web') {
      pickImage().then(img => img && replaceAttachment(img));
      return;
    }
    Alert.alert('发送附件', undefined, [
      { text: '图片', onPress: () => pickImage().then(img => img && replaceAttachment(img)) },
      { text: '文件', onPress: () => pickDocument().then(f => f && replaceAttachment(f)) },
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
        {!desktop ? (
          <Pressable onPress={onBack} hitSlop={12}>
            <Text style={styles.back}>‹</Text>
          </Pressable>
        ) : null}
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
        {desktop && onOpenNodeSettings ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="节点设置"
            onPress={onOpenNodeSettings}
            hitSlop={10}
            style={({ pressed }) => [styles.headerAction, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="settings-outline" size={20} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      {!loaded ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          onScroll={onScroll}
          scrollEventThrottle={16}
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
          renderItem={({ item, index }) => {
            // 更像微信·时间分组:仅在与上一条(更早)间隔 >5min 时显示居中时间头,
            // 不再每条气泡都盖时间。inverted 列表下,更早的邻居在 index+1。
            const showHeader = shouldShowTimeHeader(item.created_at, messages[index + 1]?.created_at);
            return (
              <View style={styles.bubbleWrap}>
                {showHeader && item.created_at ? (
                  <Text style={styles.timeHeader}>{formatChatHeader(item.created_at)}</Text>
                ) : null}
                <View style={[styles.messageRow, styles.sentRow]}>
                  <View style={[styles.messageContent, styles.sentContent]}>
                    <Text style={[styles.messageAuthor, styles.sentAuthor]} numberOfLines={1}>
                      {currentUsername}
                    </Text>
                    <Pressable
                      onLongPress={() => setMenuFor(item)}
                      delayLongPress={300}
                      style={({ pressed }) => [styles.bubblePressable, pressed && { opacity: 0.7 }]}
                    >
                      <View style={styles.bubble}>
                        <MarkdownMessage>{stripFileLinks(item.content || '—')}</MarkdownMessage>
                        {sentAttachmentViews(item, cfg.serverUrl).map(renderAttachment)}
                      </View>
                    </Pressable>
                  </View>
                  <AliasAvatar alias={currentUsername} size={36} />
                </View>
                {item.result || item.reply ? (
                  <View style={[styles.messageRow, styles.replyRow]}>
                    <AliasAvatar alias={alias} size={36} />
                    <View style={styles.messageContent}>
                      <Text style={styles.messageAuthor} numberOfLines={1}>{alias}</Text>
                      <View style={[styles.bubble, styles.replyBubble]}>
                        <MarkdownMessage>{stripFileLinks(item.result ?? item.reply ?? '')}</MarkdownMessage>
                        {replyAttachmentViews(item, cfg.serverUrl).map(renderAttachment)}
                      </View>
                    </View>
                  </View>
                ) : null}
                {item._restoredNoImage ? (
                  <Text style={styles.restoredNote}>（图片附件未保存·重试仅发文本）</Text>
                ) : null}
                {item._pending ? (
                  <Text style={styles.pendingMark}>发送中…</Text>
                ) : item._failed ? (
                  <Pressable onPress={() => retry(item)} hitSlop={8}>
                    <Text style={styles.failedMark}>未送达 · 点击重试</Text>
                  </Pressable>
                ) : !(item.result ?? item.reply) ? (
                  // PR3 要求2:「送达了但对方没回」≠「未送达」——前者灰勾不可点(不用重试),
                  // 后者红字带重试。服务器行(无 _localId 标志)= hub 已收 = 已送达。
                  <Text style={styles.deliveredMark}>已送达 ✓</Text>
                ) : null}
              </View>
            );
          }}
        />
      )}

      {/* 更像微信·round-3: 滚离底部时的「回到最新 / N 条新消息」pill */}
      {showJump ? (
        <Pressable style={styles.jumpPill} onPress={jumpToLatest} hitSlop={8}>
          <Text style={styles.jumpPillText}>{jumpPillLabel(unread)} ↓</Text>
        </Pressable>
      ) : null}

      {attached ? (
        <View style={styles.attachPreview}>
          <Text style={styles.attachName} numberOfLines={1}>
            📎 {attached.fileName}
          </Text>
          <Pressable onPress={() => replaceAttachment(null)} hitSlop={10}>
            <Text style={styles.attachRemove}>✕</Text>
          </Pressable>
        </View>
      ) : null}
      <Modal visible={!!viewerUri} transparent animationType="fade">
        <Pressable style={styles.viewerBackdrop} onPress={() => setViewerUri(null)}>
          {viewerUri ? (
            <Image source={{ uri: viewerUri }} style={styles.viewerImage} resizeMode="contain" />
          ) : null}
        </Pressable>
      </Modal>

      {/* 更像微信·round-2: 长按气泡动作菜单(底部 action sheet·引用/删除/取消) */}
      <Modal visible={!!menuFor} transparent animationType="fade" onRequestClose={() => setMenuFor(null)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuFor(null)}>
          <View style={styles.actionSheet}>
            <Pressable
              style={({ pressed }) => [styles.actionItem, pressed && styles.actionItemPressed]}
              onPress={() => {
                if (menuFor) setDraft((d) => applyQuote(d, menuFor.content));
                setMenuFor(null);
              }}
            >
              <Text style={styles.actionText}>引用</Text>
            </Pressable>
            <View style={styles.actionSep} />
            <Pressable
              style={({ pressed }) => [styles.actionItem, pressed && styles.actionItemPressed]}
              onPress={() => {
                if (menuFor) setMessages((prev) => removeMessage(prev, menuFor));
                setMenuFor(null);
              }}
            >
              <Text style={[styles.actionText, styles.actionDanger]}>删除</Text>
            </Pressable>
            <View style={styles.actionSepGap} />
            <Pressable
              style={({ pressed }) => [styles.actionItem, pressed && styles.actionItemPressed]}
              onPress={() => setMenuFor(null)}
            >
              <Text style={styles.actionCancel}>取消</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {desktop ? (
        <View style={styles.desktopComposer}>
          <TextInput
            style={styles.desktopInput}
            placeholder={`Message ${alias}…`}
            placeholderTextColor={colors.textMuted}
            value={draft}
            onChangeText={setDraft}
            onKeyPress={(event) => {
              const key = event.nativeEvent as typeof event.nativeEvent & { shiftKey?: boolean; isComposing?: boolean };
              if (!shouldSendOnEnter(key)) return;
              event.preventDefault?.();
              submit();
            }}
            multiline
          />
          <View style={styles.desktopToolbar}>
            {ATTACH_ENABLED ? (
              <Pressable accessibilityLabel="添加附件" style={({ pressed }) => [styles.desktopToolButton, pressed && { opacity: 0.6 }]} onPress={attach} hitSlop={6}>
                <Ionicons name="add-circle-outline" size={24} color={colors.textSecondary} />
              </Pressable>
            ) : <View />}
            <View style={styles.desktopToolbarRight}>
              <Text style={styles.shortcutHint}>Enter 发送 · Shift+Enter 换行</Text>
              <Pressable
                style={({ pressed }) => [styles.desktopSend, !canSend(draft, !!attached, sending) && styles.desktopSendDisabled, pressed && { opacity: 0.7 }]}
                onPress={submit}
                disabled={!canSend(draft, !!attached, sending)}
              >
                <Text style={[styles.desktopSendText, !canSend(draft, !!attached, sending) && styles.sendTextDisabled]}>发送</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : (
      <View style={[styles.inputRow, { paddingBottom: spacing.md + composerInset }]}>
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
          onKeyPress={(event) => {
            if (!desktop) return;
            const key = event.nativeEvent as typeof event.nativeEvent & {
              shiftKey?: boolean;
              isComposing?: boolean;
            };
            if (!shouldSendOnEnter(key)) return;
            event.preventDefault?.();
            submit();
          }}
          multiline
        />
        <Pressable
          style={({ pressed }) => [
            styles.send,
            !canSend(draft, !!attached, sending) && styles.sendDisabled,
            pressed && { opacity: 0.6 },
          ]}
          onPress={submit}
          disabled={!canSend(draft, !!attached, sending)}
        >
          <Text style={[styles.sendText, !canSend(draft, !!attached, sending) && styles.sendTextDisabled]}>↑</Text>
        </Pressable>
      </View>
      )}
    </KeyboardAvoidingView>
  );
}

const makeStyles = () =>
  StyleSheet.create({
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
  headerAction: {
    width: 34,
    height: 34,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  beginning: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginVertical: spacing.md,
  },
  bubbleWrap: { marginBottom: spacing.md, gap: spacing.xs },
  messageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, width: '100%' },
  sentRow: { justifyContent: 'flex-end' },
  replyRow: { justifyContent: 'flex-start' },
  messageContent: { maxWidth: '85%', flexShrink: 1, alignItems: 'flex-start' },
  sentContent: { alignItems: 'flex-end' },
  messageAuthor: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginBottom: 3 },
  sentAuthor: { textAlign: 'right' },
  bubblePressable: { maxWidth: '100%', alignItems: 'flex-end' },
  timeHeader: {
    color: colors.textMuted,
    fontSize: 11,
    alignSelf: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  bubble: {
    alignSelf: 'flex-end',
    maxWidth: '100%',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  replyBubble: { alignSelf: 'flex-start', maxWidth: '85%', flexShrink: 1, backgroundColor: colors.inputBg },
  bubbleText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  restoredNote: { color: colors.textMuted, fontSize: 10, marginTop: 2, alignSelf: 'flex-end' },
  deliveredMark: { color: colors.textMuted, fontSize: 10, marginTop: 2, alignSelf: 'flex-end' },
  pendingMark: { color: colors.textMuted, fontSize: 10, alignSelf: 'flex-end' },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  typingText: { color: colors.textMuted, fontSize: 12 },
  attachmentLine: { color: colors.accent, fontSize: 12, marginTop: spacing.xs },
  thumb: {
    width: 180,
    height: 180,
    borderRadius: 10,
    marginTop: spacing.sm,
    backgroundColor: colors.inputBg,
  },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerImage: { width: '100%', height: '80%' },
  // round-2 长按动作菜单(底部 action sheet)
  menuBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  actionSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingBottom: spacing.xl,
  },
  actionItem: { paddingVertical: spacing.lg, alignItems: 'center' },
  actionItemPressed: { backgroundColor: colors.inputBg },
  actionText: { color: colors.text, fontSize: 16 },
  actionDanger: { color: colors.failed },
  actionCancel: { color: colors.textSecondary, fontSize: 16, fontWeight: '600' },
  actionSep: { height: 1, backgroundColor: colors.border },
  actionSepGap: { height: spacing.sm, backgroundColor: colors.bg },
  // round-3 回到最新 pill
  jumpPill: {
    position: 'absolute',
    right: spacing.lg,
    bottom: 84,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  jumpPillText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
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
  desktopComposer: {
    minHeight: 148,
    maxHeight: 220,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  desktopInput: {
    flex: 1,
    minHeight: 76,
    maxHeight: 150,
    color: colors.text,
    fontSize: 14,
    lineHeight: 21,
    padding: 0,
    textAlignVertical: 'top',
    outlineStyle: 'none',
  } as any,
  desktopToolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing.sm },
  desktopToolButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  desktopToolbarRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  shortcutHint: { color: colors.textMuted, fontSize: 10 },
  desktopSend: { minWidth: 64, height: 32, borderRadius: 5, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  desktopSendDisabled: { backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border },
  desktopSendText: { color: '#ffffff', fontSize: 13, fontWeight: '600' },
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
  // round-4 发送键停用态:草稿空/发送中 → 灰底灰字(微信式,不再高亮可点)
  sendDisabled: { backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border },
  sendTextDisabled: { color: colors.textMuted },
});

let styles = makeStyles();
onThemeChange(() => {
  styles = makeStyles();
});
