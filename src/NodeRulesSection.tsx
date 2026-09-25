// app#225 —— 节点详情页的「节点规则」区块：查看 / 编辑节点工作目录下的
// CLAUDE.md（claude 节点）或 AGENTS.md（其余运行时）。
//
// 数据流：readNodeRulesFile → hub 落请求 + 门铃 → 节点读文件 ack →
// waitForRulesFileResult 轮询到终态。保存同理走 writeNodeRulesFile。
// 🔴 这里不传路径、不传文件名（hub 工具入参里没有这些字段）；显示的文件名
// 先按运行时预测，节点回报后以回报为准。
//
// 三种可见状态分开：读取中 / 就绪（可编辑）/ 不可用（hub 旧、节点离线或
// agent-node 旧、读失败），每种都有一句话说明为什么和怎么办。

import { forwardRef, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { readNodeRulesFile, waitForRulesFileResult, writeNodeRulesFile, type HubConfig, type RulesTarget, type Session } from './api';
import { styles } from './app-styles';
import { hasUnsavedChanges, isTerminal, nextPollDelayMs, predictedRulesFileName, requestIdToFollow, rulesStatusMessage, rulesSupport, rulesUnsupportedMessage } from './node-rules';
import { NODE_RULES_EDITOR_MIN_HEIGHT } from './node-page-model';
import { colors, spacing } from './theme';
import MarkdownMessage from './MarkdownMessage';
import { buildRulesOutline, RULES_DEFAULT_MODE, rulesReadKey, rulesViewState, type RulesViewMode } from './node-rules-view';

type Phase = 'loading' | 'ready' | 'saving' | 'unavailable';

export default function NodeRulesSection({ cfg, node, session }: { cfg: HubConfig; node: RulesTarget; session: Session }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [fileName, setFileName] = useState<string>(() => predictedRulesFileName(session, node));
  const [onNode, setOnNode] = useState<string | null>(null);
  const [editor, setEditor] = useState('');
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'muted' | 'ok' | 'error'>('muted');
  const [mode, setMode] = useState<RulesViewMode>(RULES_DEFAULT_MODE);
  const [full, setFull] = useState(false);
  const fullBtn = useRef<any>(null);
  // 退出全屏后焦点回到「全屏」按钮(键盘用户不至于掉回页面顶部)。
  // Modal 卸载时 web 端会把焦点放回 body,所以等它卸完(fade 约 300 ms)再聚焦;两次都试,哪次赶上算哪次。
  const closeFull = useCallback(() => { setFull(false); for (const ms of [0, 350]) setTimeout(() => fullBtn.current?.focus?.(), ms); }, []);
  const cancelled = useRef(false);
  useEffect(() => () => { cancelled.current = true; }, []);

  const say = (text: string, tone: 'muted' | 'ok' | 'error' = 'muted') => { setMessage(text); setMessageTone(tone); };

  // 版本明确太旧就不发请求 —— 当场说清楚要升到哪一版,而不是转 60 秒圈再报超时。
  const support = rulesSupport(session);

  const runRead = useCallback(async () => {
    if (support.kind === 'unsupported') { setPhase('unavailable'); say(rulesUnsupportedMessage(support), 'error'); return; }
    setPhase('loading');
    say(`正在向节点读取 ${predictedRulesFileName(session, node)}…`);
    const enq = await readNodeRulesFile(cfg, node);
    if (cancelled.current) return;
    // 单飞被拒(request_in_flight)时 hub 带回正在跑的那条,接着等它,不报错。
    const follow = requestIdToFollow(enq);
    if (!follow) { setPhase('unavailable'); say(enq.ok ? '' : enq.error, 'error'); return; }
    const res = await waitForRulesFileResult(cfg, follow, { nextDelayMs: nextPollDelayMs, isTerminal, isCancelled: () => cancelled.current });
    if (cancelled.current) return;
    if (!res.ok) { setPhase('unavailable'); say(res.error, 'error'); return; }
    if (res.file_name) setFileName(res.file_name);
    if (res.status !== 'done') { setPhase('unavailable'); say(rulesStatusMessage(res, support), 'error'); return; }
    const content = res.content ?? '';
    setOnNode(res.exists === false ? '' : content);
    setEditor(content);
    setPhase('ready');
    say(rulesStatusMessage(res, support), 'muted');
  }, [cfg, node, session, support.kind]);

  // 只在「读哪个文件」变了时重读(rulesReadKey):节点页每次刷新都新造 node/session 对象,
  // 挂在 runRead 身份上会一刷新就重读、把没保存的草稿冲掉。手动重读走「重新读取」按钮。
  const readKey = rulesReadKey(cfg, node);
  const runReadRef = useRef(runRead);
  runReadRef.current = runRead;
  useEffect(() => { void runReadRef.current(); }, [readKey]);

  const runSave = async () => {
    if (phase !== 'ready') return;
    setPhase('saving');
    say(`正在写入 ${fileName}…`);
    const enq = await writeNodeRulesFile(cfg, node, editor);
    if (cancelled.current) return;
    if (!enq.ok) {
      // 上一条(多半是读)还没做完:等它结束再让用户重试保存,不把「等一下」说成失败。
      const follow = requestIdToFollow(enq);
      if (follow) { await waitForRulesFileResult(cfg, follow, { nextDelayMs: nextPollDelayMs, isTerminal, isCancelled: () => cancelled.current }); if (cancelled.current) return; setPhase('ready'); say('上一条请求已结束，请再点一次保存', 'muted'); return; }
      setPhase('ready'); say(enq.error, 'error'); return;
    }
    const res = await waitForRulesFileResult(cfg, enq.request_id, { nextDelayMs: nextPollDelayMs, isTerminal, isCancelled: () => cancelled.current });
    if (cancelled.current) return;
    setPhase('ready');
    if (!res.ok) { say(res.error, 'error'); return; }
    if (res.file_name) setFileName(res.file_name);
    if (res.status !== 'done') { say(rulesStatusMessage(res, support), 'error'); return; }
    setOnNode(editor);
    say(rulesStatusMessage(res, support), 'ok');
  };

  const dirty = phase === 'ready' && hasUnsavedChanges(editor, onNode);
  const toneColor = messageTone === 'ok' ? colors.running : messageTone === 'error' ? colors.failed : colors.textMuted;

  const busy = phase === 'loading' || phase === 'saving';
  const hasContent = phase === 'ready' || phase === 'saving';
  const view = rulesViewState(editor, hasContent ? onNode : null);

  const toolbar = (
    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm }}>
      <ModeToggle mode={mode} onChange={setMode} />
      <Text style={{ color: colors.text, fontSize: 13, fontFamily: MONO, flexShrink: 1 }} selectable numberOfLines={1}>{fileName}</Text>
      {view.unsaved ? <UnsavedMark /> : null}
      {phase === 'loading' ? <ActivityIndicator color={colors.accent} /> : null}
      <View style={{ flex: 1 }} />
      <Pressable style={[styles.retryBtn, busy ? { opacity: 0.4 } : null]} disabled={busy} onPress={() => void runRead()}>
        <Text style={styles.retryBtnText}>重新读取</Text>
      </Pressable>
      <Pressable style={[styles.retryBtn, !dirty && { opacity: 0.4 }]} disabled={!dirty} onPress={() => void runSave()}>
        {/* 用 retryBtnText(底色上的反色字):强调色字压在强调色底上,浅色主题下看不见(Vincent 09-02 截图里那个空白按钮)。 */}
        <Text style={styles.retryBtnText}>{phase === 'saving' ? '保存中…' : dirty ? '保存到节点' : '已是最新'}</Text>
      </Pressable>
    </View>
  );

  const bodyProps = { mode, draft: editor, onDraft: setEditor, editable: phase === 'ready', dirty, fileName };

  // 编辑框/阅读区吃满节点页剩余高度(flex: 1,最矮 NODE_RULES_EDITOR_MIN_HEIGHT);按钮放在内容**上方**
  // 的工具条里 —— 放下面的话矮窗(Vincent 的 2000×650)里要先滚页面才看得到「保存」。
  return (
    <View style={{ flex: 1, paddingTop: spacing.lg }}>
      <View style={{ flex: 1, backgroundColor: colors.card, borderRadius: 12, padding: spacing.lg, gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
          <Text style={{ flex: 1, color: colors.textMuted, fontSize: 12, lineHeight: 18 }}>
            这是节点工作目录里的 {fileName}，节点每次开工都会读它。保存会直接覆盖节点机器上的这个文件；文件名和位置由节点自己决定，这里改不了。
          </Text>
          {hasContent ? (
            <FocusRing ref={fullBtn} onPress={() => setFull(true)} accessibilityLabel="全屏阅读规则文件" style={{ paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ color: colors.textSecondary, fontSize: 12 }}>全屏</Text>
            </FocusRing>
          ) : null}
        </View>
        {toolbar}
        {message ? <Text style={{ color: phase === 'loading' ? colors.textMuted : toneColor, fontSize: 12, lineHeight: 18 }}>{message}</Text> : null}
        {hasContent && !full ? <RulesBody {...bodyProps} /> : null}
      </View>
      {full ? (
        <RulesFullscreen onClose={closeFull} toolbar={toolbar} source={view.renderSource} bodyProps={bodyProps} />
      ) : null}
    </View>
  );
}

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

function prefersReducedMotion(): boolean {
  const mm = (globalThis as any).matchMedia;
  try { return !!mm && mm('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

// 键盘焦点要看得见:web 端 Pressable 的 focused 态画一圈强调色。
const FocusRing = forwardRef<any, any>(function FocusRing({ style, children, ...rest }, ref) {
  return (
    <Pressable ref={ref} {...rest} style={(state: any) => [style, state.focused ? { outlineStyle: 'solid', outlineWidth: 2, outlineColor: colors.accent, outlineOffset: 1 } as any : null, state.hovered ? { backgroundColor: colors.rowHover } : null]}>
      {children}
    </Pressable>
  );
});

function ModeToggle({ mode, onChange }: { mode: RulesViewMode; onChange: (m: RulesViewMode) => void }) {
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: 7, padding: 2, gap: 2 }}>
      {(['read', 'edit'] as const).map((m) => (
        <FocusRing key={m} accessibilityRole="tab" accessibilityState={{ selected: mode === m }} onPress={() => onChange(m)}
          style={{ paddingHorizontal: spacing.md, paddingVertical: 3, borderRadius: 5, backgroundColor: mode === m ? colors.subtleFill : 'transparent' }}>
          <Text style={{ fontSize: 12, color: mode === m ? colors.text : colors.textMuted, fontWeight: mode === m ? '600' : '400' }}>{m === 'read' ? '阅读' : '编辑'}</Text>
        </FocusRing>
      ))}
    </View>
  );
}

function UnsavedMark() {
  return (
    <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, borderWidth: 1, borderColor: colors.blocked }}>
      <Text style={{ fontSize: 11, color: colors.blocked }}>未保存</Text>
    </View>
  );
}

