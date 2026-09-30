// 人与人私信会话(hub agent-network#2086)。
// 画法照抄 agent 会话(ChatScreen)的同一套:顶栏(返回 · 头像 · 名字)、倒序气泡列表(发出靠右 rowActive 底,
// 收到靠左卡片底)、输入区(手机:输入框 +「＋ ⇄ 发送」一行;桌面:悬浮圆角卡片 + 工具栏)。样式数值与
// ChatScreen 同源(composer-row-layout / composer-resize 的常量),两个会话的输入区量出来一样高、一样齐。
// 私信没有 agent 会话的任务状态、引用、语音、⋯ 面板 —— 只有文字和附件。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, KeyboardAvoidingView, Platform, Pressable, StatusBar, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { layoutOs } from './safe-area-runtime';
import { Ionicons } from './icons';
import AliasAvatar from './AliasAvatar';
import AuthedThumb, { AttachmentFile } from './AuthedThumb';
import { ackUserMessages, type HubConfig } from './api';
import { pickFiles, uploadImage, type PickedImage } from './attach';
import { usePoll } from './usePoll';
import { colors, onThemeChange, radius, spacing } from './theme';
import { ds, uiScale } from './ui-scale';
import { elevated } from './elevation';
import { t } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-chat';
import './i18n-users';
import { localizedChatHeader as formatChatHeader } from './i18n-chat-time';
import { shouldShowTimeHeader } from './time';
import { canSend, shouldSendOnEnter } from './chat-actions';
import { sendKeyPref } from './shortcuts-store';
import { ComposerRightSlot } from './ComposerRowParts';
import { COMPOSER_INPUT_BORDER, COMPOSER_LINE_HEIGHT, composerControlSize, composerInputPadY, composerRightSlot } from './composer-row-layout';
import { COMPOSER_CARD_INSET, COMPOSER_DIVIDER_HEIGHT, COMPOSER_HEIGHT_DEFAULT } from './composer-resize';
import { dmAttachments, dmSendBody, isImageAttachment, mergeDm, newClientRequestId, unackedIncomingIds, type DmAttachment, type DmMessage, type Human } from './human-dm';
import { fetchDmMessages, sendDm } from './human-dm-api';
import { emitHumanDm, setActiveDmPeer, subscribeHumanDm } from './human-dm-bus';
import { keyboardAvoidEnabled, useKeyboardVisible } from './keyboard-visibility';
import { bubbleLayout, desktopBubbleCap } from './bubble-layout';

