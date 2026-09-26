import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, ActivityIndicator, Alert, BackHandler, FlatList, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StatusBar, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from './icons';
import * as Clipboard from 'expo-clipboard';
import AliasAvatar from './AliasAvatar';
import AttachmentFileDesktop from './AttachmentFileDesktop';
import AuthedThumb, { AttachmentFile, AuthedVideo, mimeFromName } from './AuthedThumb';
import AuthedWebThumb from './AuthedWebThumb';
import { ackAgentMessages, ackUserMessages, createDashboardRequestId, dashboardRequestIdForLocalId, fetchStatus, fetchTasks, fetchUserMessages, sendTask, HubConfig, HubTask, Session, TaskAttachment, TaskPriority } from './api';
import { proactiveItemsForAgent } from './proactive-messages';
import { replyQuoteFor } from './reply-quote';
import { outboxAdd, outboxForAlias, outboxMarkFailed, outboxMarkPending, outboxRemove } from './outbox';
import { mayApplySendResult, shouldExposeSendFailure } from './send-reconciliation';
import { conversationKey, conversationScope, createConversationRequestGate, createConversationStore } from './conversation-store';
import { resolveSender } from './chat-sender';
import { keyboardAvoidEnabled, useKeyboardVisible } from './keyboard-visibility';
import { nextIdentityRetryDelay } from './identity-retry';
import { COMPOSER_HEIGHT_DEFAULT, clampComposerHeight, composerDragHandlers, inputMaxHeight, loadComposerHeight, lockDocumentSelection, saveComposerHeight } from './composer-resize';
import {
  ATTACH_ENABLED,
  attachmentTextHint,
  pickCameraPhoto,
  pickDocument,
  pickImages,
  prepareForUpload,
  uploadImage,
  toTaskAttachment,
  PickedImage,
} from './attach';
import { attachmentFromClipboard, isTauriDesktop, releaseClipboardAttachment } from './clipboard-attachment';
import { addToDraft, draftCountLabel, draftImageCount, isDraftImage, MAX_DRAFT_IMAGES, oversizeMessage, remainingImageSlots, removeFromDraft, sendBlocker, willCompressBeforeUpload } from './image-draft';
import { createUploadMemo, removeAttachmentAt, runUploadQueue, UPLOAD_CONCURRENCY, uploadFailureSummary, withUploadState, type UploadState } from './upload-queue';
import type { UploadedFile } from './attach';
import { colors, onThemeChange, radius, spacing } from './theme';
import { ds } from './ui-scale';
import { formatChatHeader, shouldShowTimeHeader } from './time';
import { chooseHeaderLayout, NAME_MIN_WIDTH, type HeaderActionKey } from './chat-header-layout';
import { echoSupersededByFetched } from './chat-echo';
import { messageMenuGroups, selectionBarActions, type MessageMenuKey } from './message-menu-model';
import { agentStatusLabel, buildQuote, compactQuoteText, confirmedOutboxIds, copyTextOf, copiedToastVisible, COPIED_TOAST_MS, parseQuoted, quoteLabel, type QuoteRef, mergeMessagesNewestFirst, msgKey, removeMessage, shouldShowJumpPill, nextUnread, jumpPillLabel, canSend, shouldSendOnEnter } from './chat-actions';
import type { NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { usePoll } from './usePoll';
import { chatSearchState, isHighlighted, isStaleSearch, matchCountLabel, searchItems, shouldLoadOlderForSearch, stepHit, type SearchHit } from './chat-search';
import { retryUnreadPersistFromPoll } from './conversation-unread-persist';
import { dispatchUnread, hubHasAgentUnread, markAgentRepliesSeen, markAgentServerUnreadCleared, unackedIdsForAgent } from './unread-store';
import { ackAgentUnread } from './agent-ack';
import { appFetch } from './app-fetch';
import MarkdownMessage from './MarkdownMessage';
import SelectTextSheet from './SelectTextSheet';
import ImageViewer from './ImageViewer';
import { openGallery, viewerImageFor, type ViewerImage, type ViewerState } from './image-viewer-model';
import { selectedTextWithin } from './message-plain-text';
import { cleanAttachmentDebugText, hideGridImageLines, parseAttachmentRefs, parseMetaAttachmentRefs, parseMetaReplyAttachmentRefs } from './attachment-display';
import { attachmentCacheScope } from './attach-download';
import ActualRecipientNotice from './ActualRecipientNotice';
import { sendConfirmationFromResponse, sendNoticeFor, type SendConfirmation } from './actual-recipient';
import { beginForward, confirmForward, markForwardAmbiguous, mayProjectForward, resetForwardWithoutResend } from './forward-controller';
import { parseBtwFirstToken } from './btw-command';
import { SHOW_BOLT_ENTRY, SHOW_BTW_ENTRY } from './chat-entry-flags';
import { layoutGeneration, releaseOnUnmount, takeHandoff } from './layout-handoff';
import SideThreadDrawer, { type SideThreadLaunch } from './SideThreadDrawer';
import { nextPlusPanel, plusPanelHeight, plusPanelItems, type PlusItemKey, type PlusPanelEvent } from './composer-plus-panel';
import { useVoiceInput } from './useVoiceInput';
import { insertRecognized, toggleComposerInputMode, type ComposerInputMode } from './voice-input-model';
import { ComposerModeToggle, VoiceHoldBar, VoiceMicButton, VoiceRecordingOverlay, VoiceSettingsPrompt } from './VoiceInputUI';
import { composerLineCount, composerRightSlot, nextFullEditor, shouldShowExpand, type FullEditorEvent } from './composer-row-layout';
import { ComposerExpandButton, ComposerFullscreenEditor, ComposerRightSlot } from './ComposerRowParts';
import { loadComposerInputMode, saveComposerInputMode } from './voice-prefs';

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
  /** 多图发送:与 _imgs 同序的逐张上传状态(queued/uploading/done/failed)。 */
  _uploads?: UploadState[];
  /** 有附件没传上时的汇总;此时整条不发,等用户重试或移除失败的那几张。 */
  _uploadError?: string;
  /** 发送时的「原图」开关;重试沿用它。 */
  _original?: boolean;
  /** PR3 review①:恢复自 outbox 且原带图片——说明文案走这个标志单独渲染,
   *  🔴 绝不拼进 content:content 是「要发出去的字」,注解是「给用户看的字」,
   *  共用一个字段迟早串(重试会把注解原样发给对方 agent)。 */
  _restoredNoImage?: boolean;
  _priority?: 'high' | 'normal';
  /** app#160:Agent 主动发给用户的消息(user_inbox),只有回复气泡、没有发送气泡。 */
  _proactive?: boolean;
  _severity?: string;
  /** 2026-09-16:发送成功后本地回显不再立刻撤掉(慢链路上会「吞」几秒),而是记下 hub 返回的
   *  task_id,等轮询把同 id 的服务器行拉回来再让位;没拿到 id 时按内容+时间对账(confirmedOutboxIds)。 */
  _confirmedTaskId?: string;
};

// selectedText:桌面端右键时气泡里已有的鼠标选区(只在这个气泡内才算),菜单据此给「复制选中内容」。
type MessageSelection = { item: ChatItem; text: string; author?: string; selectedText?: string };

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
  /** Local echo only: index into the item's _imgs (upload state lookup). */
  localIndex?: number;
}