function RulesBody({ mode, draft, onDraft, editable, dirty, fileName, onHeadingLayout, scrollRef }: RulesBodyProps & {
  onHeadingLayout?: (index: number, y: number) => void; scrollRef?: any;
}) {
  const frame = { flex: 1, minHeight: NODE_RULES_EDITOR_MIN_HEIGHT, borderWidth: 1, borderColor: dirty ? colors.accent : colors.border, borderRadius: 8 } as const;
  if (mode === 'read') {
    // 阅读区要和编辑框一样「吃满剩余高度、内部滚动」。直接给 ScrollView flex:1 不行:节点页外层是
    // 高度不定的滚动容器,48 KB 的文档会把它撑到一万多像素高、整页一起滚。外层 View 占位(flex:1,
    // 不贡献内容高度),ScrollView 绝对定位铺满它,滚动只发生在框内。
    return (
      <View style={frame}>
        <ScrollView ref={scrollRef} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} contentContainerStyle={{ padding: spacing.lg }}>
          {draft.trim()
            ? <MarkdownMessage onHeadingLayout={onHeadingLayout}>{draft}</MarkdownMessage>
            : <Text style={{ color: colors.textMuted, fontSize: 13 }}>{fileName} 还没有内容。切到「编辑」写点规则再保存。</Text>}
        </ScrollView>
      </View>
    );
  }
  return (
    <TextInput
      value={draft}
      onChangeText={onDraft}
      editable={editable}
      multiline
      autoCapitalize="none"
      autoCorrect={false}
      placeholder={`# ${fileName}\n\n（还没有内容，写点规则再保存）`}
      placeholderTextColor={colors.textMuted}
      textAlignVertical="top"
      style={{ ...frame, color: colors.text, padding: spacing.md, fontSize: 13, lineHeight: 19, fontFamily: MONO }}
    />
  );
}

