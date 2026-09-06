import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  ActivityIndicator,
  Alert,
  BackHandler,
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
import AuthedWebThumb from './AuthedWebThumb';
import { createDashboardRequestId, dashboardRequestIdForLocalId, fetchStatus, fetchTasks, sendTask, HubConfig, HubTask, Session, TaskAttachment, TaskPriority } from './api';
import { outboxAdd, outboxForAlias, outboxMarkFailed, outboxMarkPending, outboxRemove } from './outbox';
import { mayApplySendResult, shouldExposeSendFailure } from './send-reconciliation';
import { conversationKey, conversationScope, createConversationRequestGate, createConversationStore } from './conversation-store';
import { resolveSender } from './chat-sender';
import { COMPOSER_HEIGHT_DEFAULT, clampComposerHeight, composerDragHandlers, inputMaxHeight, loadComposerHeight, lockDocumentSelection, saveComposerHeight } from './composer-resize';
import {
  ATTACH_ENABLED,
  attachmentTextHint,
  pickDocument,
  pickImage,
  uploadImage,
  toTaskAttachment,
  PickedImage,
} from './attach';
import { appendAttachmentQueue, attachmentFromClipboard, isTauriDesktop, releaseClipboardAttachment } from './clipboard-attachment';
import { colors, onThemeChange, spacing } from './theme';
import { formatChatHeader, shouldShowTimeHeader } from './time';
import { agentStatusLabel, applyQuote, confirmedOutboxIds, mergeMessagesNewestFirst, msgKey, removeMessage, shouldShowJumpPill, nextUnread, jumpPillLabel, canSend, shouldSendOnEnter } from './chat-actions';
import type { NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { usePoll } from './usePoll';
import { chatSearchState, isHighlighted, isStaleSearch, matchCountLabel, searchItems, shouldLoadOlderForSearch, stepHit, type SearchHit } from './chat-search';
import { retryUnreadPersistFromPoll } from './conversation-unread-persist';
import { dispatchUnread } from './unread-store';
import { appFetch } from './app-fetch';
import MarkdownMessage from './MarkdownMessage';
import { cleanAttachmentDebugText, parseAttachmentRefs, parseMetaAttachmentRefs, parseMetaReplyAttachmentRefs } from './attachment-display';
import { attachmentCacheScope } from './attach-download';
import ActualRecipientNotice from './ActualRecipientNotice';
import { sendConfirmationFromResponse, sendNoticeFor, type SendConfirmation } from './actual-recipient';
import { beginForward, confirmForward, markForwardAmbiguous, mayProjectForward, resetForwardWithoutResend } from './forward-controller';
import { parseBtwFirstToken } from './btw-command';
import SideThreadDrawer, { type SideThreadLaunch } from './SideThreadDrawer';

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
  _imgs?: PickedImage[];
  /** PR3 review①:恢复自 outbox 且原带图片——说明文案走这个标志单独渲染,
   *  🔴 绝不拼进 content:content 是「要发出去的字」,注解是「给用户看的字」,
   *  共用一个字段迟早串(重试会把注解原样发给对方 agent)。 */
  _restoredNoImage?: boolean;
  _priority?: 'high' | 'normal';
};

type MessageSelection = { item: ChatItem; text: string };

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
  for (const ref of parseAttachmentRefs(text)) push(ref.fileId, ref.name, ref.mime);
};

/** Attachments belonging to the SENT bubble: local echo, meta, content refs. */
const sentAttachmentViews = (item: ChatItem, serverUrl: string): AttachmentView[] => {
  const localAttachments = item._imgs ?? (item._img ? [item._img] : []);
  if (localAttachments.length) {
    return localAttachments.map(img => ({
      key: img.uri,
      name: img.fileName,
      isImage: isImageLike(img.fileName, img.mimeType),
      isVideo: isVideoLike(img.fileName, img.mimeType),
      uri: img.uri,
      size: img.fileSize,
    }));
  }
  const out: AttachmentView[] = [];
  const push = makePusher(serverUrl, out);

  for (const a of parseMetaAttachmentRefs((item as any).meta_json)) {
    push(a.fileId, a.name, a.mime, a.size);
  }
  pushTextRefs(item.content ?? '', push);
  return out;
};

/** Attachments the AGENT sent back — rendered inside the reply bubble
 *  (Vincent tg 771: thumbnail was stranded under the sent bubble while the
 *  reply showed raw markdown). */
const replyAttachmentViews = (item: ChatItem, serverUrl: string): AttachmentView[] => {
  const out: AttachmentView[] = [];
  const push = makePusher(serverUrl, out);
  // #1823 —— hub ≥ 0.9.0-preview.50 把回复附件放在 meta_json.reply_attachments;
  // 旧 hub 把它们并进 attachments(会画到提问者气泡),这里不去猜,只认新键。
  for (const a of parseMetaReplyAttachmentRefs((item as any).meta_json)) push(a.fileId, a.name, a.mime, a.size);
  pushTextRefs(item.result ?? (item as any).reply ?? '', push);
  return out;
};

/** Replace markdown file links with just the file name — the attachment
 *  itself renders as a thumbnail/📎 row below the text. */
interface Props {
  cfg: HubConfig;
  alias: string;
  onBack: () => void;
  desktop?: boolean;
  onOpenNodeSettings?: () => void;
}

// Module level on purpose: the cache has to outlive a screen unmount, or
// returning to a conversation is a blank list and a fetch all over again.
const conversations = createConversationStore<ChatItem>();

export const clearChatConversationCache = (profileId?: string, serverUrl = ''): void => {
  conversations.clearScope(conversationScope(profileId, serverUrl));
};