export default function DmChatScreen({ cfg, networkId, peer, onBack, desktop = false, hideBack = false }: {
  cfg: HubConfig;
  networkId: string;
  peer: Human;
  onBack: () => void;
  desktop?: boolean;
  hideBack?: boolean;
}) {
  useTranslation();
  const name = (peer.display_name ?? '').trim() || peer.username;
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [attached, setAttached] = useState<PickedImage[]>([]);
  const [sending, setSending] = useState(false);
  const [paneWidth, setPaneWidth] = useState(0);
  const insets = useSafeAreaInsets();
  const composerInset = layoutOs() === 'android' ? insets.bottom : 0;
  const keyboardVisible = useKeyboardVisible(Keyboard, Platform.OS);
  const acked = useRef(new Set<string>());

  const load = useCallback(async () => {
    try {
      const rows = await fetchDmMessages(cfg, networkId, peer.user_id);
      setMessages(prev => mergeDm(prev.filter(m => !m.pending || !rows.some(r => r.message_id === m.message_id)), rows));
      setError('');
      // 打开即读:对方发来、还没 ack 的这一批标已读(hub 只改自己的行),人员列表的角标随之清掉。
      const ids = unackedIncomingIds(rows).filter(id => !acked.current.has(id));
      if (ids.length) {
        ids.forEach(id => acked.current.add(id));
        await ackUserMessages(cfg, ids).catch(() => ids.forEach(id => acked.current.delete(id)));
        emitHumanDm(null);
      }
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setLoaded(true);
    }
  }, [cfg, networkId, peer.user_id]);
  usePoll(load, 8000, [load]);
  useEffect(() => subscribeHumanDm(from => { if (!from || from === peer.username) void load(); }), [load, peer.username]);
  useEffect(() => {
    setActiveDmPeer(peer.username);
    return () => setActiveDmPeer(null);
  }, [peer.username]);

  const submit = async () => {
    if (!canSend(draft, attached.length > 0, sending)) return;
    const text = draft.trim();
    const files = attached;
    const clientId = newClientRequestId();
    setSending(true);
    setDraft('');
    setAttached([]);
    const optimistic: DmMessage = { message_id: clientId, content: text, direction: 'out', created_at: new Date().toISOString(), pending: true };
    setMessages(prev => mergeDm(prev, [optimistic]));
    try {
      const uploaded: DmAttachment[] = [];
      for (const f of files) {
        const up = await uploadImage(cfg, f, { networkId });
        uploaded.push({ type: 'file', file_id: up.file_id, name: f.fileName, mime: up.mime, size: up.size });
      }
      const res = await sendDm(cfg, dmSendBody({ networkId, toUserId: peer.user_id, message: text, attachments: uploaded, clientRequestId: clientId }));
      setMessages(prev => mergeDm(prev.filter(m => m.message_id !== clientId), [{ ...res.message, direction: 'out' }]));
    } catch (e) {
      setMessages(prev => prev.map(m => (m.message_id === clientId ? { ...m, pending: false, failed: true } : m)));
      setError(String((e as Error)?.message ?? e));
    } finally {
      setSending(false);
    }
  };
  const onPlus = () => { void pickFiles().then(files => { if (files.length) setAttached(prev => [...prev, ...files].slice(0, 9)); }).catch(() => {}); };
  const sendKey = sendKeyPref();
  const rightSlot = composerRightSlot({ draft, attachmentCount: attached.length, voiceMode: false });
  const bubbleCap = desktopBubbleCap(desktop, paneWidth);
  const me = cfg.username ?? '';

  const renderAttachments = (m: DmMessage) => {
    const list = dmAttachments(m);
    if (!list.length) return null;
    return (
      <View style={styles.attachments}>
        {list.map(a => isImageAttachment(a)
          ? <AuthedThumb key={a.file_id} fileId={a.file_id} name={a.name ?? a.file_id} mime={a.mime} serverUrl={cfg.serverUrl} token={cfg.token} onPress={() => {}} />
          : <AttachmentFile key={a.file_id} fileId={a.file_id} name={a.name ?? a.file_id} mime={a.mime} serverUrl={cfg.serverUrl} token={cfg.token} />)}
      </View>
    );
  };

  const data = useMemo(() => messages, [messages]);
  return (
    <KeyboardAvoidingView
      style={styles.root}
      testID="dm-pane"
      behavior="padding"
      enabled={keyboardAvoidEnabled(Platform.OS, keyboardVisible)}
      keyboardVerticalOffset={Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0}
      onLayout={e => setPaneWidth(e.nativeEvent.layout.width)}
    >
      <View style={styles.header} testID="dm-header">
        {!desktop && !hideBack ? (
          <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('chat.back')} testID="dm-header-back">
            <Text style={styles.back}>‹</Text>
          </Pressable>
        ) : null}
        <AliasAvatar alias={peer.username} size={32} />
        <View style={styles.headerTitleCol}>
          <Text style={styles.title} numberOfLines={1} testID="dm-header-title">{name}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{t('dm.subtitle', { username: peer.username })}</Text>
        </View>
      </View>
      {!loaded ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : (
        <FlatList
          inverted
          data={data}
          keyExtractor={m => m.message_id}
          contentContainerStyle={{ padding: spacing.lg }}
          testID="dm-list"
          ListFooterComponent={data.length ? null : <Text style={styles.beginning}>{t('dm.empty', { name })}</Text>}
          renderItem={({ item, index }) => {
            const showHeader = shouldShowTimeHeader(item.created_at ?? undefined, data[index + 1]?.created_at ?? undefined);
            const out = item.direction === 'out';
            return (
              <View style={styles.bubbleWrap} testID={`dm-msg-${out ? 'out' : 'in'}`}>
                {showHeader && item.created_at ? <Text style={styles.timeHeader}>{formatChatHeader(item.created_at)}</Text> : null}
                <View style={[styles.messageRow, out ? styles.sentRow : styles.replyRow]}>
                  {out ? null : <AliasAvatar alias={peer.username} size={36} />}
                  <View style={[styles.messageContent, out && styles.sentContent, !out && bubbleCap]}>
                    <Text style={[styles.messageAuthor, out && styles.sentAuthor]} numberOfLines={1}>
                      {out ? me : name}{item.created_at ? ` · ${formatChatHeader(item.created_at)}` : ''}
                    </Text>
                    <View style={[styles.bubble, !out && styles.replyBubble, !out && desktop && styles.replyBubbleDesktop]} testID="dm-bubble">
                      {item.content ? <Text style={styles.bubbleText} selectable>{item.content}</Text> : null}
                      {renderAttachments(item)}
                    </View>
                    {item.pending ? <Text style={styles.statusMark}>{t('dm.sending')}</Text> : item.failed ? <Text style={[styles.statusMark, { color: colors.failed }]}>{t('dm.failed')}</Text> : null}
                  </View>
                  {out ? <AliasAvatar alias={me || 'me'} size={36} /> : null}
                </View>
              </View>
            );
          }}
        />
      )}
      {error ? <Text style={styles.error} testID="dm-error" numberOfLines={2}>{error}</Text> : null}
      {attached.length ? (
        <View style={styles.draftStrip} testID="dm-draft-strip">
          {attached.map((f, i) => (
            <View key={`${f.uri}:${i}`} style={styles.draftChip}>
              <Ionicons name="document-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.draftName} numberOfLines={1}>{f.fileName}</Text>
              <Pressable accessibilityLabel={t('dm.removeAttachment')} hitSlop={8} onPress={() => setAttached(prev => prev.filter((_, j) => j !== i))}>
                <Ionicons name="close" size={14} color={colors.textMuted} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      {desktop ? (
        <View style={styles.desktopComposerWrap}>
          {/* agent 会话在卡片上方有一条 6 px 的拖动分隔条;私信不可拖,留同样高的空,两边卡片落在同一高度。 */}
          <View style={{ height: COMPOSER_DIVIDER_HEIGHT }} />
          <View style={[styles.desktopComposer, { minHeight: COMPOSER_HEIGHT_DEFAULT }]} testID="dm-desktop-composer">
            <TextInput
              // 一行一行地长(21 px 一行,最多 6 行):web 的 textarea 不写 rows 默认是两行高,卡片会比 agent 会话的高一截。
              style={[styles.desktopInput, { height: Math.min(6, draft.split('\n').length) * 21 }]}
              {...(Platform.OS === 'web' ? { rows: 1 } : null)}
              placeholder={t('dm.placeholder', { name })}
              placeholderTextColor={colors.textMuted}
              value={draft}
              onChangeText={setDraft}
              testID="dm-input"
              onKeyPress={event => {
                const key = event.nativeEvent as typeof event.nativeEvent & { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; isComposing?: boolean };
                if (!shouldSendOnEnter(key, sendKey)) return;
                event.preventDefault?.();
                void submit();
              }}
              multiline
            />
            <View style={styles.desktopToolbar}>
              <Pressable accessibilityLabel={t('chat.addFile')} testID="dm-desktop-plus" style={({ pressed }) => [styles.desktopToolButton, pressed && { opacity: 0.6 }]} onPress={onPlus} hitSlop={6}>
                <Ionicons name="add-circle-outline" size={24} color={colors.textSecondary} />
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.desktopSend, !canSend(draft, attached.length > 0, sending) && styles.desktopSendDisabled, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityLabel={t('chat.send')}
                onPress={() => void submit()}
                disabled={!canSend(draft, attached.length > 0, sending)}
                testID="dm-desktop-send"
              >
                <Text style={[styles.desktopSendText, !canSend(draft, attached.length > 0, sending) && styles.sendTextDisabled]}>{t('chat.send')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : (
        <View style={[styles.inputRow, { paddingBottom: spacing.md + composerInset }]} testID="dm-input-row">
          <View style={styles.inputWrap}>
            <TextInput
              style={[styles.input, styles.inputInWrap, Platform.OS === 'web' && { height: composerControlSize(uiScale().densityFactor), flexBasis: 'auto' }]}
              {...(Platform.OS === 'web' ? { rows: 1 } : null)}
              placeholder={t('dm.placeholder', { name })}
              placeholderTextColor={colors.textMuted}
              value={draft}
              onChangeText={setDraft}
              testID="dm-input"
              multiline
            />
          </View>
          <ComposerRightSlot slot={rightSlot} sendDisabled={!canSend(draft, attached.length > 0, sending)} plusOpen={false} onSend={() => void submit()} onPlus={onPlus} />
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const makeStyles = (B = bubbleLayout()) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.card },
  back: { color: colors.accent, fontSize: 28, lineHeight: 30, paddingRight: spacing.sm },
  title: { color: colors.text, fontSize: 16, fontWeight: '600' },
  subtitle: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
  headerTitleCol: { flex: 1, minWidth: 0 },
  beginning: { color: colors.textMuted, fontSize: 11, textAlign: 'center', marginVertical: spacing.md },
  bubbleWrap: { marginBottom: spacing.md, gap: spacing.xs },
  timeHeader: { color: colors.textMuted, fontSize: 11, alignSelf: 'center', flexShrink: 0, textAlign: 'center', marginTop: spacing.md, marginBottom: spacing.sm, backgroundColor: colors.subtleFill, borderRadius: radius.pill, overflow: 'hidden', paddingHorizontal: spacing.sm, paddingVertical: 2 },
  messageRow: B.messageRow,
  sentRow: B.sentRow,
  replyRow: B.replyRow,
  messageContent: B.messageContent,
  sentContent: B.sentContent,
  messageAuthor: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginBottom: 3 },
  sentAuthor: { textAlign: 'right' },
  bubble: { ...B.bubble, backgroundColor: colors.rowActive, borderRadius: radius.bubble },
  replyBubble: { ...B.replyBubble, backgroundColor: colors.card },
  replyBubbleDesktop: B.replyBubbleDesktop,
  bubbleText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  attachments: { gap: spacing.xs, marginTop: spacing.xs },
  statusMark: { color: colors.textMuted, fontSize: 10, marginTop: 2, alignSelf: 'flex-end' },
  error: { color: colors.failed, fontSize: 12, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  draftStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  draftChip: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 220, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.item, backgroundColor: colors.subtleFill },
  draftName: { flexShrink: 1, color: colors.textSecondary, fontSize: 12 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  inputWrap: { flex: 1, justifyContent: 'flex-end' },
  input: {
    flex: 1,
    backgroundColor: colors.inputBg,
    borderColor: colors.border,
    borderWidth: COMPOSER_INPUT_BORDER,
    borderRadius: radius.control,
    paddingHorizontal: spacing.lg,
    paddingVertical: composerInputPadY(composerControlSize(uiScale().densityFactor), COMPOSER_LINE_HEIGHT * uiScale().fontMultiplier),
    minHeight: composerControlSize(uiScale().densityFactor),
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    maxHeight: 120,
  },
  // flex:-1 不是 flex:0:web 上 flex:0 = `0 1 0%`(flex-zero-rule.test.ts);-1 两个引擎都是 `0 1 auto`。
  inputInWrap: { flex: -1, alignSelf: 'stretch' },
  desktopComposerWrap: { paddingHorizontal: COMPOSER_CARD_INSET, paddingBottom: COMPOSER_CARD_INSET, backgroundColor: colors.bg },
  desktopComposer: { backgroundColor: colors.card, borderRadius: radius.surface, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8, overflow: 'hidden', ...elevated('raised') },
  desktopInput: { minHeight: 21, color: colors.text, fontSize: 14, lineHeight: 21, padding: 0, textAlignVertical: 'top', outlineStyle: 'none' } as any,
  desktopToolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4, height: 38 },
  desktopToolButton: { width: 34, height: 34, borderRadius: radius.item, alignItems: 'center', justifyContent: 'center', marginLeft: -6 },
  desktopSend: { minWidth: ds(64), height: ds(32), borderRadius: radius.control, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  desktopSendDisabled: { backgroundColor: colors.subtleFill },
  desktopSendText: { color: colors.onAccent, fontSize: 13, fontWeight: '600' },
  sendTextDisabled: { color: colors.textMuted },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