// 全屏:盖住整个应用窗口(不是系统全屏)。左边目录(h1–h3),右边同一份内容 + 同一条工具条。
// Esc / 关闭按钮退出,焦点回到「全屏」按钮。
type RulesBodyProps = { mode: RulesViewMode; draft: string; onDraft: (s: string) => void; editable: boolean; dirty: boolean; fileName: string };

function RulesFullscreen({ onClose, toolbar, source, bodyProps }: {
  onClose: () => void; toolbar: ReactNode; source: string; bodyProps: RulesBodyProps;
}) {
  const mode = bodyProps.mode;
  const outline = buildRulesOutline(source);
  const ys = useRef<Record<number, number>>({});
  const scrollRef = useRef<any>(null);
  const closeRef = useRef<any>(null);
  useEffect(() => {
    const doc = (globalThis as any).document;
    if (!doc?.addEventListener) return;
    const onKey = (event: any) => { if (event.key === 'Escape') { event.preventDefault?.(); onClose(); } };
    doc.addEventListener('keydown', onKey);
    const t = setTimeout(() => closeRef.current?.focus?.(), 0);
    return () => { doc.removeEventListener('keydown', onKey); clearTimeout(t); };
  }, [onClose]);
  // 标题的 y 相对 MarkdownMessage 顶部;阅读区的内容容器还有一圈 padding,滚动时要加回去。
  const content = <RulesBody {...bodyProps} onHeadingLayout={(i, y) => { ys.current[i] = y + spacing.lg; }} scrollRef={scrollRef} />;
  return (
    <Modal transparent={false} visible onRequestClose={onClose} animationType={prefersReducedMotion() ? 'none' : 'fade'}>
      <View style={{ flex: 1, backgroundColor: colors.bg }} accessibilityViewIsModal>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <View style={{ flex: 1 }}>{toolbar}</View>
          <FocusRing ref={closeRef} onPress={onClose} accessibilityLabel="退出全屏(Esc)" style={{ paddingHorizontal: spacing.md, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>退出全屏 Esc</Text>
          </FocusRing>
        </View>
        <View style={{ flex: 1, flexDirection: 'row' }}>
          {outline.length ? (
            <ScrollView style={{ width: 260, flexGrow: 0, borderRightWidth: 1, borderRightColor: colors.border }} contentContainerStyle={{ padding: spacing.md, gap: 2 }}>
              <Text style={{ color: colors.textMuted, fontSize: 11, letterSpacing: 0.5, marginBottom: spacing.xs }}>目录</Text>
              {outline.map((h) => (
                <FocusRing key={h.index} disabled={mode !== 'read'} onPress={() => { const y = ys.current[h.index]; if (y != null) scrollRef.current?.scrollTo?.({ y: Math.max(0, y - 8), animated: !prefersReducedMotion() }); }}
                  style={{ paddingVertical: 4, paddingRight: spacing.sm, paddingLeft: spacing.sm + (h.level - 1) * 12, borderRadius: 5, opacity: mode === 'read' ? 1 : 0.5 }}>
                  <Text numberOfLines={2} style={{ fontSize: h.level === 1 ? 13 : 12, color: h.level === 1 ? colors.text : colors.textSecondary, fontWeight: h.level === 1 ? '600' : '400' }}>{h.text}</Text>
                </FocusRing>
              ))}
            </ScrollView>
          ) : null}
          <View style={{ flex: 1, padding: spacing.lg, alignItems: 'center' }}>
            <View style={{ flex: 1, width: '100%', maxWidth: 1080 }}>{content}</View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
