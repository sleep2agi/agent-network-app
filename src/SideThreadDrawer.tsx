import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { HubConfig } from './api';
import MarkdownMessage from './MarkdownMessage';
import { shouldSubmitBtwOnEnter } from './btw-command';
import {
  createSideThreadClient,
  createSideThreadRequestKey,
  SideThreadApiError,
  subscribeSideThreadUpdates,
  type SideThreadCapability,
} from './side-thread-api';
import {
  markSideThreadAction,
  markSideThreadBroughtBack,
  mergeSideThreadRecords,
  SIDE_THREAD_STATE_LABELS,
  sideThreadActionAvailability,
  upsertSideThreadRecord,
  type SideThreadCard,
  type SideThreadCardAction,
} from './side-thread-model';
import { colors, onThemeChange, spacing } from './theme';

export interface SideThreadLaunch {
  id: number;
  prompt?: string;
}

interface Props {
  cfg: HubConfig;
  alias: string;
  desktop: boolean;
  launch?: SideThreadLaunch;
}

type CapabilityView =
  | { kind: 'checking' }
  | { kind: 'ready'; value: SideThreadCapability }
  | { kind: 'unsupported'; title: string; detail: string }
  | { kind: 'error'; detail: string };

const capabilityFailure = (error: unknown): CapabilityView => {
  if (error instanceof SideThreadApiError && error.code === 'SIDE_THREAD_DISABLED') {
    return { kind: 'unsupported', title: 'BTW 尚未开放', detail: '当前 Hub 没有开启旁路线程功能。主会话不会被代替或排队发送。' };
  }
  if (error instanceof SideThreadApiError && error.code === 'SIDE_THREAD_UNSUPPORTED') {
    return { kind: 'unsupported', title: '当前节点不支持 BTW', detail: error.message || '该节点没有经过验证的独立旁路线程能力。' };
  }
  if (error instanceof SideThreadApiError && error.code === 'SIDE_THREAD_PROTOCOL_ERROR') {
    return { kind: 'unsupported', title: 'Hub 版本不支持 BTW', detail: 'Hub 未返回完整的 SideThread capability，请升级后再试。' };
  }
  return { kind: 'error', detail: error instanceof Error ? error.message : '无法检查 BTW 能力' };
};

const stateColor = (state: SideThreadCard['state']) => {
  if (state === 'failed') return colors.failed;
  if (state === 'running' || state === 'creating' || state === 'succeeded') return colors.running;
  return colors.textMuted;
};