// 重试不重传:已传上去的那几张按 (hub, uri, 原图档) 记住。
const uploadMemo = createUploadMemo<{ img: PickedImage; up: UploadedFile }>();

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
    return localAttachments.map((img, localIndex) => ({
      localIndex,
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
  /** app#168(手机端):会话置顶开关;桌面端用窗口置顶 + 列表长按,不传。 */
  pinned?: boolean;
  onTogglePin?: () => void;
  /** 0.2.107(手机端):这个 agent 的「消息免打扰」—— 不弹系统通知,消息照收。 */
  muted?: boolean;
  onToggleMute?: () => void;
  /** Android two-pane: the conversation sits next to the list, so no back chevron. */
  hideBack?: boolean;
  /** 语音输入未配置时「去设置」跳到 设置 → 语音输入。不传(独立聊天窗口)就只提示位置。 */
  onOpenVoiceSettings?: () => void;
}

// Module level on purpose: the cache has to outlive a screen unmount, or
// returning to a conversation is a blank list and a fetch all over again.
const conversations = createConversationStore<ChatItem>();

export const clearChatConversationCache = (profileId?: string, serverUrl = ''): void => {
  conversations.clearScope(conversationScope(profileId, serverUrl));
};

export default function ChatScreen({ cfg, alias, onBack, desktop = false, onOpenNodeSettings, pinned = false, onTogglePin, muted = false, onToggleMute, hideBack = false, onOpenVoiceSettings }: Props) {
  // Android edge-to-edge draws the composer under the gesture bar (same
  // class of bug as the tg 802 tab bar) — pad by the real bottom inset.
  const insets = useSafeAreaInsets();
  const composerInset = Platform.OS === 'android' ? insets.bottom : 0;
  const [messages, setMessages] = useState<ChatItem[]>([]);
  // 回复引用条要按 task_id 找到被回的那条(主动消息的 in_reply_to)
  const byTaskId = useMemo(() => new Map(messages.map(m => [msgKey(m), m] as const)), [messages]);
  const [currentUsername, setCurrentUsername] = useState('我');
  const [loaded, setLoaded] = useState(false);
  const [conversationReady, setConversationReady] = useState(false);
  const [hasOlder, setHasOlder] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState('');
  // Fold/unfold remounts this screen (phone stack ⇄ two-pane); carry the unsent
  // draft across that remount only. Ordinary back/leave still drops it, as before.
  const draftHandoffKey = `chatDraft:${cfg.profileId ?? cfg.serverUrl}:${alias}`;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useLayoutEffect(() => {
    const mountedGeneration = layoutGeneration();
    const handed = takeHandoff<string>(draftHandoffKey);
    if (handed) setDraft(handed);
    return () => releaseOnUnmount(draftHandoffKey, draftRef.current, mountedGeneration);
  }, [draftHandoffKey]);
  const [sendPriority, setSendPriority] = useState<'high' | 'normal'>('normal');
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [btwLaunch, setBtwLaunch] = useState<SideThreadLaunch>();
  const mainComposerRef = useRef<TextInput>(null);
  // app#237 —— 桌面端输入区高度可拖拽:根容器高度决定上界(消息区至少留 200px),
  // 值全局持久化(切会话 / 重启保持)。分隔条在输入区上沿,向上拖变高。
  const [rootHeight, setRootHeight] = useState(0);
  const keyboardVisible = useKeyboardVisible(Keyboard, Platform.OS);
  // 「＋」 panel (composer-plus-panel.ts). Mobile: inline panel under the input row,
  // sharing the keyboard's slot. Desktop: the small popover Modal. One level either way.
  const plusOpenRef = useRef(plusMenuOpen);
  plusOpenRef.current = plusMenuOpen;
  const lastKeyboardHeightRef = useRef<number | undefined>(undefined);
  const plusEvent = (event: PlusPanelEvent): boolean => {
    const t = nextPlusPanel(plusOpenRef.current, event);
    plusOpenRef.current = t.open;
    if (t.dismissKeyboard && !desktop) {
      mainComposerRef.current?.blur();
      Keyboard.dismiss();
    }
    setPlusMenuOpen(t.open);
    return t.handled;
  };
  // Keyboard up (tap on the input, IME restore, …) → panel down: they never stack.
  useEffect(() => {
    if (keyboardVisible) plusEvent('keyboardShown');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyboardVisible]);
  // Remember the real IME height so the panel occupies the same slot (WeChat).
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Keyboard.addListener('keyboardDidShow', (e: any) => {
      const h = e?.endCoordinates?.height;
      if (typeof h === 'number' && h > 0) lastKeyboardHeightRef.current = h;
    });
    return () => sub.remove();
  }, []);
  // Android back closes the panel before it leaves the chat.
  useEffect(() => {
    if (!plusMenuOpen || desktop || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => plusEvent('back'));
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plusMenuOpen, desktop]);
  // Switching conversation (two-pane sidebar) never carries an open panel over.
  useEffect(() => {
    plusEvent('conversationChanged');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alias]);
  const { height: plusWindowHeight, width: headerWindowWidth } = useWindowDimensions();
  // Chat header: the name gets priority over the actions (0.2.107 folded
  // Xiaomi showed 「···」 for the name). Sized from the header's own width —
  // the two-pane / desktop detail pane is narrower than the window.
  const [headerWidth, setHeaderWidth] = useState(0);
  const [headerMoreOpen, setHeaderMoreOpen] = useState(false);
  const headerActionKeys: HeaderActionKey[] = [
    'search',
    ...(SHOW_BTW_ENTRY ? (['btw'] as const) : []),
    ...(onToggleMute ? (['mute'] as const) : []),
    ...(onTogglePin ? (['pin'] as const) : []),
    ...(onOpenNodeSettings ? (['settings'] as const) : []),
  ];
  const headerLayout = chooseHeaderLayout({
    width: headerWidth || headerWindowWidth,
    hasBack: !desktop && !hideBack,
    desktop,
    actions: headerActionKeys,
  });
  const headerShows = (key: HeaderActionKey) => headerLayout.inline.includes(key);
  const headerActionStyle = headerLayout.mode === 'full' ? styles.headerAction : styles.headerActionCompact;
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
        // app#160:同一次轮询顺带取 Agent 主动发给用户的消息(user_inbox),与任务并行;它失败不影响任务行。
        const userMessagesPromise = fetchUserMessages(cfg, 200).catch(() => ({ messages: [] as any[] }));
        const data = await fetchTasks(cfg, { to_name: alias, limit });
        const userMessages = await userMessagesPromise;
        // The await is where the conversation can change underneath us. Every
        // line below writes to screen state, so nothing may run for an answer
        // that is no longer the one being waited for — that is the whole bug.
        const fetched = data.tasks ?? [];
        const proactive = proactiveItemsForAgent(userMessages.messages as any, alias, cfg.username);
        if (!requestGate.isCurrent(token) || !mountedRef.current) {
          conversations.put(token.key, [...fetched, ...proactive]);
          return;
        }
        if (fetched.length < limit) setHasOlder(false);
        // Hub returns newest-first, which matches inverted-list order. Reconcile
        // accepted retries before merging local echoes into that same timeline.
        const confirmed = new Set(confirmedOutboxIds(outboxForAlias(alias), fetched));
        confirmed.forEach(outboxRemove);
        setMessages(prev => {
          const merged = mergeMessagesNewestFirst(
            prev.filter(t => t._localId && !confirmed.has(t._localId) && !echoSupersededByFetched(t, fetched)),
            [...fetched, ...proactive],
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
    // 2026-09-17 Vincent:身份只查一次,走 RELAY 隧道那一次失败,整场会话都不知道
    // 「我是谁」——别人派给这个 agent 的任务全按占位身份显示成「我」。改成退避重试。
    let alive = true;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const lookup = () => {
      appFetch(`${cfg.serverUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${cfg.token}` },
      })
        .then(res => res.json())
        .then(data => {
          const username = data?.user?.username;
          if (!alive) return;
          if (typeof username === 'string' && username.trim()) { setCurrentUsername(username.trim()); return; }
          schedule();
        })
        .catch(() => { if (alive) schedule(); });
    };
    const schedule = () => {
      attempt += 1;
      timer = setTimeout(lookup, nextIdentityRetryDelay(attempt));
    };
    lookup();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [cfg.serverUrl, cfg.token]);

  const loadOlder = async () => {
    if (loadingOlder || !hasOlder || !loaded) return;
    setLoadingOlder(true);
    limitRef.current += PAGE;
    await load(limitRef.current);
    setLoadingOlder(false);
  };

  const [attached, setAttached] = useState<PickedImage[]>([]);
  // 「原图」开关(微信式,默认关)。web/桌面在发送前按它压缩;原生端在选图时按它决定 picker quality。
  const [sendOriginal, setSendOriginal] = useState(false);
  // 草稿区的轻提示(超过 9 张、超过 12MB…),2.5s 自动消失。
  const [composerNotice, setComposerNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!composerNotice) return;
    const timer = setTimeout(() => setComposerNotice(null), 2500);
    return () => clearTimeout(timer);
  }, [composerNotice]);
  // 手机 / 双栏的输入方式(微信式):键盘,或整条「按住 说话」。每台设备记住用户**点切换**选的那个;
  // 识别完回到键盘是这一句的临时状态(文字要给人改),不写回偏好 —— 下次进来还是用户选的语音模式。
  const [inputMode, setInputMode] = useState<ComposerInputMode>('keyboard');
  const focusAfterInsertRef = useRef(false);
  useEffect(() => { void loadComposerInputMode().then(setInputMode).catch(() => {}); }, []);
  // 语音输入(按住说话):识别结果接到草稿后面,不自动发送,切回键盘让用户改完再发。
  const voice = useVoiceInput({
    onInsert: text => {
      setDraft(d => insertRecognized(d, text));
      if (!desktop) { focusAfterInsertRef.current = true; setInputMode('keyboard'); }
    },
    onNotice: setComposerNotice,
  });
  const voiceMode = !desktop && voice.available && inputMode === 'voice';
  // 微信式输入行(composer-row-layout.ts):输入超过 3 行 → 左上角 ⤢ 打开全屏编辑(同一份草稿)。
  const [fullEditorOpen, setFullEditorOpen] = useState(false);
  const fullEditorEvent = (event: FullEditorEvent): boolean => {
    const t = nextFullEditor(fullEditorOpen, event);
    setFullEditorOpen(t.open);
    return t.handled;
  };
  const [inputContentHeight, setInputContentHeight] = useState<number | undefined>(undefined);
  // Smallest content height seen = one line (the empty input reports it on mount).
  const oneLineHeightRef = useRef<number | undefined>(undefined);
  const onInputContentSize = (h: number) => {
    if (!(h > 0)) return;
    if (oneLineHeightRef.current === undefined || h < oneLineHeightRef.current) oneLineHeightRef.current = h;
    setInputContentHeight(h);
  };
  const inputLines = composerLineCount(draft, inputContentHeight, oneLineHeightRef.current);
  useEffect(() => {
    fullEditorEvent('conversationChanged');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alias]);
  const voiceBusy = voice.state.phase !== 'idle';
  // 识别完切回键盘:TextInput 这一帧才重新挂上,挂上之后再 focus。
  useEffect(() => {
    if (voiceMode || !focusAfterInsertRef.current) return;
    focusAfterInsertRef.current = false;
    const id = setTimeout(() => mainComposerRef.current?.focus(), 30);
    return () => clearTimeout(id);
  }, [voiceMode]);
  const toggleInputMode = () => {
    const next = toggleComposerInputMode(inputMode);
    setInputMode(next);
    void saveComposerInputMode(next);
    if (next === 'voice') {
      if (plusOpenRef.current) plusEvent('toggle'); // ＋ 面板收起
      mainComposerRef.current?.blur();
      Keyboard.dismiss();
    } else {
      focusAfterInsertRef.current = true;
    }
  };
  const attachedRef = useRef<PickedImage[]>([]);
  attachedRef.current = attached;
  // 选择顺序即发送顺序:addToDraft 只追加、不排序;超出 9 张图 / 20 个附件的部分被拒并提示。
  const appendAttachments = useCallback((incoming: PickedImage[]) => {
    if (!incoming.length) return;
    const result = addToDraft(attachedRef.current, incoming);
    result.rejected.forEach(releaseClipboardAttachment);
    attachedRef.current = result.next;
    setAttached(result.next);
    // 超 12MB 的图不在这里弹:原图开关到发送时才定,缩略图上的「超 12MB」和发送拦截会按当时的开关判断。
    if (result.notice) setComposerNotice(result.notice);
  }, []);
  const appendAttachment = useCallback((next: PickedImage) => appendAttachments([next]), [appendAttachments]);
  const removeAttachment = useCallback((uri: string) => {
    const { next, removed } = removeFromDraft(attachedRef.current, uri);
    releaseClipboardAttachment(removed);
    attachedRef.current = next;
    setAttached(next);
  }, []);
  // 原图关闭的图在上传前才压缩(原生 expo-image-manipulator / web canvas),这里不按原始体积拦它。
  const willCompressLater = useCallback(
    (img: PickedImage) => willCompressBeforeUpload(img, { original: sendOriginal, platform: Platform.OS }),
    [sendOriginal],
  );
  // 原图开关在发送时才生效:选图一律取原字节,所以切换对草稿里已有的图同样有效。
  const toggleSendOriginal = () => setSendOriginal(value => !value);

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
  // 图片预览(ImageViewer.tsx):同一条消息的全部图片 + 当前第几张。null = 未打开。
  // 预览层带「下载原图」(多图方格里放不下那一行)。
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const openViewer = (gallery: ViewerImage[], key: string, resolvedUri?: string) =>
    setViewer(openGallery(gallery, key, resolvedUri));
  const viewerEnv = { os: Platform.OS, tauri: !!(globalThis as any).__TAURI_INTERNALS__ };
  const galleryOf = (views: AttachmentView[]): ViewerImage[] =>
    views.map(a => viewerImageFor(a, viewerEnv)).filter((v): v is ViewerImage => !!v);
  const attachmentViewerScope = `${conversationKeyFor}::${attachmentCacheScope(cfg.serverUrl, cfg.token)}`;
  // A blob: URL (Tauri web) and a file: URI (native) both identify bytes that
  // were fetched under the previous credentials. Closing the parent modal is
  // part of the auth boundary; resetting only the child thumbnail would leave
  // those already-open bytes visible after a profile/Hub/conversation switch.
  useEffect(() => setViewer(null), [attachmentViewerScope]);
  // 更像微信·round-2: 长按气泡的动作菜单(引用/删除)。null = 未打开。
  const [menuFor, setMenuFor] = useState<MessageSelection | null>(null);
  // 0.2.78 Vincent:「右键的效果和微信对齐」—— 桌面端菜单落在光标处(微信桌面端就是这样),
  // 触摸端仍是底部 action sheet。null = 用底部 sheet。
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  // 放大阅读:单条消息的全屏可选中视图(我们的代码块很长,气泡里读不完)。
  const [expandFor, setExpandFor] = useState<MessageSelection | null>(null);
  // 选择文本(2026-09-26 Vincent 安卓折叠屏:「只能复制整个的消息…想划选部分段落或句子」):
  // 全屏只读文本,系统选区手柄可跨段落。null = 未打开。
  const [selectTextFor, setSelectTextFor] = useState<MessageSelection | null>(null);
  // 光标定位的菜单要夹在窗口内,否则贴右/贴底时会被切掉。
  const { width: menuWindowWidth, height: menuWindowHeight } = useWindowDimensions();
  // 多选:进入后气泡带复选框,底栏给转发/删除。
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  // 微信式引用:选中「引用」后不往输入框塞文字,而是在输入框上方挂一条引用条(可 ×),发送时拼成
  // 「@作者: 文本」前缀;对方气泡下方渲染成灰色引用条。null = 没在引用。
  const [quote, setQuote] = useState<QuoteRef | null>(null);
  // 复制消息(Vincent 2026-09-16):动作菜单里的「复制」+ 桌面端悬停气泡时右上角的复制按钮。
  // 复制成功后底部居中出一个「已复制」小 pill,1.4s 自动消失。
  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const copyMessage = (text: string) => copyValue(copyTextOf(text));
  // 原样复制(选中内容 / 选择视图的全文):不再过 copyTextOf,那会把以「」开头的选区当引用行剥掉。
  const copyValue = async (value: string) => {
    if (!value) return;
    try {
      await Clipboard.setStringAsync(value);
    } catch {
      // RN Web / 旧 WebView 没有原生剪贴板时退回浏览器 API
      try { await (globalThis as any).navigator?.clipboard?.writeText?.(value); } catch { return; }
    }
    setCopiedAt(Date.now());
  };
  useEffect(() => {
    if (copiedAt === null) return;
    const timer = setTimeout(() => setCopiedAt(null), COPIED_TOAST_MS);
    return () => clearTimeout(timer);
  }, [copiedAt]);
  const [forwardFor, setForwardFor] = useState<MessageSelection | null>(null);
  // 多选转发:一批消息按时间顺序逐条转发。每条仍走各自的 beginForward(操作键含正文哈希),
  // 所以去重/fail-closed 语义与单条完全一致;**第一条失败即停**,剩下的不发。
  const [forwardBatch, setForwardBatch] = useState<MessageSelection[] | null>(null);
  const [forwardProgress, setForwardProgress] = useState<string | null>(null);
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
  // 用 key 找**当前** messages 里的下标(列表可能在结果算出后又长了),滚过去并高亮 2 秒。
  // 搜索定位和回复引用条点击共用。
  const locateKey = (key: string) => {
    const index = messages.findIndex(m => msgKey(m) === key);
    if (index < 0) return;
    listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
    setHighlight({ key, at: Date.now() });
    setTimeout(() => setHighlightTick(t => t + 1), 2100);
  };
  const locateHit = (i: number) => {
    const hit = searchHits[i];
    if (!hit) return;
    setSearchCurrent(i);
    locateKey(hit.key);
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
      const author = part === 'reply' ? alias : resolveSender(item, currentUsername).alias;
      // 微信桌面端的菜单落在光标处,不是屏幕底部。坐标在这里就有,不用再测一次布局。
      const x = typeof event.clientX === 'number' ? event.clientX : null;
      const y = typeof event.clientY === 'number' ? event.clientY : null;
      setMenuAt(x !== null && y !== null ? { x, y } : null);
      // 我们的右键菜单替掉了浏览器自带的「复制」:拖选完再右键,要能只复制选中的那段。
      const selectedText = selectedTextWithin(bubble, (globalThis as any).getSelection?.());
      setMenuFor({ item, text, author, selectedText });
    };
    doc.addEventListener('contextmenu', handleMessageContextMenu, true);
    return () => doc.removeEventListener('contextmenu', handleMessageContextMenu, true);
  }, [desktop, messages]);

  // 菜单/放大阅读:Esc 关闭(桌面端)。微信桌面端也没有「取消」那一行。
  useEffect(() => {
    const doc = (globalThis as any).document;
    if (!desktop || !doc?.addEventListener) return;
    if (!menuFor && !expandFor) return;
    const onKeyDown = (event: any) => {
      if (event.key !== 'Escape') return;
      event.preventDefault?.();
      if (expandFor) setExpandFor(null);
      else setMenuFor(null);
    };
    doc.addEventListener('keydown', onKeyDown);
    return () => doc.removeEventListener('keydown', onKeyDown);
  }, [desktop, menuFor, expandFor]);

  const openForwardPicker = async (selection: MessageSelection, batch?: MessageSelection[]) => {
    setMenuFor(null);
    setForwardFor(selection);
    setForwardBatch(batch && batch.length > 1 ? batch : null);
    setForwardProgress(null);
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
    // 一批消息按时间顺序逐条发。每条各自 beginForward,所以「同一条重复转发」仍然被操作键挡住;
    // 🔴 第一条不确定就停 —— 继续发下去会把「哪一条没确认」埋进一串成功里。
    const queue = forwardBatch ?? [forwardFor];
    forwardingRef.current = true;
    setForwardingTo(target);
    let sent = 0;
    let lastResponse: Awaited<ReturnType<typeof sendTask>> | null = null;
    try {
      for (const selection of queue) {
        const begun = beginForward(startedKey, target, selection.text, createDashboardRequestId);
        forwardOperationKeyRef.current = begun.operation.key;
        if (!begun.started) {
          // 这条已经有一个未完成的转发操作(pending/ambiguous):不重发,停在这里。
          if (mayWrite()) {
            setForwardAmbiguous(true);
            setForwardProgress(queue.length > 1 ? `已转发 ${sent}/${queue.length}，其余未发送` : null);
          }
          return;
        }
        try {
          lastResponse = await sendTask(cfg, target, selection.text, undefined, 'normal', begun.operation.requestId);
          confirmForward(begun.operation.key);
          sent += 1;
        } catch (error) {
          // No public forward reconciliation endpoint currently proves whether an
          // ACK-loss write committed. Fail closed and disable repeat taps.
          markForwardAmbiguous(begun.operation.key);
          if (mayWrite()) {
            setForwardAmbiguous(true);
            setForwardProgress(queue.length > 1 ? `已转发 ${sent}/${queue.length}，其余未发送` : null);
            Alert.alert(
              '转发结果待确认',
              queue.length > 1
                ? `已转发 ${sent}/${queue.length} 条，这一条可能已经送达。为避免重复转发，请先在目标会话确认。`
                : '可能已经送达。为避免重复转发，请先在目标会话确认。',
            );
          }
          return;
        }
      }
      if (mayWrite()) {
        if (lastResponse) setSendConfirmation(sendConfirmationFromResponse(lastResponse));
        setForwardFor(null);
        setForwardBatch(null);
        setForwardProgress(null);
        exitSelectionMode();
      }
    } finally {
      forwardingRef.current = false;
      if (mayWrite()) setForwardingTo(null);
    }
  };

  // ── 菜单动作(0.2.78) ────────────────────────────────────────────────────
  const menuGroups = useMemo(
    () => messageMenuGroups({ hasText: !!menuFor?.text, selectionMode, canForward: true, touch: !desktop, selectedText: menuFor?.selectedText }),
    [menuFor, selectionMode, desktop],
  );
  const onMenuAction = (key: MessageMenuKey) => {
    const selection = menuFor;
    if (!selection) return;
    if (key === 'copy') { setMenuFor(null); void copyMessage(selection.text); return; }
    if (key === 'copySelection') { setMenuFor(null); void copyValue(selection.selectedText ?? ''); return; }
    if (key === 'selectText') { setMenuFor(null); setSelectTextFor(selection); return; }
    if (key === 'quote') {
      setQuote({ author: selection.author, text: compactQuoteText(selection.text) });
      setMenuFor(null);
      mainComposerRef.current?.focus?.();
      return;
    }
    if (key === 'forward') { void openForwardPicker(selection); return; }
    if (key === 'multiSelect') {
      setMenuFor(null);
      setSelectionMode(true);
      setSelectedKeys([msgKey(selection.item)]);
      return;
    }
    if (key === 'expand') { setMenuFor(null); setExpandFor(selection); return; }
    if (key === 'delete') { setMessages(prev => removeMessage(prev, selection.item)); setMenuFor(null); }
  };

  // ── 多选(0.2.78) ────────────────────────────────────────────────────────
  const exitSelectionMode = () => { setSelectionMode(false); setSelectedKeys([]); };
  const toggleSelected = (key: string) =>
    setSelectedKeys(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));
  /** 选中的消息按会话顺序(旧→新)排,转发时才不会把上下文发颠倒。 */
  const selectedSelections = (): MessageSelection[] => {
    const chosen = new Set(selectedKeys);
    return messages
      .filter(item => chosen.has(msgKey(item)))
      .slice()
      .reverse() // messages 是 newest-first(inverted 列表)
      .map(item => ({
        item,
        text: item.content ?? '',
        author: resolveSender(item, currentUsername).alias,
      }))
      .filter(selection => selection.text);
  };
  const onSelectionAction = (key: MessageMenuKey) => {
    const chosen = selectedSelections();
    if (key === 'delete') {
      const keys = new Set(selectedKeys);
      setMessages(prev => prev.filter(item => !keys.has(msgKey(item))));
      exitSelectionMode();
      return;
    }
    if (key === 'forward' && chosen.length > 0) void openForwardPicker(chosen[0], chosen);
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
    // 回复未读(inbox 表那一半)也在这一刻清:推进该 agent 的水位线并持久化。
    markAgentRepliesSeen(alias);
    // #1828:hub 给权威数时,同一刻把这个 agent 的未读在 hub 上 ack 掉(两表);失败不影响本地清零,下次渲染再补。
    // 先试 agent 级 ack(hub ≥ .55 一次清该 agent 全部未读;老 hub 400 → 退回按当前页 id)。
    if (hubHasAgentUnread()) {
      void ackAgentUnread(alias, {
        ackAgent: agent => ackAgentMessages(cfg, agent),
        ackIds: ids => ackUserMessages(cfg, ids),
        idsFor: agent => unackedIdsForAgent(agent),
        clearServerUnread: agent => markAgentServerUnreadCleared(agent),
        warn: (message, error) => console.warn(message, error),
      });
    }
  }, [alias, conversationReady, showJump]);

  // shared by the sent bubble and the reply bubble (tg 771)
  const renderAttachment = (a: AttachmentView, gallery: ViewerImage[] = galleryOf([a])) =>
    a.isImage && a.uri && !a.needsAuth ? (
      <Pressable key={a.key} onPress={() => openViewer(gallery, a.key, a.uri)}>
        <Image source={{ uri: a.uri }} style={styles.thumb} resizeMode="contain" />
      </Pressable>
    ) : a.isImage && a.needsAuth && Platform.OS === 'web' && !!(globalThis as any).__TAURI_INTERNALS__ ? (
      <AuthedWebThumb
        key={`${attachmentCacheScope(cfg.serverUrl, cfg.token)}-${a.key}`}
        uri={a.uri!}
        name={a.name}
        mime={a.mime}
        token={cfg.token}
        onPress={objectUrl => openViewer(gallery, a.key, objectUrl)}
      />
    ) : a.isImage && a.needsAuth && Platform.OS !== 'web' ? (
      <View key={`${attachmentCacheScope(cfg.serverUrl, cfg.token)}-${a.key}`} style={styles.attachmentImage}>
        <AuthedThumb
          fileId={a.key}
          name={a.name}
          mime={a.mime}
          serverUrl={cfg.serverUrl}
          token={cfg.token}
          onPress={localUri => openViewer(gallery, a.key, localUri)}
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
    ) : a.needsAuth && a.uri && Platform.OS === 'web' && !!(globalThis as any).__TAURI_INTERNALS__ ? (
      // 桌面端非图片附件(含视频):此前只画一行文字没接点击(Vincent 2026-09-07「点击了没反应」)
      <AttachmentFileDesktop
        key={`${attachmentCacheScope(cfg.serverUrl, cfg.token)}-${a.key}`}
        uri={a.uri}
        name={a.name}
        token={cfg.token}
        size={a.size}
      />
    ) : (
      <Text key={a.key} style={styles.attachmentLine}>
        📎 {a.name}
      </Text>
    );

  // 多图(≥2 张能画缩略图的图)= 微信式 3 列方格;单图/文件/视频仍走 renderAttachment,不改原样子。
  const gridRenderable = (a: AttachmentView) =>
    a.isImage && !!a.uri && (!a.needsAuth || Platform.OS !== 'web' || !!(globalThis as any).__TAURI_INTERNALS__);
  const renderGridCell = (a: AttachmentView, item: ChatItem | undefined, gallery: ViewerImage[]) => {
    const state = a.localIndex !== undefined ? item?._uploads?.[a.localIndex] : undefined;
    const failed = state?.status === 'failed';
    const cellKey = `${attachmentCacheScope(cfg.serverUrl, cfg.token)}-${a.key}`;
    const inner = !a.needsAuth ? (
      <Pressable onPress={() => openViewer(gallery, a.key, a.uri)} accessibilityLabel={`预览 ${a.name}`}>
        <Image source={{ uri: a.uri }} style={styles.gridImage} resizeMode="cover" />
      </Pressable>
    ) : Platform.OS === 'web' ? (
      <AuthedWebThumb uri={a.uri!} name={a.name} mime={a.mime} token={cfg.token} compact onPress={objectUrl => openViewer(gallery, a.key, objectUrl)} />
    ) : (
      <AuthedThumb fileId={a.key} name={a.name} mime={a.mime} serverUrl={cfg.serverUrl} token={cfg.token} compact onPress={localUri => openViewer(gallery, a.key, localUri)} />
    );
    return (
      <View key={cellKey} style={[styles.gridCell, failed && styles.gridCellFailed]} testID="chat-image-grid-cell">
        {inner}
        {state && state.status !== 'done' ? (
          <View style={[styles.gridOverlay, failed && styles.gridOverlayFailed]} pointerEvents={failed ? 'box-none' : 'none'}>
            {state.status === 'uploading' ? <ActivityIndicator size="small" color="#fff" /> : null}
            <Text style={styles.gridOverlayText} numberOfLines={2}>
              {state.status === 'queued' ? '等待上传' : state.status === 'uploading' ? '上传中' : '上传失败'}
            </Text>
          </View>
        ) : null}
        {failed && item?._failed && a.localIndex !== undefined ? (
          <Pressable
            accessibilityLabel={`移除 ${a.name}`}
            hitSlop={8}
            style={styles.gridRemove}
            onPress={() => removeFailedAttachment(item, a.localIndex!)}
          >
            <Text style={styles.gridRemoveText}>✕</Text>
          </Pressable>
        ) : null}
      </View>
    );
  };
  const renderAttachments = (views: AttachmentView[], item?: ChatItem) => {
    const gridViews = views.filter(gridRenderable);
    // 预览里左右滑 = 这条消息的全部图片(方格 + 单图同一套)。
    const gallery = galleryOf(views);
    if (gridViews.length < 2) {
      return views.map(a => {
        const state = a.localIndex !== undefined ? item?._uploads?.[a.localIndex] : undefined;
        if (!state || state.status === 'done') return renderAttachment(a, gallery);
        return (
          <View key={`state-${a.key}`}>
            {renderAttachment(a, gallery)}
            <Text style={[styles.attachmentLine, state.status === 'failed' && { color: colors.failed }]}>
              {state.status === 'failed' ? `上传失败：${state.error ?? ''}` : state.status === 'uploading' ? '上传中…' : '等待上传'}
            </Text>
          </View>
        );
      });
    }
    const rest = views.filter(a => !gridRenderable(a));
    return (
      <>
        <View style={styles.imageGrid} testID="chat-image-grid">
          {gridViews.map(a => renderGridCell(a, item, gallery))}
        </View>
        {rest.map(a => renderAttachment(a, gallery))}
      </>
    );
  };

  const doSend = async (
    content: string,
    localId: string,
    imgs: PickedImage[] = [],
    priority: TaskPriority = 'normal',
    original = false,
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
        // 并发 ≤ 3、按选择顺序;逐张状态画在回显气泡的缩略图上。
        const setState = (index: number, state: UploadState) => {
          if (!mayTouchVisibleState()) return;
          setMessages(prev => prev.map(t => (t._localId === localId ? { ...t, _uploads: withUploadState(t._uploads, imgs.length, index, state) } : t)));
        };
        const run = await runUploadQueue(imgs, async img => {
          const hit = uploadMemo.get(cfg.serverUrl, img.uri, original);
          if (hit) return hit;
          const prepared = await prepareForUpload(img, original);
          const tooBig = oversizeMessage(prepared);
          if (tooBig) throw new Error(tooBig);
          const done = { img: prepared, up: await uploadImage(cfg, prepared) };
          uploadMemo.set(cfg.serverUrl, img.uri, original, done);
          return done;
        }, { concurrency: UPLOAD_CONCURRENCY, onState: setState });
        if (run.failed.length) {
          // 🔴 一张没传上就整条不发:绝不静默发出缺图的半条消息。sendTask 根本没调用,
          // 不存在「hub 其实收到了」的歧义,直接标未送达,让用户重试(已传的不重传)或移除失败的那几张。
          const summary = uploadFailureSummary(imgs.map(img => img.fileName), run.errors) ?? '附件上传失败';
          outboxMarkFailed(localId);
          if (mayTouchVisibleState()) {
            setMessages(prev => prev.map(t => (t._localId === localId ? { ...t, _pending: false, _failed: true, _uploadError: summary } : t)));
          }
          return;
        }
        const uploaded = run.results as { img: PickedImage; up: UploadedFile }[];
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
      // Keep the echo on screen, marked delivered, until the server row arrives; the merge in
      // load() drops it once a fetched row carries the same task_id (or matches by content/time).
      const confirmedTaskId = typeof (response as any)?.task_id === 'string' ? (response as any).task_id : undefined;
      setMessages(prev => prev.map(t => (t._localId === localId ? { ...t, _pending: false, _confirmedTaskId: confirmedTaskId } : t)));
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
        setQuote(null);
        setAttached([]);
        setSendPriority('normal');
        setBtwLaunch(current => ({ id: (current?.id ?? 0) + 1, prompt: parsed.prompt, attachments }));
      } catch (error) {
        Alert.alert('BTW 附件上传失败', error instanceof Error ? error.message : '附件未上传，草稿已保留');
      }
      return;
    }
    const body = parsed.content.trim() || (attached.length ? `[附件] ${attached.map(item => item.fileName).join('、')}` : '');
    if ((!body && !attached.length) || sending) return;
    const blocked = sendBlocker(attached, willCompressLater);
    if (blocked) {
      setComposerNotice(blocked); // 草稿原样保留,用户移除超限的那张再发
      return;
    }
    // 引用条在前、正文在后;agent 端看到的是「@作者: 被引用内容」+ 正文,客户端渲染时再拆开。
    const content = quote ? buildQuote(quote.text, 40, quote.author) + body : body;
    const imgs = attached;
    const priority = sendPriority;
    const original = sendOriginal;
    setDraft('');
    setQuote(null);
    attachedRef.current = [];
    setAttached([]);
    setSendOriginal(false);
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
      { content, created_at: new Date().toISOString(), _localId: localId, _pending: true, _imgs: imgs, _priority: priority, _original: original },
      ...prev,
    ]);
    doSend(content, localId, imgs, priority, original);
  };

  const retry = (item: ChatItem) => {
    if (!item._localId || !item.content) return;
    const retriedAt = Date.now();
    outboxMarkPending(item._localId, retriedAt); // 重试中被杀照样恢复(仍在盘上)
    setMessages(prev =>
      mergeMessagesNewestFirst(
        prev.map(t => (t._localId === item._localId ? { ...t, created_at: new Date(retriedAt).toISOString(), _pending: true, _failed: false, _uploadError: undefined } : t)),
        [],
      ),
    );
    const priority = item._priority ?? outboxForAlias(alias).find(e => e.id === item._localId)?.priority ?? 'normal';
    doSend(item.content, item._localId, item._imgs ?? (item._img ? [item._img] : []), priority, !!item._original);
  };

  // 失败消息里移除一张没传上的附件(微信:「重发」或「删掉这张」)。只在 _failed 时可用。
  const removeFailedAttachment = (item: ChatItem, index: number) => {
    if (!item._localId || !item._failed) return;
    setMessages(prev => prev.map(t => {
      if (t._localId !== item._localId) return t;
      const current = t._imgs ?? (t._img ? [t._img] : []);
      const { imgs, states } = removeAttachmentAt(current, t._uploads, index);
      const stillFailing = (states ?? []).some(s => s.status === 'failed');
      return { ...t, _img: undefined, _imgs: imgs, _uploads: states, _uploadError: stillFailing ? t._uploadError : undefined };
    }));
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

  // One tap = one action (no intermediate 「发送附件」 Alert any more). Picked items go
  // to the main composer draft, exactly as the old 图片/文件 Alert buttons did.
  const runPlusItem = (key: PlusItemKey) => {
    plusEvent('itemPicked');
    const pickInto = (pick: () => Promise<PickedImage | null>) =>
      pick()
        .then(item => { if (item) appendAttachment(item); })
        .catch(error => Alert.alert('无法打开', error instanceof Error ? error.message : String(error)));
    if (key === 'album') {
      const slots = remainingImageSlots(attachedRef.current);
      if (slots <= 0) {
        setComposerNotice(`最多选择 ${MAX_DRAFT_IMAGES} 张图片`);
        return;
      }
      pickImages(slots)
        .then(appendAttachments)
        .catch(error => Alert.alert('无法打开', error instanceof Error ? error.message : String(error)));
    }
    else if (key === 'file') pickInto(pickDocument);
    else if (key === 'camera') pickInto(pickCameraPhoto);
    else setBtwLaunch(current => ({ id: (current?.id ?? 0) + 1 }));
  };
  const plusItems = plusPanelItems({ os: Platform.OS, desktop, attachEnabled: ATTACH_ENABLED });
  // Mobile row right slot: ＋ when there is nothing to send, 「发送」 once there is.
  const rightSlot = composerRightSlot({ draft, attachmentCount: attached.length, voiceMode });
  const showExpand = !desktop && shouldShowExpand(inputLines, voiceMode);

  const exactSideThreadTask = messages.find(message => message.thread_id && message.turn_id);
  const sideThreadScope = exactSideThreadTask?.thread_id && exactSideThreadTask.turn_id
    ? {
      sourceThreadId: exactSideThreadTask.thread_id,
      boundary: { kind: 'through' as const, turnId: exactSideThreadTask.turn_id },
    }
    : undefined;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      // Edge-to-edge Android ignores adjustResize, so behavior=undefined
      // left the keyboard covering the input (Vincent tg 738). 'padding'
      // works on both platforms under edge-to-edge.
      behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
      // RN's Android KAV never resets its padding on keyboardDidHide (it
      // recomputes it from the hide event), which left a keyboard-height band
      // under the composer after dismissing (Vincent, 0.2.102 foldable). Only
      // let it pad while the keyboard is actually up. See keyboard-visibility.ts.
      enabled={keyboardAvoidEnabled(Platform.OS, keyboardVisible)}
      onLayout={(event) => { const h = event.nativeEvent.layout.height; rootHeightRef.current = h; setRootHeight(h); }}
      keyboardVerticalOffset={Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0}
    >
      <View
        style={[styles.header, { paddingHorizontal: headerLayout.paddingHorizontal, gap: headerLayout.gap }]}
        onLayout={(event) => {
          const w = Math.round(event.nativeEvent.layout.width);
          setHeaderWidth(current => (current === w ? current : w));
        }}
        testID="chat-header"
        {...({ dataSet: { headerMode: headerLayout.mode } } as any)}
      >
        {!desktop && !hideBack ? (
          <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="返回">
            <Text style={styles.back}>‹</Text>
          </Pressable>
        ) : null}
        <AliasAvatar alias={alias} size={32} />
        {/* Name first: the column keeps up to NAME_MIN_WIDTH (≈6 CJK glyphs + …)
            before anything else; actions never shrink, so the layout picks
            fewer/smaller actions instead (chat-header-layout.ts). */}
        <View style={[styles.headerTitleCol, { minWidth: Math.min(NAME_MIN_WIDTH, headerLayout.nameWidth) }]}>
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
          style={({ pressed }) => [headerActionStyle, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name={searchOpen ? 'close-outline' : 'search-outline'} size={20} color={searchOpen ? colors.accent : colors.textSecondary} />
        </Pressable>
        {/* Hidden since 0.2.105 (chat-entry-flags.ts); `/btw <问题>` still opens the drawer. */}
        {SHOW_BTW_ENTRY ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="打开 BTW 旁路线程"
            onPress={() => runPlusItem('btw')}
            hitSlop={8}
            style={({ pressed }) => [styles.btwHeaderButton, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.btwHeaderText}>BTW</Text>
          </Pressable>
        ) : null}
        {onToggleMute && headerShows('mute') ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={muted ? '取消消息免打扰' : '消息免打扰'}
            accessibilityState={{ selected: muted }}
            onPress={onToggleMute}
            hitSlop={10}
            style={({ pressed }) => [headerActionStyle, pressed && { opacity: 0.6 }]}
            testID="chat-mute-toggle"
          >
            <Ionicons name={muted ? 'notifications-off' : 'notifications-outline'} size={20} color={muted ? colors.accent : colors.textSecondary} />
          </Pressable>
        ) : null}
        {onTogglePin && headerShows('pin') ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={pinned ? '取消置顶会话' : '置顶会话'}
            accessibilityState={{ selected: pinned }}
            onPress={onTogglePin}
            hitSlop={10}
            style={({ pressed }) => [headerActionStyle, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name={pinned ? 'pin' : 'pin-outline'} size={20} color={pinned ? colors.accent : colors.textSecondary} />
            {headerLayout.labels ? (
              <Text style={[styles.headerActionText, pinned && { color: colors.accent }]}>{pinned ? '已置顶' : '置顶'}</Text>
            ) : null}
          </Pressable>
        ) : null}
        {headerLayout.overflow.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="更多操作"
            onPress={() => setHeaderMoreOpen(true)}
            hitSlop={10}
            style={({ pressed }) => [headerActionStyle, pressed && { opacity: 0.6 }]}
            testID="chat-header-more"
          >
            <Ionicons name="ellipsis-horizontal" size={20} color={(pinned || muted) ? colors.accent : colors.textSecondary} />
          </Pressable>
        ) : null}
        {onOpenNodeSettings ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="查看节点信息"
            accessibilityHint="打开当前节点的只读详细信息"
            onPress={onOpenNodeSettings}
            hitSlop={10}
            style={({ pressed }) => [headerActionStyle, desktop && styles.headerActionWithWindowPin, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="settings-outline" size={20} color={colors.textSecondary} />
            {headerLayout.labels ? <Text style={styles.headerActionText}>设置</Text> : null}
          </Pressable>
        ) : null}
      </View>

      {/* Narrow headers park pin / mute here; same action-sheet shape as the long-press menu. */}
      <Modal visible={headerMoreOpen && headerLayout.overflow.length > 0} transparent animationType="fade" onRequestClose={() => setHeaderMoreOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setHeaderMoreOpen(false)}>
          <View style={styles.actionSheet}>
            {headerLayout.overflow.map((key, index) => {
              const label = key === 'pin'
                ? (pinned ? '取消置顶会话' : '置顶会话')
                : (muted ? '取消消息免打扰' : '消息免打扰');
              const run = key === 'pin' ? onTogglePin : onToggleMute;
              return (
                <View key={key}>
                  {index > 0 ? <View style={styles.actionSep} /> : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={label}
                    style={({ pressed }) => [styles.actionItem, pressed && styles.actionItemPressed]}
                    onPress={() => { setHeaderMoreOpen(false); run?.(); }}
                    testID={`chat-header-more-${key}`}
                  >
                    <Text style={styles.actionText}>{label}</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        </Pressable>
      </Modal>

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
            // 微信式引用条:开头的「@作者: 文本」不进气泡,渲染成气泡下方的灰条
            const sentQuoted = parseQuoted(item.content);
            const sentGridNames = sentAttachmentViews(item, cfg.serverUrl).filter(gridRenderable).map(a => a.name);
            const replyQuoted = parseQuoted(item.result ?? item.reply ?? '');
            // 2026-09-17 Vincent:「Agent 节点回复人类也要这个引用啊」—— 回复没自带引用行时,
            // 挂一条指向它所回的那条请求的引用条,点击定位原文。
            const replyQuote = replyQuoted.quote ? null : replyQuoteFor(item, currentUsername, byTaskId);
            return (
              <View style={[styles.bubbleWrap, isHighlighted(msgKey(item), highlight, Date.now()) && styles.bubbleHighlight]}>
                {showHeader && item.created_at ? (
                  <Text style={styles.timeHeader}>{formatChatHeader(item.created_at)}</Text>
                ) : null}
                <View style={selectionMode ? styles.selectRow : undefined}>
                {selectionMode ? (
                  <Pressable accessibilityLabel="选中" hitSlop={8} onPress={() => toggleSelected(msgKey(item))} style={styles.selectBoxWrap}>
                    <View style={[styles.selectBox, selectedKeys.includes(msgKey(item)) && styles.selectBoxOn]}>
                      {selectedKeys.includes(msgKey(item)) ? <Ionicons name="checkmark" size={12} color={colors.onAccent} /> : null}
                    </View>
                  </Pressable>
                ) : null}
                <View style={selectionMode ? styles.selectBody : undefined} pointerEvents={selectionMode ? 'none' : 'auto'}>
                {!item._proactive ? sender.isCurrentUser ? (
                <View style={[styles.messageRow, styles.sentRow]}>
                  <View style={[styles.messageContent, styles.sentContent]}>
                    <Text style={[styles.messageAuthor, styles.sentAuthor]} numberOfLines={1}>
                      {sender.alias}{item.created_at ? ` · ${formatChatHeader(item.created_at)}` : ''}
                    </Text>
                    <Pressable
                      {...(desktop ? ({ dataSet: { messageKey: msgKey(item), messagePart: 'sent' }, onHoverIn: () => setHoverKey(`${msgKey(item)}:sent`), onHoverOut: () => setHoverKey(null), onMouseEnter: () => setHoverKey(`${msgKey(item)}:sent`), onMouseLeave: () => setHoverKey(null) } as any) : {})}
                      onLongPress={() => setMenuFor({ item, text: item.content ?? '', author: sender.alias })}
                      delayLongPress={300}
                      style={({ pressed }) => [styles.bubblePressable, pressed && { opacity: 0.7 }]}
                    >
                      <View style={styles.bubble}>
                        {desktop && hoverKey === `${msgKey(item)}:sent` && item.content ? (
                          <Pressable accessibilityLabel="复制消息" hitSlop={6} onPress={() => void copyMessage(item.content ?? '')} style={({ pressed }) => [styles.copyHover, styles.copyHoverSent, pressed && { opacity: 0.6 }]}>
                            <Ionicons name="copy-outline" size={14} color={colors.textMuted} />
                          </Pressable>
                        ) : null}
                        <MarkdownMessage>{hideGridImageLines(cleanAttachmentDebugText(sentQuoted.body || (sentQuoted.quote ? '' : '—')), sentGridNames) || (sentQuoted.quote ? '' : '—')}</MarkdownMessage>
                        {renderAttachments(sentAttachmentViews(item, cfg.serverUrl), item)}
                      </View>
                      {sentQuoted.quote ? (
                        <View style={[styles.quoteChip, styles.quoteChipSent]} accessibilityLabel="引用">
                          <Text style={styles.quoteChipText} numberOfLines={1}>{quoteLabel(sentQuoted.quote)}</Text>
                        </View>
                      ) : null}
                    </Pressable>
                  </View>
                  <AliasAvatar alias={sender.alias} size={36} />
                </View>
                ) : (
                // 0.2.72 Vincent:别的节点派给这个 agent 的任务不是「我」说的 ——
                // 放在收到侧,头像用发送方,作者行写「发送方 → 本 agent」。
                <View style={[styles.messageRow, styles.foreignRow]}>
                  <AliasAvatar alias={sender.alias} size={36} />
                  <View style={styles.messageContent}>
                    <Text style={styles.messageAuthor} numberOfLines={1}>
                      {`${sender.alias} → ${alias}`}{item.created_at ? ` · ${formatChatHeader(item.created_at)}` : ''}
                    </Text>
                    <Pressable
                      {...(desktop ? ({ dataSet: { messageKey: msgKey(item), messagePart: 'sent' }, onHoverIn: () => setHoverKey(`${msgKey(item)}:sent`), onHoverOut: () => setHoverKey(null), onMouseEnter: () => setHoverKey(`${msgKey(item)}:sent`), onMouseLeave: () => setHoverKey(null) } as any) : {})}
                      onLongPress={() => setMenuFor({ item, text: item.content ?? '', author: sender.alias })}
                      delayLongPress={300}
                      style={styles.replyPressable}
                    >
                      <View style={[styles.bubble, styles.replyBubble]}>
                        {desktop && hoverKey === `${msgKey(item)}:sent` && item.content ? (
                          <Pressable accessibilityLabel="复制消息" hitSlop={6} onPress={() => void copyMessage(item.content ?? '')} style={({ pressed }) => [styles.copyHover, styles.copyHoverReply, pressed && { opacity: 0.6 }]}>
                            <Ionicons name="copy-outline" size={14} color={colors.textMuted} />
                          </Pressable>
                        ) : null}
                        <MarkdownMessage>{hideGridImageLines(cleanAttachmentDebugText(sentQuoted.body || (sentQuoted.quote ? '' : '—')), sentGridNames) || (sentQuoted.quote ? '' : '—')}</MarkdownMessage>
                        {renderAttachments(sentAttachmentViews(item, cfg.serverUrl), item)}
                      </View>
                      {sentQuoted.quote ? (
                        <View style={[styles.quoteChip, styles.quoteChipReply]} accessibilityLabel="引用">
                          <Text style={styles.quoteChipText} numberOfLines={1}>{quoteLabel(sentQuoted.quote)}</Text>
                        </View>
                      ) : null}
                    </Pressable>
                  </View>
                </View>
                ) : null}
                {item.result || item.reply ? (
                  <View style={[styles.messageRow, styles.replyRow]}>
                    <AliasAvatar alias={alias} size={36} />
                    <View style={styles.messageContent}>
                      {/* 2026-09-16 Vincent:「每条消息都展示下时间吧」—— 回复用完成时刻,没有就用创建时刻 */}
                      <Text style={styles.messageAuthor} numberOfLines={1}>{alias}{item._proactive ? ' · 主动汇报' : ''}{(item.completed_at ?? item.created_at) ? ` · ${formatChatHeader(item.completed_at ?? item.created_at)}` : ''}</Text>
                      <Pressable
                        {...(desktop ? ({ dataSet: { messageKey: msgKey(item), messagePart: 'reply' }, onHoverIn: () => setHoverKey(`${msgKey(item)}:reply`), onHoverOut: () => setHoverKey(null), onMouseEnter: () => setHoverKey(`${msgKey(item)}:reply`), onMouseLeave: () => setHoverKey(null) } as any) : {})}
                        onLongPress={() => setMenuFor({ item, text: item.result ?? item.reply ?? '', author: alias })}
                        delayLongPress={300}
                        style={styles.replyPressable}
                      >
                        <View style={[styles.bubble, styles.replyBubble]}>
                          {desktop && hoverKey === `${msgKey(item)}:reply` ? (
                            <Pressable accessibilityLabel="复制消息" hitSlop={6} onPress={() => void copyMessage(item.result ?? item.reply ?? '')} style={({ pressed }) => [styles.copyHover, styles.copyHoverReply, pressed && { opacity: 0.6 }]}>
                              <Ionicons name="copy-outline" size={14} color={colors.textMuted} />
                            </Pressable>
                          ) : null}
                          <MarkdownMessage>{cleanAttachmentDebugText(replyQuoted.body)}</MarkdownMessage>
                          {renderAttachments(replyAttachmentViews(item, cfg.serverUrl))}
                        </View>
                        {replyQuoted.quote ? (
                          <View style={[styles.quoteChip, styles.quoteChipReply]} accessibilityLabel="引用">
                            <Text style={styles.quoteChipText} numberOfLines={1}>{quoteLabel(replyQuoted.quote)}</Text>
                          </View>
                        ) : replyQuote ? (
                          <Pressable accessibilityLabel="引用" accessibilityRole="button" hitSlop={4} onPress={() => locateKey(replyQuote.targetKey)} style={({ pressed }) => [styles.quoteChip, styles.quoteChipReply, pressed && { opacity: 0.6 }]}>
                            <Text style={styles.quoteChipText} numberOfLines={1}>{quoteLabel(replyQuote)}</Text>
                          </Pressable>
                        ) : null}
                      </Pressable>
                    </View>
                  </View>
                ) : null}
                </View>
                </View>
                {item._restoredNoImage ? (
                  <Text style={styles.restoredNote}>（图片附件未保存·重试仅发文本）</Text>
                ) : null}
                {item._pending ? (
                  <Text style={styles.pendingMark}>发送中…</Text>
                ) : item._failed ? (
                  <Pressable onPress={() => retry(item)} hitSlop={8}>
                    {item._uploadError ? <Text style={styles.uploadErrorText}>{item._uploadError}</Text> : null}
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

      {selectionMode ? (
        <View style={styles.selectionBar}>
          <Pressable accessibilityLabel="退出多选" hitSlop={8} onPress={exitSelectionMode} style={({ pressed }) => [styles.selectionCancel, pressed && { opacity: 0.6 }]}>
            <Text style={styles.selectionCancelText}>取消</Text>
          </Pressable>
          <View style={styles.selectionActions}>
            {selectionBarActions(selectedKeys.length, true).map(action => (
              <Pressable
                key={action.key}
                accessibilityLabel={action.label}
                onPress={() => onSelectionAction(action.key)}
                style={({ pressed }) => [styles.selectionAction, pressed && styles.actionItemPressed]}
              >
                <Text style={[styles.actionText, action.danger && styles.actionDanger]}>{action.label}</Text>
              </Pressable>
            ))}
            {selectedKeys.length === 0 ? <Text style={styles.selectionHint}>选择要转发或删除的消息</Text> : null}
          </View>
        </View>
      ) : null}

      {copiedToastVisible(copiedAt, Date.now()) ? (
        <View style={styles.copiedToast} pointerEvents="none" accessibilityLiveRegion="polite">
          <Ionicons name="checkmark-circle" size={14} color={colors.accent} />
          <Text style={styles.copiedToastText}>已复制</Text>
        </View>
      ) : null}
      {/* 更像微信·round-3: 滚离底部时的「回到最新 / N 条新消息」pill */}
      {showJump ? (
        <Pressable style={styles.jumpPill} onPress={jumpToLatest} hitSlop={8}>
          <Text style={styles.jumpPillText}>{jumpPillLabel(unread)} ↓</Text>
        </Pressable>
      ) : null}

      {attached.length ? (
        <View style={styles.draftStrip} testID="composer-draft-strip">
          <View style={styles.draftStripHeader}>
            <Text style={styles.draftCount} testID="composer-draft-count">{draftCountLabel(attached)}</Text>
            {draftImageCount(attached) ? (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: sendOriginal }}
                aria-checked={sendOriginal}
                accessibilityLabel="原图"
                hitSlop={8}
                onPress={toggleSendOriginal}
                style={styles.originalToggle}
                testID="composer-original-toggle"
              >
                <View style={[styles.originalBox, sendOriginal && styles.originalBoxOn]}>
                  {sendOriginal ? <Ionicons name="checkmark" size={11} color={colors.onAccent} /> : null}
                </View>
                <Text style={styles.originalLabel}>原图</Text>
              </Pressable>
            ) : null}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.draftStripRow}>
            {attached.map((item, index) => {
              const tooBig = !willCompressLater(item) && !!oversizeMessage(item);
              return isDraftImage(item) ? (
                <View key={item.uri} style={[styles.draftThumbWrap, tooBig && styles.draftThumbTooBig]} testID="composer-draft-thumb">
                  <Pressable onPress={() => openViewer(attached.filter(isDraftImage).map(d => ({ key: d.uri, name: d.fileName, uri: d.uri })), item.uri)} accessibilityLabel={`预览 ${item.fileName}`}>
                    <Image source={{ uri: item.uri }} style={styles.draftThumb} resizeMode="cover" />
                  </Pressable>
                  <View style={styles.draftIndex} pointerEvents="none"><Text style={styles.draftIndexText}>{index + 1}</Text></View>
                  {tooBig ? <View style={styles.draftTooBigTag} pointerEvents="none"><Text style={styles.draftTooBigText}>超 12MB</Text></View> : null}
                  <Pressable onPress={() => removeAttachment(item.uri)} hitSlop={8} style={styles.draftRemove} accessibilityLabel={`移除 ${item.fileName}`}>
                    <Text style={styles.draftRemoveText}>✕</Text>
                  </Pressable>
                </View>
              ) : (
                <View key={item.uri} style={[styles.draftFileChip, tooBig && styles.draftThumbTooBig]}>
                  <Text style={styles.attachName} numberOfLines={2}>📎 {item.fileName}</Text>
                  <Pressable onPress={() => removeAttachment(item.uri)} hitSlop={8} style={styles.draftRemove} accessibilityLabel={`移除 ${item.fileName}`}>
                    <Text style={styles.draftRemoveText}>✕</Text>
                  </Pressable>
                </View>
              );
            })}
            {/* 有附件时右下角是「发送」,不是 ＋:继续加图/文件从草稿条末尾这一格进同一个 ＋ 面板。 */}
            {!desktop && ATTACH_ENABLED && remainingImageSlots(attached) > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="继续添加"
                testID="composer-draft-add"
                onPress={() => plusEvent('toggle')}
                style={({ pressed }) => [styles.draftAddTile, pressed && { opacity: 0.6 }]}
              >
                <Ionicons name="add" size={26} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      ) : null}
      {composerNotice ? (
        <View style={styles.composerNotice} pointerEvents="none" accessibilityLiveRegion="polite" testID="composer-notice">
          <Text style={styles.composerNoticeText}>{composerNotice}</Text>
        </View>
      ) : null}
      <VoiceSettingsPrompt voice={voice} onOpenSettings={onOpenVoiceSettings} />
      {sendNotice ? (
        <ActualRecipientNotice notice={sendNotice} onDismiss={() => setSendConfirmation(null)} />
      ) : null}
      {/* Android 返回手势 / 桌面 Esc 都走 Modal 的 onRequestClose(见 ImageViewer.tsx)。 */}
      <ImageViewer state={viewer} onClose={() => setViewer(null)} serverUrl={cfg.serverUrl} token={cfg.token} />

      {/* 0.2.78 Vincent:和微信对齐 —— 分组 + 分隔线,删除单独一组,没有「取消」行(Esc/点空白关)。
          桌面端落在光标处;触摸端仍是底部 action sheet。 */}
      <Modal visible={!!menuFor} transparent animationType="fade" onRequestClose={() => setMenuFor(null)}>
        <Pressable style={desktop && menuAt ? styles.menuBackdropAnchored : styles.menuBackdrop} onPress={() => setMenuFor(null)}>
          <View
            style={desktop && menuAt
              ? [styles.actionMenuDesktop, { left: Math.max(8, Math.min(menuAt.x, menuWindowWidth - 188)), top: Math.max(8, Math.min(menuAt.y, menuWindowHeight - 300)) }]
              : styles.actionSheet}
          >
            {menuGroups.map((group, groupIndex) => (
              <View key={`menu-group-${groupIndex}`}>
                {groupIndex > 0 ? <View style={styles.actionGroupGap} /> : null}
                {group.map((item, itemIndex) => (
                  <View key={item.key}>
                    {itemIndex > 0 ? <View style={styles.actionSep} /> : null}
                    <Pressable
                      accessibilityLabel={item.key === 'copy' ? '复制消息' : item.label}
                      style={({ pressed }) => [
                        desktop && menuAt ? styles.actionItemDesktop : styles.actionItem,
                        pressed && styles.actionItemPressed,
                      ]}
                      onPress={() => onMenuAction(item.key)}
                    >
                      <Text style={[styles.actionText, item.danger && styles.actionDanger]}>{item.label}</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* 放大阅读:单条消息的全屏视图。气泡里读不完的长代码块用这个。 */}
      <Modal visible={!!expandFor} transparent animationType="fade" onRequestClose={() => setExpandFor(null)}>
        <Pressable style={styles.expandBackdrop} onPress={() => setExpandFor(null)}>
          <Pressable style={styles.expandPanel} onPress={() => {}} accessibilityLabel="放大阅读">
            <View style={styles.expandHeader}>
              <Text style={styles.expandTitle} numberOfLines={1}>{expandFor?.author ?? ''}</Text>
              <Pressable accessibilityLabel="关闭放大阅读" hitSlop={8} onPress={() => setExpandFor(null)}>
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </Pressable>
            </View>
            <ScrollView style={styles.expandScroll} contentContainerStyle={styles.expandContent}>
              <MarkdownMessage>{cleanAttachmentDebugText(parseQuoted(expandFor?.text ?? '').body || (expandFor?.text ?? ''))}</MarkdownMessage>
            </ScrollView>
            <Pressable
              accessibilityLabel="复制消息"
              style={({ pressed }) => [styles.expandCopy, pressed && styles.actionItemPressed]}
              onPress={() => void copyMessage(expandFor?.text ?? '')}
            >
              <Ionicons name="copy-outline" size={15} color={colors.textSecondary} />
              <Text style={styles.expandCopyText}>复制全文</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <SelectTextSheet
        text={selectTextFor ? selectTextFor.text : null}
        author={selectTextFor?.author}
        onClose={() => setSelectTextFor(null)}
        onCopyAll={(value) => { void copyValue(value); }}
      />

      <Modal visible={!!forwardFor && forwardUiOwner === conversationKeyFor} transparent animationType="fade" onRequestClose={() => setForwardFor(null)}>
        <Pressable style={styles.forwardBackdrop} onPress={() => setForwardFor(null)}>
          <Pressable style={styles.forwardPanel} onPress={() => {}}>
            <Text style={styles.forwardTitle}>{forwardBatch ? `转发给（${forwardBatch.length} 条）` : '转发给'}</Text>
            {forwardProgress ? <Text style={styles.forwardEmpty}>{forwardProgress}</Text> : null}
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

      {/* ⤢ 全屏编辑(手机/双栏):同一份草稿;Android 返回 / Esc 走 onRequestClose 收起,草稿保留。 */}
      <ComposerFullscreenEditor
        visible={!desktop && fullEditorOpen}
        alias={alias}
        draft={draft}
        onChangeDraft={setDraft}
        sendDisabled={!canSend(draft, attached.length > 0, sending)}
        onSend={() => { fullEditorEvent('sent'); void submit(); }}
        onClose={() => fullEditorEvent('back')}
      />

      <Modal visible={desktop && plusMenuOpen} transparent animationType="fade" onRequestClose={() => setPlusMenuOpen(false)}>
        <Pressable style={styles.plusMenuBackdrop} onPress={() => setPlusMenuOpen(false)}>
          <Pressable style={[styles.plusMenu, styles.plusMenuDesktop]} onPress={() => {}}>
            {plusItems.map(item => (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityLabel={item.a11y}
                style={({ pressed }) => [styles.plusMenuItem, pressed && styles.actionItemPressed]}
                onPress={() => runPlusItem(item.key)}
              >
                <View style={styles.plusMenuIcon}>
                  {item.icon ? <Ionicons name={item.icon as any} size={20} color={colors.textSecondary} /> : <Text style={styles.plusMenuBtw}>BTW</Text>}
                </View>
                <View style={styles.plusMenuCopy}>
                  <Text style={styles.plusMenuTitle}>{item.label}</Text>
                  {item.key === 'btw' ? <Text style={styles.plusMenuHint}>不打断、不 steer 当前主任务</Text> : null}
                </View>
              </Pressable>
            ))}
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
{quote ? (
          <View style={styles.quoteStrip} accessibilityLabel="正在引用">
            <View style={styles.quoteStripBar} />
            <Text style={styles.quoteStripText} numberOfLines={1}>{quoteLabel(quote)}</Text>
            <Pressable accessibilityLabel="取消引用" onPress={() => setQuote(null)} hitSlop={8} style={styles.quoteStripClose}>
              <Ionicons name="close" size={16} color={colors.textMuted} />
            </Pressable>
          </View>
        ) : null}
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
            <Pressable accessibilityLabel="更多发送方式" style={({ pressed }) => [styles.desktopToolButton, pressed && { opacity: 0.6 }]} onPress={() => plusEvent('toggle')} hitSlop={6}>
                <Ionicons name="add-circle-outline" size={24} color={colors.textSecondary} />
            </Pressable>
            <View style={styles.desktopToolbarRight}>
              {/* ⚡ 优先 toggle hidden since 0.2.105 (chat-entry-flags.ts). */}
              {SHOW_BOLT_ENTRY ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={sendPriority === 'high' ? '取消优先发送' : '设为优先发送'}
                  accessibilityState={{ selected: sendPriority === 'high' }}
                  onPress={() => setSendPriority(value => value === 'high' ? 'normal' : 'high')}
                  style={({ pressed }) => [styles.priorityButton, sendPriority === 'high' && styles.priorityButtonActive, pressed && { opacity: 0.7 }]}
                >
                  <Text style={[styles.priorityButtonText, sendPriority === 'high' && styles.priorityButtonTextActive]}>⚡ 优先</Text>
                </Pressable>
              ) : null}
              <Text style={styles.shortcutHint}>Enter 发送 · Shift/Ctrl/⌘+Enter 换行</Text>
              {voice.available ? <VoiceMicButton voice={voice} size={20} /> : null}
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
      <>
      {quote ? (
        <View style={styles.quoteStrip} accessibilityLabel="正在引用">
          <View style={styles.quoteStripBar} />
          <Text style={styles.quoteStripText} numberOfLines={1}>{quoteLabel(quote)}</Text>
          <Pressable accessibilityLabel="取消引用" onPress={() => setQuote(null)} hitSlop={8} style={styles.quoteStripClose}>
            <Ionicons name="close" size={16} color={colors.textMuted} />
          </Pressable>
        </View>
      ) : null}
      <View style={[styles.inputRow, { paddingBottom: spacing.md + (plusMenuOpen ? 0 : composerInset) }]}>
        {/* 微信式(composer-row-layout.ts):左 🎤/⌨ 切换 | 中 输入框或「按住 说话」 | 右 ＋ ⇄「发送」。
            ⤢ 在左列顶上,只在输入超过 3 行时出现(左列靠 stretch 撑满整行高度,不压输入框)。 */}
        {voice.available || showExpand ? (
          <View style={styles.inputLeftCol}>
            {showExpand ? <ComposerExpandButton onPress={() => fullEditorEvent('expand')} /> : <View />}
            {voice.available ? <ComposerModeToggle mode={inputMode} onToggle={toggleInputMode} disabled={voiceBusy} /> : null}
          </View>
        ) : null}
        {/* ⚡ toggle hidden since 0.2.105 (chat-entry-flags.ts). */}
        {SHOW_BOLT_ENTRY ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={sendPriority === 'high' ? '取消优先发送' : '设为优先发送'}
            accessibilityState={{ selected: sendPriority === 'high' }}
            onPress={() => setSendPriority(value => value === 'high' ? 'normal' : 'high')}
            style={({ pressed }) => [styles.mobilePriorityButton, sendPriority === 'high' && styles.priorityButtonActive, pressed && { opacity: 0.6 }]}
          >
            <Text style={[styles.mobilePriorityText, sendPriority === 'high' && styles.priorityButtonTextActive]}>⚡</Text>
          </Pressable>
        ) : null}
        {/* 语音模式:整条输入框换成「按住 说话」;键盘模式:输入框(不再有框内的小麦克风)。 */}
        <View style={styles.inputWrap}>
        {voiceMode ? <VoiceHoldBar voice={voice} /> : (
        <TextInput
          ref={mainComposerRef}
          style={[styles.input, styles.inputInWrap]}
          placeholder={`Message ${alias}…`}
          placeholderTextColor={colors.textMuted}
          value={draft}
          onChangeText={setDraft}
          onContentSizeChange={event => onInputContentSize(event.nativeEvent.contentSize.height)}
          onFocus={() => plusEvent('inputFocus')}
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
        )}
        </View>
        <ComposerRightSlot
          slot={rightSlot}
          sendDisabled={!canSend(draft, attached.length > 0, sending)}
          plusOpen={plusMenuOpen}
          onSend={() => void submit()}
          onPlus={() => plusEvent('toggle')}
        />
      </View>
      {plusMenuOpen ? (
        // Inline, in the chat pane only (two-pane: never over the agent list). It is a
        // sibling after the input row inside the root column, so the inverted message
        // list (flex:1) shrinks by the panel height and the newest message stays visible.
        <View
          accessibilityLabel="更多发送方式面板"
          style={[styles.plusPanel, { height: plusPanelHeight(plusWindowHeight, lastKeyboardHeightRef.current) + composerInset, paddingBottom: composerInset }]}
        >
          <View style={styles.plusGrid}>
            {plusItems.map(item => (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityLabel={item.a11y}
                style={({ pressed }) => [styles.plusCell, pressed && { opacity: 0.6 }]}
                onPress={() => runPlusItem(item.key)}
              >
                <View style={styles.plusCellIcon}>
                  {item.icon ? <Ionicons name={item.icon as any} size={28} color={colors.text} /> : <Text style={styles.plusCellBtw}>BTW</Text>}
                </View>
                <Text style={styles.plusCellLabel} numberOfLines={1}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      </>
      )}
      <VoiceRecordingOverlay voice={voice} bottom={desktop ? composerHeight + 24 : 88 + composerInset} />
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
  // 界面密度: heights follow ds(); widths stay what chat-header-layout.ts budgets for (it decides
  // which actions fit), so a denser header never overflows its own layout plan.
  headerAction: {
    minWidth: 58,
    height: ds(34),
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    gap: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActionText: { color: colors.textSecondary, fontSize: 12 },
  // Phone widths: icon-only square target (chat-header-layout ICON_BUTTON = 36).
  headerActionCompact: { width: 36, height: ds(34), borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  // Only flexible child of the header; minWidth is set inline from the layout.
  headerTitleCol: { flex: 1 },
  // DesktopWindowPin owns the top-right 34px. Reserve a separate hit target
  // instead of letting its absolute z-index cover this action.
  headerActionWithWindowPin: { marginRight: 42 },
  btwHeaderButton: { height: 28, minWidth: 42, paddingHorizontal: spacing.sm, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  btwHeaderText: { color: colors.textSecondary, fontSize: 11, fontWeight: '600', letterSpacing: 0.4 },
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
  foreignRow: { justifyContent: 'flex-start' },
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
    flexShrink: 0, // Android 截图里被裁成「06:1」:居中文本不能被行内收缩
    textAlign: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  // 极简:气泡不描边。发出的用中性的 rowActive 一档底色,回复用卡片色——靠底色区分,不靠边框。
  bubble: {
    alignSelf: 'flex-end',
    maxWidth: '100%',
    backgroundColor: colors.rowActive,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  replyBubble: { alignSelf: 'flex-start', maxWidth: '85%', flexShrink: 1, backgroundColor: colors.card },
  bubbleText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  // 微信式引用:气泡下方一条灰底小字「作者: 内容」(单行省略)
  quoteChip: { marginTop: 4, maxWidth: '100%', borderLeftWidth: 2, borderLeftColor: colors.border, paddingLeft: spacing.sm, paddingVertical: 1 },
  quoteChipSent: { alignSelf: 'flex-end' },
  quoteChipReply: { alignSelf: 'flex-start' },
  quoteChipText: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
  // 输入框上方的「正在引用」条
  quoteStrip: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.md, marginTop: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: 6, backgroundColor: colors.border + '55', borderRadius: 8 },
  quoteStripBar: { width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: colors.accent },
  quoteStripText: { flex: 1, color: colors.textMuted, fontSize: 12 },
  quoteStripClose: { padding: 2 },
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
  // 0.2.78 桌面端:菜单落在光标处(微信桌面端形状),左对齐、行更紧。
  menuBackdropAnchored: { flex: 1, backgroundColor: 'transparent' },
  actionMenuDesktop: {
    position: 'absolute',
    width: 180,
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.xs,
    overflow: 'hidden',
  },
  actionItemDesktop: { paddingVertical: 9, paddingHorizontal: spacing.md, alignItems: 'flex-start' },
  // 组与组之间是一段留白(不是发丝线),危险动作因此够不着常用动作。
  actionGroupGap: { height: spacing.sm, backgroundColor: colors.bg },
  // 放大阅读
  expandBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  expandPanel: { width: 760, maxWidth: '96%', height: '86%', borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, overflow: 'hidden' },
  expandHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  expandTitle: { flex: 1, minWidth: 0, color: colors.text, fontSize: 15, fontWeight: '600' },
  expandScroll: { flex: 1 },
  expandContent: { padding: spacing.lg },
  expandCopy: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  expandCopyText: { color: colors.textSecondary, fontSize: 13 },
  // 多选
  selectRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  selectBoxWrap: { paddingLeft: spacing.xs },
  selectBox: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  selectBoxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  selectBody: { flex: 1, minWidth: 0 },
  selectionBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.card },
  selectionCancel: { paddingVertical: spacing.xs, paddingRight: spacing.sm },
  selectionCancelText: { color: colors.textSecondary, fontSize: 14 },
  selectionActions: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.md },
  selectionAction: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: 8 },
  selectionHint: { color: colors.textMuted, fontSize: 12 },
  plusMenuBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.38)', justifyContent: 'flex-end' },
  plusMenu: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, overflow: 'hidden' },
  plusMenuDesktop: { width: 320, marginLeft: spacing.lg, marginBottom: 164, borderRadius: 12 },
  plusPanel: { backgroundColor: colors.inputBg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  plusGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.md, paddingTop: spacing.lg },
  plusCell: { width: '25%', maxWidth: 104, alignItems: 'center', marginBottom: spacing.lg },
  plusCellIcon: { width: 60, height: 60, borderRadius: 16, backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  plusCellBtw: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  plusCellLabel: { color: colors.textSecondary, fontSize: 12, marginTop: 6 },
  plusMenuItem: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  plusMenuIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.inputBg, alignItems: 'center', justifyContent: 'center' },
  plusMenuBtw: { color: colors.accent, fontSize: 9, fontWeight: '600' },
  plusMenuCopy: { flex: 1, minWidth: 0 },
  plusMenuTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  plusMenuHint: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  forwardBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.38)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  forwardPanel: { width: 360, maxWidth: '92%', maxHeight: 520, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: spacing.lg },
  forwardTitle: { color: colors.text, fontSize: 17, fontWeight: '600', marginBottom: spacing.md },
  forwardSearch: { color: colors.text, backgroundColor: colors.inputBg, borderRadius: 9, paddingHorizontal: spacing.md, paddingVertical: 10, marginBottom: spacing.sm },
  forwardList: { maxHeight: 400 },
  forwardTarget: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.sm, borderRadius: 9 },
  forwardAlias: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14, fontWeight: '600' },
  forwardEmpty: { color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.xl },
  actionSep: { height: 1, backgroundColor: colors.border },
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
  // 复制消息:桌面端悬停气泡时的右上角小按钮 + 底部「已复制」提示
  replyPressable: { maxWidth: '100%', alignSelf: 'flex-start' },
  copyHover: { position: 'absolute', top: -10, zIndex: 2, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  copyHoverSent: { left: -12 },
  copyHoverReply: { right: -12 },
  copiedToast: { position: 'absolute', alignSelf: 'center', bottom: 96, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  copiedToastText: { color: colors.text, fontSize: 12 },
  attachPreviewList: { maxHeight: 112, paddingVertical: spacing.xs },
  // 多图草稿条(微信式):计数 + 原图开关一行,下面横向缩略图,每张右上 ✕、左下序号。
  draftStrip: { paddingTop: spacing.xs, paddingHorizontal: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  draftStripHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  draftCount: { color: colors.textSecondary, fontSize: 12 },
  originalToggle: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  originalBox: { width: 15, height: 15, borderRadius: 8, borderWidth: 1, borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center' },
  originalBoxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  originalLabel: { color: colors.text, fontSize: 12 },
  draftStripRow: { gap: 8, paddingTop: 6, paddingBottom: spacing.xs, paddingRight: 6 },
  draftThumbWrap: { width: 64, height: 64, borderRadius: 6, overflow: 'visible' },
  draftThumbTooBig: { borderWidth: 2, borderColor: colors.failed, borderRadius: 8 },
  draftThumb: { width: 64, height: 64, borderRadius: 6, backgroundColor: colors.inputBg },
  draftIndex: { position: 'absolute', left: 3, bottom: 3, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  draftIndexText: { color: colors.onAccent, fontSize: 10, fontWeight: '600' },
  draftTooBigTag: { position: 'absolute', left: 0, right: 0, top: 22, alignItems: 'center' },
  draftTooBigText: { color: '#fff', backgroundColor: colors.failed, fontSize: 10, paddingHorizontal: 3, borderRadius: 3, overflow: 'hidden' },
  draftRemove: { position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center' },
  draftRemoveText: { color: '#fff', fontSize: 10, lineHeight: 12 },
  draftFileChip: { width: 120, height: 64, borderRadius: 6, padding: 6, justifyContent: 'center', backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border },
  composerNotice: { alignSelf: 'center', marginVertical: 4, paddingVertical: 5, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, maxWidth: '92%' },
  composerNoticeText: { color: colors.text, fontSize: 12 },
  // 多图气泡:3 列方格(微信式),每格 84,间距 4
  imageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: spacing.sm, maxWidth: 3 * 84 + 2 * 4 },
  gridCell: { width: 84, height: 84, borderRadius: 6, overflow: 'hidden', backgroundColor: colors.inputBg },
  gridCellFailed: { borderWidth: 2, borderColor: colors.failed },
  gridImage: { width: 84, height: 84 },
  gridOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', gap: 2 },
  gridOverlayFailed: { backgroundColor: 'rgba(160,20,20,0.55)' },
  gridOverlayText: { color: '#fff', fontSize: 10, textAlign: 'center' },
  gridRemove: { position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' },
  gridRemoveText: { color: '#fff', fontSize: 10, lineHeight: 12 },
  uploadErrorText: { color: colors.failed, fontSize: 11, textAlign: 'right', marginBottom: 2 },
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
  failedMark: { color: colors.failed, fontSize: 11, alignSelf: 'flex-end', fontWeight: '600' },
  // 左列:⤢(顶)+ 🎤/⌨(底);stretch 到整行高度,⤢ 才能落在左上角。
  inputLeftCol: { alignSelf: 'stretch', justifyContent: 'space-between', alignItems: 'center' },
  draftAddTile: { width: 64, height: 64, borderRadius: 6, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
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
  desktopToolButton: { width: ds(34), height: ds(34), alignItems: 'center', justifyContent: 'center' },
  desktopToolbarRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  priorityButton: { height: 28, borderRadius: radius.sm, borderWidth: 1, borderColor: 'transparent', paddingHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  priorityButtonActive: { borderColor: colors.failed, backgroundColor: colors.inputBg },
  priorityButtonText: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  priorityButtonTextActive: { color: colors.failed },
  mobilePriorityButton: { width: ds(36), height: ds(36), borderRadius: ds(36) / 2, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  mobilePriorityText: { color: colors.textMuted, fontSize: 15 },
  shortcutHint: { color: colors.textMuted, fontSize: 10 },
  desktopSend: { minWidth: ds(64), height: ds(32), borderRadius: radius.sm, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  desktopSendDisabled: { backgroundColor: colors.subtleFill },
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
    // composer-row-layout.ts COMPOSER_LINE_HEIGHT — the ⤢ threshold counts lines in this unit.
    lineHeight: 20,
    maxHeight: 120,
  },
  inputWrap: { flex: 1, justifyContent: 'flex-end' },
  // flex 归零:输入框在列方向的 inputWrap 里,flexBasis 0 会被压扁。
  inputInWrap: { flex: 0, alignSelf: 'stretch' },
  sendTextDisabled: { color: colors.textMuted },
});

let styles = makeStyles();
onThemeChange(() => {
  styles = makeStyles();
});