export default function ChatScreen({ cfg, alias, onBack, desktop = false, onOpenNodeSettings }: Props) {
  // Android edge-to-edge draws the composer under the gesture bar (same
  // class of bug as the tg 802 tab bar) — pad by the real bottom inset.
  const insets = useSafeAreaInsets();
  const composerInset = Platform.OS === 'android' ? insets.bottom : 0;
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [currentUsername, setCurrentUsername] = useState('我');
  const [loaded, setLoaded] = useState(false);
  const [conversationReady, setConversationReady] = useState(false);
  const [hasOlder, setHasOlder] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState('');
  const [sendPriority, setSendPriority] = useState<'high' | 'normal'>('normal');
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [btwLaunch, setBtwLaunch] = useState<SideThreadLaunch>();
  const mainComposerRef = useRef<TextInput>(null);
  // app#237 —— 桌面端输入区高度可拖拽:根容器高度决定上界(消息区至少留 200px),
  // 值全局持久化(切会话 / 重启保持)。分隔条在输入区上沿,向上拖变高。
  const [rootHeight, setRootHeight] = useState(0);
  const rootHeightRef = useRef(0);
  const [composerHeightRaw, setComposerHeightRaw] = useState<number>(() => loadComposerHeight() ?? COMPOSER_HEIGHT_DEFAULT);
  const composerHeight = clampComposerHeight(composerHeightRaw, rootHeight || undefined);
  const composerHeightRawRef = useRef(composerHeightRaw);
  composerHeightRawRef.current = composerHeightRaw;
  // 🔴 只创建一次(空依赖):每次高度变化重建 PanResponder 会让 react-native-web 在拖拽中途
  // 换 responder config,新 gestureState 的 dy 从 0 重新累计 → 拖不动(见 composer-resize.ts)。
  // 会变的值全部经 ref 现读。
  const composerPan = useMemo(() => PanResponder.create(composerDragHandlers({
    getHeight: () => composerHeightRawRef.current,
    getRootHeight: () => rootHeightRef.current || undefined,
    setHeight: setComposerHeightRaw,
    save: saveComposerHeight,
    lockSelection: Platform.OS === 'web' ? lockDocumentSelection : undefined,
  })), []);
  const sending = false; // optimistic echo frees the input immediately
  const limitRef = useRef(PAGE);

  // app#166 —— 微信式「聊天记录搜索」:范围永远是当前会话;结果只认开始搜索时的会话 key。
  const SEARCH_MAX_OLDER_PAGES = 5;
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchCurrent, setSearchCurrent] = useState(-1);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const searchPagesRef = useRef(0);
  const searchInputRef = useRef<TextInput>(null);
  const [highlight, setHighlight] = useState<{ key: string; at: number } | null>(null);
  const [highlightTick, setHighlightTick] = useState(0);
  const lastOffsetRef = useRef(0);
  const savedOffsetRef = useRef<number | null>(null);

  const conversationKeyFor = conversationKey(cfg.profileId, cfg.serverUrl, cfg.networkId, alias);
  // Updated during render, before effects: an async send from the previous
  // sidebar selection must see the new owner immediately.
  const visibleConversationKeyRef = useRef(conversationKeyFor);
  visibleConversationKeyRef.current = conversationKeyFor;
  const requestGateRef = useRef<ReturnType<typeof createConversationRequestGate> | null>(null);
  if (!requestGateRef.current) requestGateRef.current = createConversationRequestGate();
  const requestGate = requestGateRef.current;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const token = requestGate.current();
      if (token) requestGate.close(token);
    };
  }, []);

  const load = useCallback(
    async (limit: number) => {
      const token = requestGate.current();
      if (!token) return;
      try {
        const data = await fetchTasks(cfg, { to_name: alias, limit });
        // The await is where the conversation can change underneath us. Every
        // line below writes to screen state, so nothing may run for an answer
        // that is no longer the one being waited for — that is the whole bug.
        const fetched = data.tasks ?? [];
        if (!requestGate.isCurrent(token) || !mountedRef.current) {
          conversations.put(token.key, fetched);
          return;
        }
        if (fetched.length < limit) setHasOlder(false);
        // Hub returns newest-first, which matches inverted-list order. Reconcile
        // accepted retries before merging local echoes into that same timeline.
        const confirmed = new Set(confirmedOutboxIds(outboxForAlias(alias), fetched));
        confirmed.forEach(outboxRemove);
        setMessages(prev => {
          const merged = mergeMessagesNewestFirst(
            prev.filter(t => t._localId && !confirmed.has(t._localId)),
            fetched,
          );
          conversations.put(token.key, merged);
          return merged;
        });
        setConversationReady(true);
      } catch {
        /* poll retries — the conversation keeps whatever it already had */
      } finally {
        if (requestGate.isCurrent(token) && mountedRef.current) setLoaded(true);
        void retryUnreadPersistFromPoll();
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
      _priority: e.priority ?? 'normal',
    }));
    // Opening invalidates anything still in flight for the previous
    // conversation, then hands back this one's cached content.
    const token = requestGate.open(conversationKeyFor);
    const snapshot = conversations.open(conversationKeyFor);
    const restoredNewestFirst = restored.reverse(); // inverted 列表:新的在前
    if (snapshot && snapshot.messages.length > 0) {
      // Cached: show it in the same frame as the title change, then refresh in
      // the background. A spinner over content we already have is a downgrade.
      setMessages(mergeMessagesNewestFirst(restoredNewestFirst, snapshot.messages));
      setLoaded(true);
      setConversationReady(true);
    } else {
      // Nothing cached: an empty list plus loaded=false is the skeleton state.
      // Never carry the previous conversation's messages into this frame.
      setMessages(restoredNewestFirst);
      setLoaded(false);
      setConversationReady(false);
    }
    setHasOlder(true);
    return () => {
      requestGate.close(token);
    };
  }, [load, alias, conversationKeyFor]);

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

  const [attached, setAttached] = useState<PickedImage[]>([]);
  const appendAttachment = useCallback((next: PickedImage) => {
    setAttached(previous => {
      if (previous.length >= 20) {
        releaseClipboardAttachment(next);
        return previous;
      }
      return appendAttachmentQueue(previous, next);
    });
  }, []);
  const removeAttachment = useCallback((uri: string) => {
    setAttached(previous => {
      const removed = previous.find(item => item.uri === uri);
      releaseClipboardAttachment(removed ?? null);
      return previous.filter(item => item.uri !== uri);
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
      appendAttachment(pasted);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [appendAttachment]);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const attachmentViewerScope = `${conversationKeyFor}::${attachmentCacheScope(cfg.serverUrl, cfg.token)}`;
  // A blob: URL (Tauri web) and a file: URI (native) both identify bytes that
  // were fetched under the previous credentials. Closing the parent modal is
  // part of the auth boundary; resetting only the child thumbnail would leave
  // those already-open bytes visible after a profile/Hub/conversation switch.
  useEffect(() => setViewerUri(null), [attachmentViewerScope]);
  // 更像微信·round-2: 长按气泡的动作菜单(引用/删除)。null = 未打开。
  const [menuFor, setMenuFor] = useState<MessageSelection | null>(null);
  const [forwardFor, setForwardFor] = useState<MessageSelection | null>(null);
  const [forwardUiOwner, setForwardUiOwner] = useState<string | null>(null);
  const [forwardTargets, setForwardTargets] = useState<Session[]>([]);
  const [forwardQuery, setForwardQuery] = useState('');
  const [forwardingTo, setForwardingTo] = useState<string | null>(null);
  const forwardingRef = useRef(false);
  const forwardOperationKeyRef = useRef<string | null>(null);
  const [forwardAmbiguous, setForwardAmbiguous] = useState(false);
  const [sendConfirmation, setSendConfirmation] = useState<SendConfirmation | null>(null);
  // 成功且送达如你所愿时这里是 null,于是什么都不渲染 —— 气泡角上的「已送达 ✓」
  // 已经说过一次了。
  const sendNotice = sendConfirmation ? sendNoticeFor(sendConfirmation, alias) : null;

  // ChatScreen is reused while navigating between aliases. A confirmation is
  // scoped to the conversation where that write completed, never the next one.
  useEffect(() => {
    setSendConfirmation(null); setForwardFor(null); setForwardUiOwner(null); setForwardingTo(null); setForwardAmbiguous(false);
    // app#166 —— 快速切换会话时,上一个 Agent 的搜索结果一条都不能留下。
    setSearchOpen(false); setSearchQuery(''); setSearchHits([]); setSearchCurrent(-1); setSearchLoading(false); setSearchFailed(false);
    searchPagesRef.current = 0; savedOffsetRef.current = null; setHighlight(null);
  }, [conversationKeyFor]);

  // app#166 —— 搜索:先在已加载历史里找;没命中就向 hub 要更早的页(有上限),结果只认当前会话。
  const searchable = messages.map(m => ({
    key: msgKey(m),
    text: [m.content, m.result ?? m.reply].filter(Boolean).join('\n'),
    sender: resolveSender(m, currentUsername).alias,
    createdAt: m.created_at,
  }));
  useEffect(() => {
    if (!searchOpen) return;
    const startedKey = conversationKeyFor;
    const hits = searchItems(searchable, searchQuery);
    setSearchHits(hits);
    setSearchCurrent(prev => (hits.length === 0 ? -1 : Math.min(Math.max(prev, 0), hits.length - 1)));
    if (!shouldLoadOlderForSearch({ hits: hits.length, hasOlder, pagesLoaded: searchPagesRef.current, maxPages: SEARCH_MAX_OLDER_PAGES })) {
      setSearchLoading(false);
      return;
    }
    if (loadingOlder) return; // 上一页还在路上;它落地后 messages 变化会再进这里
    let cancelled = false;
    setSearchLoading(true);
    setSearchFailed(false);
    (async () => {
      try {
        searchPagesRef.current += 1;
        await loadOlder();
      } catch {
        if (!cancelled && !isStaleSearch(startedKey, visibleConversationKeyRef.current)) setSearchFailed(true);
      } finally {
        if (!cancelled && !isStaleSearch(startedKey, visibleConversationKeyRef.current)) setSearchLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOpen, searchQuery, messages, hasOlder, conversationKeyFor]);

  const openSearch = () => {
    savedOffsetRef.current = lastOffsetRef.current;
    searchPagesRef.current = 0;
    setSearchFailed(false);
    setSearchOpen(true);
    setTimeout(() => searchInputRef.current?.focus(), 50);
  };
  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery(''); setSearchHits([]); setSearchCurrent(-1); setSearchLoading(false); setSearchFailed(false);
    // 关闭搜索回到同一会话、同一滚动位置。
    const saved = savedOffsetRef.current;
    if (saved !== null) {
      setTimeout(() => listRef.current?.scrollToOffset({ offset: saved, animated: false }), 0);
      savedOffsetRef.current = null;
    }
  };
  const retrySearchOlder = () => {
    setSearchFailed(false);
    searchPagesRef.current = Math.max(0, searchPagesRef.current - 1);
    setSearchQuery(q => q); // 触发 effect 重跑
    setHighlightTick(t => t + 1);
  };
  const locateHit = (i: number) => {
    const hit = searchHits[i];
    if (!hit) return;
    setSearchCurrent(i);
    // 用 key 找**当前** messages 里的下标(列表可能在结果算出后又长了)。
    const index = messages.findIndex(m => msgKey(m) === hit.key);
    if (index < 0) return;
    listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
    setHighlight({ key: hit.key, at: Date.now() });
    setTimeout(() => setHighlightTick(t => t + 1), 2100);
  };
  const stepSearch = (dir: 'older' | 'newer') => {
    const next = stepHit(searchCurrent, searchHits.length, dir);
    if (next >= 0) locateHit(next);
  };
  // Android 返回键:先关搜索,不退出会话。
  useEffect(() => {
    if (!searchOpen || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { closeSearch(); return true; });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOpen]);
  const searchState = chatSearchState({ query: searchQuery, loading: searchLoading, hits: searchHits.length, failed: searchFailed });
  void highlightTick;

  useEffect(() => {
    const doc = (globalThis as any).document;
    if (!desktop || !doc?.addEventListener) return;
    const handleMessageContextMenu = (event: any) => {
      const bubble = event.target?.closest?.('[data-message-key]');
      const key = bubble?.getAttribute?.('data-message-key');
      const part = bubble?.getAttribute?.('data-message-part');
      if (!key || !part) return;
      const item = messages.find(message => msgKey(message) === key);
      const text = part === 'reply' ? (item?.result ?? item?.reply ?? '') : (item?.content ?? '');
      if (!item || !text) return;
      event.preventDefault?.();
      event.stopPropagation?.();
      event.stopImmediatePropagation?.();
      setMenuFor({ item, text });
    };
    doc.addEventListener('contextmenu', handleMessageContextMenu, true);
    return () => doc.removeEventListener('contextmenu', handleMessageContextMenu, true);
  }, [desktop, messages]);

  const openForwardPicker = async (selection: MessageSelection) => {
    setMenuFor(null);
    setForwardFor(selection);
    setForwardUiOwner(conversationKeyFor);
    setForwardQuery('');
    setForwardAmbiguous(false);
    try {
      const data = await fetchStatus(cfg);
      setForwardTargets((data.sessions ?? []).filter(session => session.alias));
    } catch {
      setForwardTargets([]);
    }
  };

  const forwardMessage = async (target: string) => {
    if (!forwardFor || forwardingRef.current || forwardAmbiguous) return;
    const startedKey = conversationKeyFor;
    const mayWrite = () => mayProjectForward(startedKey, visibleConversationKeyRef.current, mountedRef.current);
    const begun = beginForward(startedKey, target, forwardFor.text, createDashboardRequestId);
    forwardOperationKeyRef.current = begun.operation.key;
    if (!begun.started) { setForwardAmbiguous(true); return; }
    forwardingRef.current = true;
    setForwardingTo(target);
    try {
      const requestId = begun.operation.requestId;
      const response = await sendTask(cfg, target, forwardFor.text, undefined, 'normal', requestId);
      confirmForward(begun.operation.key);
      if (mayWrite()) {
        setSendConfirmation(sendConfirmationFromResponse(response));
        setForwardFor(null);
      }
    } catch (error) {
      // No public forward reconciliation endpoint currently proves whether an
      // ACK-loss write committed. Fail closed and disable repeat taps.
      markForwardAmbiguous(begun.operation.key);
      if (mayWrite()) {
        setForwardAmbiguous(true);
        Alert.alert('转发结果待确认', '可能已经送达。为避免重复转发，请先在目标会话确认。');
      }
    } finally {
      forwardingRef.current = false;
      if (mayWrite()) setForwardingTo(null);
    }
  };
  // 更像微信·round-3: 滚离底部时的「回到最新」pill + 未读计数。
  const listRef = useRef<FlatList<ChatItem>>(null);
  const [showJump, setShowJump] = useState(false);
  const [unread, setUnread] = useState(0);
  const newestKeyRef = useRef<string | undefined>(undefined);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y; // inverted: 0 = 底部(最新)
    lastOffsetRef.current = y;
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

  // #161 列表徽标：打开会话不清零；只有消息真正展示到最新才清。
  useEffect(() => {
    dispatchUnread({ kind: 'conversation_opened', agent: alias });
    return () => {
      dispatchUnread({ kind: 'conversation_left' });
    };
  }, [alias]);
  useEffect(() => {
    if (!conversationReady) return;
    if (showJump) {
      dispatchUnread({ kind: 'conversation_opened', agent: alias });
      return;
    }
    dispatchUnread({ kind: 'rendered_to_latest', agent: alias });
  }, [alias, conversationReady, showJump]);

  // shared by the sent bubble and the reply bubble (tg 771)
  const renderAttachment = (a: AttachmentView) =>
    a.isImage && a.uri && !a.needsAuth ? (
      <Pressable key={a.key} onPress={() => setViewerUri(a.uri!)}>
        <Image source={{ uri: a.uri }} style={styles.thumb} resizeMode="contain" />
      </Pressable>
    ) : a.isImage && a.needsAuth && Platform.OS === 'web' && !!(globalThis as any).__TAURI_INTERNALS__ ? (
      <AuthedWebThumb
        key={`${attachmentCacheScope(cfg.serverUrl, cfg.token)}-${a.key}`}
        uri={a.uri!}
        name={a.name}
        mime={a.mime}
        token={cfg.token}
        onPress={objectUrl => setViewerUri(objectUrl)}
      />
    ) : a.isImage && a.needsAuth && Platform.OS !== 'web' ? (
      <View key={`${attachmentCacheScope(cfg.serverUrl, cfg.token)}-${a.key}`} style={styles.attachmentImage}>
        <AuthedThumb
          fileId={a.key}
          name={a.name}
          mime={a.mime}
          serverUrl={cfg.serverUrl}
          token={cfg.token}
          onPress={localUri => setViewerUri(localUri)}
        />
        <AttachmentFile
          fileId={a.key}
          name={a.name}
          mime={a.mime}
          serverUrl={cfg.serverUrl}
          token={cfg.token}
          label="下载原图"
        />
      </View>
    ) : a.isVideo && a.needsAuth && Platform.OS !== 'web' ? (
      <AuthedVideo
        key={`${attachmentCacheScope(cfg.serverUrl, cfg.token)}-${a.key}`}
        fileId={a.key}
        name={a.name}
        mime={a.mime}
        size={a.size}
        serverUrl={cfg.serverUrl}
        token={cfg.token}
      />
    ) : a.needsAuth && Platform.OS !== 'web' ? (
      <AttachmentFile
        key={`${attachmentCacheScope(cfg.serverUrl, cfg.token)}-${a.key}`}
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

  const doSend = async (
    content: string,
    localId: string,
    imgs: PickedImage[] = [],
    priority: TaskPriority = 'normal',
  ) => {
    const startedConversationKey = conversationKeyFor;
    const startedAlias = alias;
    const mayTouchVisibleState = () => mayApplySendResult(
      startedConversationKey,
      visibleConversationKeyRef.current,
      mountedRef.current,
    );
    const reconcileStartedConversation = async () => {
      const data = await fetchTasks(cfg, { to_name: startedAlias, limit: limitRef.current });
      const fetched = data.tasks ?? [];
      const confirmed = new Set(confirmedOutboxIds(outboxForAlias(startedAlias), fetched));
      confirmed.forEach(outboxRemove);
      conversations.put(startedConversationKey, fetched);
    };
    try {
      let attachments: TaskAttachment[] | undefined;
      let outgoing = content;
      if (imgs.length) {
        const uploaded = await Promise.all(imgs.map(async img => ({ img, up: await uploadImage(cfg, img) })));
        attachments = uploaded.map(({ img, up }) => toTaskAttachment(img, up));
        outgoing = `${content}${uploaded.map(({ img, up }) => attachmentTextHint(img, up)).join('')}`;
      }
      const response = await sendTask(cfg, alias, outgoing, attachments, priority, dashboardRequestIdForLocalId(localId));
      imgs.forEach(releaseClipboardAttachment);
      // delivered: drop the echo, the server copy arrives with reload.
      // 🔴 outbox 唯一删除路径=此处(sendTask 确认成功)。
      outboxRemove(localId);
      if (!mayTouchVisibleState()) {
        // The main window reuses ChatScreen while switching aliases. The old
        // send succeeded, but its completion belongs to the old cache only.
        try { await reconcileStartedConversation(); } catch { /* next open refreshes it */ }
        return;
      }
      setSendConfirmation(sendConfirmationFromResponse(response));
      setMessages(prev => prev.filter(t => t._localId !== localId));
      await load(limitRef.current);
    } catch {
      // Timeout is not proof that the write failed. The Hub may have committed
      // the task and lost only the HTTP acknowledgement; reconcile before a
      // red retry action can manufacture duplicate work.
      if (!mayTouchVisibleState()) {
        // A late A failure while B is visible is ambiguous, not a reason to
        // paint a retry under B. Reconcile A directly without borrowing B's
        // request token; leave it pending if the Hub is unreachable.
        try { await reconcileStartedConversation(); } catch { /* remain pending */ }
        return;
      }
      const exposeFailure = await shouldExposeSendFailure(
        () => load(limitRef.current),
        () => outboxForAlias(startedAlias).some(entry => entry.id === localId),
      );
      if (!exposeFailure) return;
      outboxMarkFailed(localId); // 盘上也是 failed——杀 app 重开仍可重试
      setMessages(prev =>
        prev.map(t => (t._localId === localId ? { ...t, _pending: false, _failed: true } : t)),
      );
    }
  };

  const submit = async () => {
    const parsed = parseBtwFirstToken(draft);
    if (parsed.kind === 'invalid') {
      Alert.alert('BTW 需要一个问题', parsed.message);
      setBtwLaunch(current => ({ id: (current?.id ?? 0) + 1 }));
      return;
    }
    if (parsed.kind === 'btw') {
      // SideThread owns this prompt from here on. Do not add an optimistic
      // main-chat bubble and never call sendTask as a fallback.
      try {
        const uploaded = await Promise.all(attached.map(item => uploadImage(cfg, item)));
        const attachments = uploaded.map(item => ({ fileId: item.file_id }));
        attached.forEach(releaseClipboardAttachment);
        setDraft('');
        setAttached([]);
        setSendPriority('normal');
        setBtwLaunch(current => ({ id: (current?.id ?? 0) + 1, prompt: parsed.prompt, attachments }));
      } catch (error) {
        Alert.alert('BTW 附件上传失败', error instanceof Error ? error.message : '附件未上传，草稿已保留');
      }
      return;
    }
    const content = parsed.content.trim() || (attached.length ? `[附件] ${attached.map(item => item.fileName).join('、')}` : '');
    if ((!content && !attached.length) || sending) return;
    const imgs = attached;
    const priority = sendPriority;
    setDraft('');
    setAttached([]);
    setSendPriority('normal');
    // Optimistic echo: render the message instantly tagged with a
    // client-only _localId (NOT the server task id, which we don't have
    // yet). doSend drops this echo on success — the subsequent reload brings
    // the real server row — or flags _failed so retry() can resend with the
    // same _localId. The dreq id is both the echo key and the stable Hub
    // correlation id, so retrying this bubble cannot create a new logical send.
    // PR3 判据C:id 跨次启动唯一(重开恢复的旧 local-N 不能和新 id 撞车);
    // 🔴 提交即落盘(网络尝试之前)——发送中被杀,重开后它还在。
    const localId = createDashboardRequestId();
    outboxAdd({ id: localId, alias, content, createdAt: Date.now(), state: 'pending', hadImage: imgs.length > 0, priority });
    setMessages(prev => [
      { content, created_at: new Date().toISOString(), _localId: localId, _pending: true, _imgs: imgs, _priority: priority },
      ...prev,
    ]);
    doSend(content, localId, imgs, priority);
  };

  const retry = (item: ChatItem) => {
    if (!item._localId || !item.content) return;
    const retriedAt = Date.now();
    outboxMarkPending(item._localId, retriedAt); // 重试中被杀照样恢复(仍在盘上)
    setMessages(prev =>
      mergeMessagesNewestFirst(
        prev.map(t => (t._localId === item._localId ? { ...t, created_at: new Date(retriedAt).toISOString(), _pending: true, _failed: false } : t)),
        [],
      ),
    );
    const priority = item._priority ?? outboxForAlias(alias).find(e => e.id === item._localId)?.priority ?? 'normal';
    doSend(item.content, item._localId, item._imgs ?? (item._img ? [item._img] : []), priority);
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
      pickImage().then(img => img && appendAttachment(img));
      return;
    }
    Alert.alert('发送附件', undefined, [
      { text: '图片', onPress: () => pickImage().then(img => img && appendAttachment(img)) },
      { text: '文件', onPress: () => pickDocument().then(f => f && appendAttachment(f)) },
      { text: '取消', style: 'cancel' },
    ]);
  };

  const openBtwComposer = () => {
    setPlusMenuOpen(false);
    setBtwLaunch(current => ({ id: (current?.id ?? 0) + 1 }));
  };

  const exactSideThreadTask = messages.find(message => message.thread_id && message.turn_id);
  const sideThreadScope = exactSideThreadTask?.thread_id && exactSideThreadTask.turn_id
    ? {
      sourceThreadId: exactSideThreadTask.thread_id,
      boundary: { kind: 'through' as const, turnId: exactSideThreadTask.turn_id },
    }
    : undefined;

  const openAttachmentPicker = () => {
    setPlusMenuOpen(false);
    attach();
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      // Edge-to-edge Android ignores adjustResize, so behavior=undefined
      // left the keyboard covering the input (Vincent tg 738). 'padding'
      // works on both platforms under edge-to-edge.
      behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
      onLayout={(event) => { const h = event.nativeEvent.layout.height; rootHeightRef.current = h; setRootHeight(h); }}
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="搜索聊天记录"
          accessibilityHint="只搜当前会话的消息"
          onPress={searchOpen ? closeSearch : openSearch}
          hitSlop={10}
          style={({ pressed }) => [styles.headerAction, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name={searchOpen ? 'close-outline' : 'search-outline'} size={20} color={searchOpen ? colors.accent : colors.textSecondary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="打开 BTW 旁路线程"
          onPress={openBtwComposer}
          hitSlop={8}
          style={({ pressed }) => [styles.btwHeaderButton, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.btwHeaderText}>BTW</Text>
        </Pressable>
        {onOpenNodeSettings ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="查看节点信息"
            accessibilityHint="打开当前节点的只读详细信息"
            onPress={onOpenNodeSettings}
            hitSlop={10}
            style={({ pressed }) => [styles.headerAction, desktop && styles.headerActionWithWindowPin, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="settings-outline" size={20} color={colors.textSecondary} />
            <Text style={styles.headerActionText}>设置</Text>
          </Pressable>
        ) : null}
      </View>

      {searchOpen ? (

        <View style={styles.searchPanel}>

          <View style={styles.searchBar}>

            <Ionicons name="search-outline" size={16} color={colors.textMuted} />

            <TextInput

              ref={searchInputRef}

              value={searchQuery}

              onChangeText={setSearchQuery}

              placeholder="搜索当前会话"

              placeholderTextColor={colors.textMuted}

              style={styles.searchInput}

              autoCapitalize="none"

              autoCorrect={false}

              returnKeyType="search"

              onSubmitEditing={() => stepSearch('older')}

              onKeyPress={(e: any) => {

                const k = e?.nativeEvent?.key;

                if (k === 'Escape') closeSearch();

                else if (k === 'Enter' && e?.nativeEvent?.shiftKey) { e.preventDefault?.(); stepSearch('newer'); }

              }}

              accessibilityLabel="搜索聊天记录输入框"

            />

            <Text style={styles.searchCount}>{matchCountLabel(searchCurrent, searchHits.length)}</Text>

            <Pressable onPress={() => stepSearch('newer')} hitSlop={8} accessibilityLabel="上一条(更新)" disabled={searchHits.length === 0} style={({ pressed }) => [styles.searchNav, pressed && { opacity: 0.6 }]}>

              <Ionicons name="chevron-down-outline" size={18} color={searchHits.length ? colors.text : colors.textMuted} />

            </Pressable>

            <Pressable onPress={() => stepSearch('older')} hitSlop={8} accessibilityLabel="下一条(更早)" disabled={searchHits.length === 0} style={({ pressed }) => [styles.searchNav, pressed && { opacity: 0.6 }]}>

              <Ionicons name="chevron-up-outline" size={18} color={searchHits.length ? colors.text : colors.textMuted} />

            </Pressable>

            <Pressable onPress={closeSearch} hitSlop={8} accessibilityLabel="关闭搜索" style={({ pressed }) => [styles.searchNav, pressed && { opacity: 0.6 }]}>

              <Text style={styles.searchClose}>取消</Text>

            </Pressable>

          </View>

          {searchState === 'idle' ? (

            <Text style={styles.searchHint}>输入关键词,只搜「{alias}」这个会话。Enter 下一条,Shift+Enter 上一条,Esc 关闭。</Text>

          ) : searchState === 'failed' ? (

            <View style={styles.searchStateRow}>

              <Text style={styles.searchHint}>拉取更早的历史失败</Text>

              <Pressable onPress={retrySearchOlder} hitSlop={8}><Text style={styles.searchAction}>重试</Text></Pressable>

            </View>

          ) : searchState === 'loading' ? (

            <View style={styles.searchStateRow}>

              <ActivityIndicator color={colors.textMuted} />

              <Text style={styles.searchHint}>已加载的消息里没有,正在往更早的历史里找…</Text>

            </View>

          ) : searchState === 'empty' ? (

            <Text style={styles.searchHint}>{hasOlder && searchPagesRef.current >= SEARCH_MAX_OLDER_PAGES ? `最近 ${limitRef.current} 条里没有找到;更早的历史请继续上滑后再搜` : '没有找到'}</Text>

          ) : (

            <FlatList

              data={searchHits}

              keyExtractor={h => h.key}

              style={styles.searchResults}

              keyboardShouldPersistTaps="handled"

              renderItem={({ item: h, index: i }) => (

                <Pressable onPress={() => locateHit(i)} style={({ pressed }) => [styles.resultRow, i === searchCurrent && styles.resultRowCurrent, pressed && { opacity: 0.7 }]}>

                  <View style={{ flex: 1 }}>

                    <Text style={styles.resultMeta} numberOfLines={1}>{h.sender ?? '—'}{h.createdAt ? ` · ${formatChatHeader(h.createdAt)}` : ''}</Text>

                    <Text style={styles.resultSnippet} numberOfLines={2}>{h.snippet}</Text>

                  </View>

                  <Pressable onPress={() => locateHit(i)} hitSlop={8} accessibilityLabel="定位到聊天">

                    <Text style={styles.searchAction}>定位</Text>

                  </Pressable>

                </Pressable>

              )}

            />

          )}

        </View>

      ) : null}


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
          onScrollToIndexFailed={info => {
            // 目标还没量到布局:先按平均高度滚过去,再补一次精确定位。
            listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
            setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 }), 120);
          }}
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
            // 会话是按收件人拉的(to_name=alias),发件人是谁得读 from_name ——
            // 网络里任何节点都能派单给这个 alias,一律记成本人会把别人的指令
            // 显示成自己说过的话。
            const sender = resolveSender(item, currentUsername);
            return (
              <View style={[styles.bubbleWrap, isHighlighted(msgKey(item), highlight, Date.now()) && styles.bubbleHighlight]}>
                {showHeader && item.created_at ? (
                  <Text style={styles.timeHeader}>{formatChatHeader(item.created_at)}</Text>
                ) : null}
                <View style={[styles.messageRow, styles.sentRow]}>
                  <View style={[styles.messageContent, styles.sentContent]}>
                    <Text style={[styles.messageAuthor, styles.sentAuthor]} numberOfLines={1}>
                      {sender.alias}
                    </Text>
                    <Pressable
                      {...(desktop ? ({ dataSet: { messageKey: msgKey(item), messagePart: 'sent' } } as any) : {})}
                      onLongPress={() => setMenuFor({ item, text: item.content ?? '' })}
                      delayLongPress={300}
                      style={({ pressed }) => [styles.bubblePressable, pressed && { opacity: 0.7 }]}
                    >
                      <View style={styles.bubble}>
                        <MarkdownMessage>{cleanAttachmentDebugText(item.content || '—')}</MarkdownMessage>
                        {sentAttachmentViews(item, cfg.serverUrl).map(renderAttachment)}
                      </View>
                    </Pressable>
                  </View>
                  <AliasAvatar alias={sender.alias} size={36} />
                </View>
                {item.result || item.reply ? (
                  <View style={[styles.messageRow, styles.replyRow]}>
                    <AliasAvatar alias={alias} size={36} />
                    <View style={styles.messageContent}>
                      <Text style={styles.messageAuthor} numberOfLines={1}>{alias}</Text>
                      <Pressable
                        {...(desktop ? ({ dataSet: { messageKey: msgKey(item), messagePart: 'reply' } } as any) : {})}
                        onLongPress={() => setMenuFor({ item, text: item.result ?? item.reply ?? '' })}
                        delayLongPress={300}
                      >
                        <View style={[styles.bubble, styles.replyBubble]}>
                          <MarkdownMessage>{cleanAttachmentDebugText(item.result ?? item.reply ?? '')}</MarkdownMessage>
                          {replyAttachmentViews(item, cfg.serverUrl).map(renderAttachment)}
                        </View>
                      </Pressable>
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
                ) : sender.isCurrentUser && !(item.result ?? item.reply) ? (
                  // PR3 要求2:「送达了但对方没回」≠「未送达」——前者灰勾不可点(不用重试),
                  // 后者红字带重试。服务器行(无 _localId 标志)= hub 已收 = 已送达。
                  // 只对自己发出的消息成立:别人派来的任务标「已送达」等于说这条是你发的。
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

      {attached.length ? (
        <View style={styles.attachPreviewList}>
          {attached.map((item, index) => (
            <View key={item.uri} style={styles.attachPreview}>
              <Text style={styles.attachName} numberOfLines={1}>📎 {item.fileName}</Text>
              <Text style={styles.attachIndex}>{index + 1}</Text>
              <Pressable onPress={() => removeAttachment(item.uri)} hitSlop={10}>
                <Text style={styles.attachRemove}>✕</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      {sendNotice ? (
        <ActualRecipientNotice notice={sendNotice} onDismiss={() => setSendConfirmation(null)} />
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
                if (menuFor) setDraft((d) => applyQuote(d, menuFor.text));
                setMenuFor(null);
              }}
            >
              <Text style={styles.actionText}>引用</Text>
            </Pressable>
            <View style={styles.actionSep} />
            <Pressable
              style={({ pressed }) => [styles.actionItem, pressed && styles.actionItemPressed]}
              onPress={() => menuFor && openForwardPicker(menuFor)}
            >
              <Text style={styles.actionText}>转发</Text>
            </Pressable>
            <View style={styles.actionSep} />
            <Pressable
              style={({ pressed }) => [styles.actionItem, pressed && styles.actionItemPressed]}
              onPress={() => {
                if (menuFor) setMessages((prev) => removeMessage(prev, menuFor.item));
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

      <Modal visible={!!forwardFor && forwardUiOwner === conversationKeyFor} transparent animationType="fade" onRequestClose={() => setForwardFor(null)}>
        <Pressable style={styles.forwardBackdrop} onPress={() => setForwardFor(null)}>
          <Pressable style={styles.forwardPanel} onPress={() => {}}>
            <Text style={styles.forwardTitle}>转发给</Text>
            {forwardAmbiguous ? <Text style={styles.forwardEmpty}>结果待确认，请勿重复转发</Text> : null}
            {forwardAmbiguous && forwardOperationKeyRef.current ? (
              <Pressable onPress={() => Alert.alert('清除待确认状态？', '这不会重新转发，也不代表消息未送达。', [
                { text: '取消', style: 'cancel' },
                { text: '仅清除状态', onPress: () => { resetForwardWithoutResend(forwardOperationKeyRef.current!); setForwardAmbiguous(false); } },
              ])}><Text style={styles.forwardEmpty}>仅清除待确认状态（不会重发）</Text></Pressable>
            ) : null}
            <TextInput value={forwardQuery} onChangeText={setForwardQuery} placeholder="搜索 agent…" placeholderTextColor={colors.textMuted} style={styles.forwardSearch} />
            <FlatList
              style={styles.forwardList}
              data={forwardTargets.filter(target => target.alias.toLowerCase().includes(forwardQuery.trim().toLowerCase()))}
              keyExtractor={target => target.alias}
              renderItem={({ item: target }) => (
                <Pressable style={({ pressed }) => [styles.forwardTarget, pressed && styles.actionItemPressed]} onPress={() => forwardMessage(target.alias)} disabled={!!forwardingTo || forwardAmbiguous}>
                  <AliasAvatar alias={target.alias} size={32} />
                  <Text style={styles.forwardAlias} numberOfLines={1}>{target.alias}</Text>
                  {forwardingTo === target.alias ? <ActivityIndicator size="small" color={colors.accent} /> : null}
                </Pressable>
              )}
              ListEmptyComponent={<Text style={styles.forwardEmpty}>没有匹配的 agent</Text>}
            />
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={plusMenuOpen} transparent animationType="fade" onRequestClose={() => setPlusMenuOpen(false)}>
        <Pressable style={styles.plusMenuBackdrop} onPress={() => setPlusMenuOpen(false)}>
          <Pressable style={[styles.plusMenu, desktop ? styles.plusMenuDesktop : styles.plusMenuMobile]} onPress={() => {}}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="新建 BTW 旁路线程"
              style={({ pressed }) => [styles.plusMenuItem, pressed && styles.actionItemPressed]}
              onPress={openBtwComposer}
            >
              <View style={styles.plusMenuIcon}><Text style={styles.plusMenuBtw}>BTW</Text></View>
              <View style={styles.plusMenuCopy}>
                <Text style={styles.plusMenuTitle}>旁路提问</Text>
                <Text style={styles.plusMenuHint}>不打断、不 steer 当前主任务</Text>
              </View>
            </Pressable>
            {ATTACH_ENABLED ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="添加附件"
                style={({ pressed }) => [styles.plusMenuItem, pressed && styles.actionItemPressed]}
                onPress={openAttachmentPicker}
              >
                <View style={styles.plusMenuIcon}><Ionicons name="attach" size={21} color={colors.textSecondary} /></View>
                <View style={styles.plusMenuCopy}>
                  <Text style={styles.plusMenuTitle}>添加附件</Text>
                  <Text style={styles.plusMenuHint}>添加到主会话草稿</Text>
                </View>
              </Pressable>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      {desktop ? (
        <>
        <View
          {...composerPan.panHandlers}
          accessibilityRole="adjustable"
          accessibilityLabel="拖动调整输入框高度"
          style={styles.composerDivider}
        >
          <View style={styles.composerDividerGrip} />
        </View>
        <View style={[styles.desktopComposer, { height: composerHeight, minHeight: undefined, maxHeight: undefined }]}>
          <TextInput
            ref={mainComposerRef}
            style={[styles.desktopInput, { maxHeight: inputMaxHeight(composerHeight) }]}
            placeholder={`Message ${alias}…`}
            placeholderTextColor={colors.textMuted}
            value={draft}
            onChangeText={setDraft}
            onKeyPress={(event) => {
              const key = event.nativeEvent as typeof event.nativeEvent & { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; isComposing?: boolean; keyCode?: number; which?: number };
              if (!shouldSendOnEnter(key)) return;
              event.preventDefault?.();
              void submit();
            }}
            multiline
          />
          <View style={styles.desktopToolbar}>
            <Pressable accessibilityLabel="更多发送方式" style={({ pressed }) => [styles.desktopToolButton, pressed && { opacity: 0.6 }]} onPress={() => setPlusMenuOpen(true)} hitSlop={6}>
                <Ionicons name="add-circle-outline" size={24} color={colors.textSecondary} />
            </Pressable>
            <View style={styles.desktopToolbarRight}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={sendPriority === 'high' ? '取消优先发送' : '设为优先发送'}
                accessibilityState={{ selected: sendPriority === 'high' }}
                onPress={() => setSendPriority(value => value === 'high' ? 'normal' : 'high')}
                style={({ pressed }) => [styles.priorityButton, sendPriority === 'high' && styles.priorityButtonActive, pressed && { opacity: 0.7 }]}
              >
                <Text style={[styles.priorityButtonText, sendPriority === 'high' && styles.priorityButtonTextActive]}>⚡ 优先</Text>
              </Pressable>
              <Text style={styles.shortcutHint}>Enter 发送 · Shift/Ctrl/⌘+Enter 换行</Text>
              <Pressable
                style={({ pressed }) => [styles.desktopSend, !canSend(draft, attached.length > 0, sending) && styles.desktopSendDisabled, pressed && { opacity: 0.7 }]}
                onPress={() => void submit()}
                disabled={!canSend(draft, attached.length > 0, sending)}
              >
                <Text style={[styles.desktopSendText, !canSend(draft, attached.length > 0, sending) && styles.sendTextDisabled]}>发送</Text>
              </Pressable>
            </View>
          </View>
        </View>
        </>
      ) : (
      <View style={[styles.inputRow, { paddingBottom: spacing.md + composerInset }]}>
        <Pressable
          accessibilityLabel="更多发送方式"
          style={({ pressed }) => [styles.attachBtn, pressed && { opacity: 0.6 }]}
          onPress={() => setPlusMenuOpen(true)}
          hitSlop={6}
        >
          <Text style={styles.attachBtnText}>＋</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={sendPriority === 'high' ? '取消优先发送' : '设为优先发送'}
          accessibilityState={{ selected: sendPriority === 'high' }}
          onPress={() => setSendPriority(value => value === 'high' ? 'normal' : 'high')}
          style={({ pressed }) => [styles.mobilePriorityButton, sendPriority === 'high' && styles.priorityButtonActive, pressed && { opacity: 0.6 }]}
        >
          <Text style={[styles.mobilePriorityText, sendPriority === 'high' && styles.priorityButtonTextActive]}>⚡</Text>
        </Pressable>
        <TextInput
          ref={mainComposerRef}
          style={styles.input}
          placeholder={`Message ${alias}…`}
          placeholderTextColor={colors.textMuted}
          value={draft}
          onChangeText={setDraft}
          onKeyPress={(event) => {
            if (!desktop) return;
            const key = event.nativeEvent as typeof event.nativeEvent & {
              ctrlKey?: boolean;
              metaKey?: boolean;
              shiftKey?: boolean;
              isComposing?: boolean;
              keyCode?: number;
              which?: number;
            };
            if (!shouldSendOnEnter(key)) return;
            event.preventDefault?.();
            void submit();
          }}
          multiline
        />
        <Pressable
          style={({ pressed }) => [
            styles.send,
            !canSend(draft, attached.length > 0, sending) && styles.sendDisabled,
            pressed && { opacity: 0.6 },
          ]}
          onPress={() => void submit()}
          disabled={!canSend(draft, attached.length > 0, sending)}
        >
          <Text style={[styles.sendText, !canSend(draft, attached.length > 0, sending) && styles.sendTextDisabled]}>↑</Text>
        </Pressable>
      </View>
      )}
      <SideThreadDrawer
        cfg={cfg}
        alias={alias}
        desktop={desktop}
        launch={btwLaunch}
        scope={sideThreadScope}
        restoreFocusRef={mainComposerRef}
      />
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
    backgroundColor: colors.card,
  },
  back: { color: colors.accent, fontSize: 28, lineHeight: 30, paddingRight: spacing.sm },
  title: { color: colors.text, fontSize: 16, fontWeight: '600' },
  subtitle: { color: colors.running, fontSize: 11, marginTop: 1 },
  headerAction: {
    minWidth: 58,
    height: 34,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    gap: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActionText: { color: colors.textSecondary, fontSize: 12 },
  // DesktopWindowPin owns the top-right 34px. Reserve a separate hit target
  // instead of letting its absolute z-index cover this action.
  headerActionWithWindowPin: { marginRight: 42 },
  btwHeaderButton: { height: 28, minWidth: 42, paddingHorizontal: spacing.sm, borderWidth: 1, borderColor: colors.accent, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  btwHeaderText: { color: colors.accent, fontSize: 10, fontWeight: '800' },
  beginning: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginVertical: spacing.md,
  },
  bubbleWrap: { marginBottom: spacing.md, gap: spacing.xs },
  // app#166 —— 搜索定位后的临时高亮(2 s)
  bubbleHighlight: { backgroundColor: colors.accent + '22', borderRadius: 12, marginHorizontal: -spacing.xs, paddingHorizontal: spacing.xs },
  searchPanel: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: colors.card, maxHeight: 320 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  searchInput: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 6, paddingHorizontal: spacing.sm, backgroundColor: colors.bg, borderRadius: 8 },
  searchCount: { color: colors.textMuted, fontSize: 12, minWidth: 36, textAlign: 'center' },
  searchNav: { paddingHorizontal: 4, paddingVertical: 4 },
  searchClose: { color: colors.accent, fontSize: 14 },
  searchHint: { color: colors.textMuted, fontSize: 12, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, flexShrink: 1 },
  searchStateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  searchAction: { color: colors.accent, fontSize: 13, paddingHorizontal: spacing.sm },
  searchResults: { maxHeight: 240 },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  resultRowCurrent: { backgroundColor: colors.accent + '14' },
  resultMeta: { color: colors.textMuted, fontSize: 11, marginBottom: 2 },
  resultSnippet: { color: colors.text, fontSize: 13 },
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
    borderRadius: 8,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  replyBubble: { alignSelf: 'flex-start', maxWidth: '85%', flexShrink: 1, backgroundColor: colors.card },
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
  attachmentImage: { alignItems: 'flex-start' },
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
  plusMenuBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.38)', justifyContent: 'flex-end' },
  plusMenu: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, overflow: 'hidden' },
  plusMenuDesktop: { width: 320, marginLeft: spacing.lg, marginBottom: 164, borderRadius: 12 },
  plusMenuMobile: { width: '100%', borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: spacing.xl },
  plusMenuItem: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  plusMenuIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.inputBg, alignItems: 'center', justifyContent: 'center' },
  plusMenuBtw: { color: colors.accent, fontSize: 9, fontWeight: '800' },
  plusMenuCopy: { flex: 1, minWidth: 0 },
  plusMenuTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  plusMenuHint: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  forwardBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.38)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  forwardPanel: { width: 360, maxWidth: '92%', maxHeight: 520, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: spacing.lg },
  forwardTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: spacing.md },
  forwardSearch: { color: colors.text, backgroundColor: colors.inputBg, borderRadius: 9, paddingHorizontal: spacing.md, paddingVertical: 10, marginBottom: spacing.sm },
  forwardList: { maxHeight: 400 },
  forwardTarget: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.sm, borderRadius: 9 },
  forwardAlias: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14, fontWeight: '600' },
  forwardEmpty: { color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.xl },
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
  attachPreviewList: { maxHeight: 112, paddingVertical: spacing.xs },
  attachPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 3,
  },
  attachName: { color: colors.textSecondary, fontSize: 12, flexShrink: 1 },
  attachIndex: { color: colors.textMuted, fontSize: 10, marginLeft: 'auto' },
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
  composerDivider: {
    height: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    cursor: 'ns-resize',
    // 分隔条本身不可选(拖拽期间整页禁选由 lockDocumentSelection 负责)。
    userSelect: 'none',
  } as any,
  composerDividerGrip: { width: 36, height: 3, borderRadius: 2, backgroundColor: colors.border },
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
  priorityButton: { height: 28, borderRadius: 5, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  priorityButtonActive: { borderColor: colors.failed, backgroundColor: colors.inputBg },
  priorityButtonText: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  priorityButtonTextActive: { color: colors.failed },
  mobilePriorityButton: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  mobilePriorityText: { color: colors.textMuted, fontSize: 15 },
  shortcutHint: { color: colors.textMuted, fontSize: 10 },
  desktopSend: { minWidth: 64, height: 32, borderRadius: 5, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  desktopSendDisabled: { backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border },
  desktopSendText: { color: colors.onAccent, fontSize: 13, fontWeight: '600' },
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