export default function SideThreadDrawer({ cfg, alias, desktop, launch }: Props) {
  const client = useMemo(() => createSideThreadClient(cfg), [cfg.serverUrl, cfg.token, cfg.networkId]);
  const [visible, setVisible] = useState(false);
  const [question, setQuestion] = useState('');
  const [cards, setCards] = useState<SideThreadCard[]>([]);
  const [capability, setCapability] = useState<CapabilityView>({ kind: 'checking' });
  const [refreshing, setRefreshing] = useState(false);
  const [createError, setCreateError] = useState('');
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const generationRef = useRef(0);
  const handledLaunchRef = useRef(0);
  const pendingPromptRef = useRef<string | undefined>(undefined);

  const refreshCards = useCallback(async (showSpinner = false) => {
    const generation = generationRef.current;
    if (showSpinner) setRefreshing(true);
    try {
      const records = await client.list(alias);
      if (generation !== generationRef.current) return;
      setCards(current => mergeSideThreadRecords(current, records));
    } catch (error) {
      if (generation !== generationRef.current) return;
      const view = capabilityFailure(error);
      if (view.kind === 'unsupported') setCapability(view);
      else setCreateError(view.kind === 'error' ? view.detail : '无法读取 BTW');
    } finally {
      if (generation === generationRef.current && showSpinner) setRefreshing(false);
    }
  }, [alias, client]);

  const checkCapability = useCallback(async () => {
    const generation = generationRef.current;
    setCapability({ kind: 'checking' });
    setCreateError('');
    try {
      const value = await client.capability(alias);
      if (generation !== generationRef.current) return;
      if (!value.enabled) {
        setCapability({ kind: 'unsupported', title: 'BTW 尚未开放', detail: value.reason || '当前 Hub 没有开启旁路线程功能。' });
        return;
      }
      if (!value.supported || !value.context) {
        setCapability({ kind: 'unsupported', title: '当前节点不支持 BTW', detail: value.reason || '该节点没有可验证的独立旁路线程能力。' });
        return;
      }
      setCapability({ kind: 'ready', value });
      await refreshCards(true);
    } catch (error) {
      if (generation === generationRef.current) setCapability(capabilityFailure(error));
    }
  }, [alias, client, refreshCards]);

  useEffect(() => {
    generationRef.current += 1;
    setVisible(false);
    setQuestion('');
    setCards([]);
    setCapability({ kind: 'checking' });
    setCreateError('');
    setActionErrors({});
    pendingPromptRef.current = undefined;
  }, [alias, cfg.profileId, cfg.serverUrl]);

  useEffect(() => {
    if (!launch || launch.id === handledLaunchRef.current) return;
    handledLaunchRef.current = launch.id;
    pendingPromptRef.current = launch.prompt;
    setQuestion(launch.prompt ?? '');
    setVisible(true);
    void checkCapability();
  }, [launch, checkCapability]);

  const create = useCallback(async (rawPrompt: string) => {
    const prompt = rawPrompt.trim();
    if (!prompt) {
      setCreateError('请输入旁路问题');
      return;
    }
    if (capability.kind !== 'ready' || !capability.value.context) {
      setCreateError('BTW capability 尚未就绪，未发送到普通任务队列');
      return;
    }
    const requestKey = createSideThreadRequestKey('create');
    const optimisticId = `pending:${requestKey}`;
    const now = Date.now();
    setCreateError('');
    setQuestion('');
    setCards(current => [{
      id: optimisticId,
      prompt,
      state: 'creating',
      sourceThreadId: capability.value.context!.sourceThreadId,
      createdAt: now,
      updatedAt: now,
    }, ...current]);
    try {
      const record = await client.create({
        requestKey,
        ...capability.value.context,
        prompt,
      });
      setCards(current => upsertSideThreadRecord(current.filter(card => card.id !== optimisticId), record));
    } catch (error) {
      setCards(current => current.filter(card => card.id !== optimisticId));
      const view = capabilityFailure(error);
      if (view.kind === 'unsupported') setCapability(view);
      setCreateError(view.kind === 'unsupported' ? view.detail : view.kind === 'error' ? view.detail : 'BTW 创建失败');
    }
  }, [capability, client]);

  // A `/btw question` launch submits exactly once, after the capability call
  // supplies an exact source boundary. It is never re-routed through sendTask.
  useEffect(() => {
    if (capability.kind !== 'ready' || pendingPromptRef.current === undefined) return;
    const prompt = pendingPromptRef.current;
    pendingPromptRef.current = undefined;
    if (prompt) void create(prompt);
  }, [capability, create]);

  useEffect(() => {
    if (!visible || capability.kind !== 'ready') return;
    return subscribeSideThreadUpdates(
      client,
      alias,
      records => setCards(current => mergeSideThreadRecords(current, records)),
      error => {
        const view = capabilityFailure(error);
        if (view.kind === 'unsupported') setCapability(view);
      },
    );
  }, [visible, capability.kind, client, alias]);

  const runAction = async (card: SideThreadCard, action: SideThreadCardAction) => {
    setCards(current => markSideThreadAction(current, card.id, action));
    setActionErrors(current => ({ ...current, [card.id]: '' }));
    try {
      if (action === 'cancel') {
        const record = await client.cancel(card.id);
        setCards(current => upsertSideThreadRecord(current, record));
      } else if (action === 'retry') {
        const record = await client.retry(card.id, {
          requestKey: createSideThreadRequestKey('retry'),
          prompt: card.prompt,
        });
        setCards(current => upsertSideThreadRecord(current, record));
      } else if (action === 'archive') {
        const record = await client.archive(card.id);
        setCards(current => upsertSideThreadRecord(current, record));
      } else {
        await client.bringBack(card.id, {
          requestKey: createSideThreadRequestKey('bring-back'),
          destinationThreadId: card.sourceThreadId,
          ...(card.latestAttemptId ? { attemptId: card.latestAttemptId } : {}),
        });
        setCards(current => markSideThreadBroughtBack(current, card.id));
      }
    } catch (error) {
      setCards(current => markSideThreadAction(current, card.id));
      setActionErrors(current => ({
        ...current,
        [card.id]: error instanceof Error ? error.message : `${action} 失败`,
      }));
    }
  };

  const renderCard = ({ item: card }: { item: SideThreadCard }) => {
    const actions = sideThreadActionAvailability(card);
    return (
      <View style={styles.card} testID={`btw-card-${card.id}`}>
        <View style={styles.cardHeader}>
          <Text style={styles.badge}>BTW</Text>
          <Text style={[styles.state, { color: stateColor(card.state) }]}>{SIDE_THREAD_STATE_LABELS[card.state]}</Text>
          {card.pendingAction ? <ActivityIndicator size="small" color={colors.accent} /> : null}
        </View>
        <Text style={styles.prompt}>{card.prompt}</Text>
        {card.result ? <View style={styles.answer}><MarkdownMessage>{card.result}</MarkdownMessage></View> : null}
        {card.error ? <Text style={styles.error}>{card.error}</Text> : null}
        {actionErrors[card.id] ? <Text style={styles.error}>{actionErrors[card.id]}</Text> : null}
        {card.broughtBack ? <Text style={styles.broughtBack}>已显式带回主会话 ✓</Text> : null}
        <View style={styles.actions}>
          {actions.cancel ? <Action label="取消" onPress={() => void runAction(card, 'cancel')} danger /> : null}
          {actions.retry ? <Action label="重试" onPress={() => void runAction(card, 'retry')} /> : null}
          {actions.bringBack ? <Action label="带回主会话" onPress={() => void runAction(card, 'bring-back')} /> : null}
          {actions.archive ? <Action label="归档" onPress={() => void runAction(card, 'archive')} muted /> : null}
        </View>
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => setVisible(false)}
      testID="btw-drawer"
    >
      <Pressable style={[styles.backdrop, desktop && styles.desktopBackdrop]} onPress={() => setVisible(false)}>
        <Pressable style={[styles.panel, desktop ? styles.desktopPanel : styles.mobilePanel]} onPress={() => {}}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>BTW · 旁路线程</Text>
              <Text style={styles.subtitle} numberOfLines={1}>{alias} · 不打断、不写入主会话</Text>
            </View>
            <Pressable accessibilityLabel="关闭 BTW" onPress={() => setVisible(false)} hitSlop={10}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </Pressable>
          </View>

          {capability.kind === 'checking' ? (
            <View style={styles.center}><ActivityIndicator color={colors.accent} /><Text style={styles.muted}>正在验证独立旁路能力…</Text></View>
          ) : capability.kind === 'unsupported' ? (
            <View style={styles.notice} testID="btw-unsupported">
              <Ionicons name="ban-outline" size={28} color={colors.blocked} />
              <Text style={styles.noticeTitle}>{capability.title}</Text>
              <Text style={styles.noticeText}>{capability.detail}</Text>
              <Text style={styles.failClosed}>不会降级为普通发送、优先任务或 steer。</Text>
              <Action label="重新检查" onPress={() => void checkCapability()} />
            </View>
          ) : capability.kind === 'error' ? (
            <View style={styles.notice}>
              <Text style={styles.noticeTitle}>暂时无法检查 BTW</Text>
              <Text style={styles.noticeText}>{capability.detail}</Text>
              <Action label="重试" onPress={() => void checkCapability()} />
            </View>
          ) : (
            <>
              <View style={styles.composer}>
                <TextInput
                  testID="btw-question-input"
                  style={styles.input}
                  value={question}
                  onChangeText={setQuestion}
                  placeholder="顺手问一个不打断主任务的问题…"
                  placeholderTextColor={colors.textMuted}
                  multiline
                  onKeyPress={(event) => {
                    if (Platform.OS !== 'web') return;
                    const native = event.nativeEvent as typeof event.nativeEvent & {
                      ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean;
                      isComposing?: boolean; keyCode?: number; which?: number;
                    };
                    if (!shouldSubmitBtwOnEnter(native)) return;
                    event.preventDefault?.();
                    void create(question);
                  }}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="创建 BTW"
                  disabled={!question.trim()}
                  style={[styles.askButton, !question.trim() && styles.buttonDisabled]}
                  onPress={() => void create(question)}
                >
                  <Text style={[styles.askButtonText, !question.trim() && styles.buttonTextDisabled]}>旁路提问</Text>
                </Pressable>
              </View>
              {createError ? <Text style={styles.createError}>{createError}</Text> : null}
              <View style={styles.listHeader}>
                <Text style={styles.listTitle}>旁路记录</Text>
                <Pressable onPress={() => void refreshCards(true)} disabled={refreshing} hitSlop={8}>
                  {refreshing ? <ActivityIndicator size="small" color={colors.accent} /> : <Ionicons name="refresh" size={18} color={colors.textSecondary} />}
                </Pressable>
              </View>
              <FlatList
                data={cards}
                keyExtractor={card => card.id}
                renderItem={renderCard}
                contentContainerStyle={cards.length ? styles.list : styles.emptyList}
                ListEmptyComponent={<Text style={styles.muted}>还没有 BTW。旁路回答默认只留在这里。</Text>}
              />
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Action({ label, onPress, danger, muted }: { label: string; onPress: () => void; danger?: boolean; muted?: boolean }) {
  return (
    <Pressable style={({ pressed }) => [styles.action, pressed && { opacity: 0.65 }]} onPress={onPress}>
      <Text style={[styles.actionText, danger && { color: colors.failed }, muted && { color: colors.textMuted }]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = () => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.48)', justifyContent: 'flex-end' },
  desktopBackdrop: { alignItems: 'flex-end' },
  panel: { backgroundColor: colors.bg, borderColor: colors.border },
  desktopPanel: { width: 440, maxWidth: '92%', height: '100%', borderLeftWidth: 1 },
  mobilePanel: { width: '100%', height: '86%', borderTopWidth: 1, borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  subtitle: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  notice: { margin: spacing.lg, padding: spacing.xl, alignItems: 'center', gap: spacing.md, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  noticeTitle: { color: colors.text, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  noticeText: { color: colors.textSecondary, fontSize: 13, lineHeight: 20, textAlign: 'center' },
  failClosed: { color: colors.blocked, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, padding: spacing.lg, paddingBottom: spacing.sm },
  input: { flex: 1, minHeight: 64, maxHeight: 120, paddingHorizontal: spacing.md, paddingVertical: 10, color: colors.text, backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border, borderRadius: 10, textAlignVertical: 'top' },
  askButton: { height: 38, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: colors.accent },
  askButtonText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  buttonDisabled: { backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.border },
  buttonTextDisabled: { color: colors.textMuted },
  createError: { color: colors.failed, fontSize: 12, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  listTitle: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
  emptyList: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  muted: { color: colors.textMuted, fontSize: 12, textAlign: 'center' },
  card: { padding: spacing.lg, gap: spacing.sm, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  badge: { color: colors.accent, fontSize: 10, fontWeight: '800', borderWidth: 1, borderColor: colors.accent, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  state: { flex: 1, fontSize: 11, fontWeight: '700' },
  prompt: { color: colors.text, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  answer: { paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  error: { color: colors.failed, fontSize: 12, lineHeight: 18 },
  broughtBack: { color: colors.running, fontSize: 11 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: spacing.md, paddingTop: spacing.xs },
  action: { minHeight: 30, justifyContent: 'center', paddingHorizontal: spacing.xs },
  actionText: { color: colors.accent, fontSize: 12, fontWeight: '700' },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
