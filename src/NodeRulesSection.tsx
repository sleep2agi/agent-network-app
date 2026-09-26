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
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StatusBar, View, useWindowDimensions } from 'react-native';
import { Text, TextInput } from './ui-text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { readNodeRulesFile, waitForRulesFileResult, writeNodeRulesFile, type HubConfig, type RulesTarget, type Session } from './api';
import { hasUnsavedChanges, isTerminal, nextPollDelayMs, predictedRulesFileName, requestIdToFollow, rulesErrorMessage, rulesMaxWaitMessage, rulesReadOutcome, rulesStatusMessage, rulesSupport, rulesUnsupportedMessage, RULES_MAX_WAIT_MS } from './node-rules';
import { NODE_RULES_EDITOR_MIN_HEIGHT } from './node-page-model';
import { colors, spacing } from './theme';
import MarkdownMessage, { type MarkdownBlockLayout } from './MarkdownMessage';
import { blockAtY, blockLineForCaret, buildRulesOutline, isDoubleTap, isTap, jumpText, lineAtOffset, resolveBlockRects, RULES_DEFAULT_MODE, rulesInfoText, rulesReadKey, rulesToolbarLayout, rulesViewState, saveButtonLabel, showRulesOutline, sourceRangeFromDataset, sourceSelection, statusAutoHideMs, type BlockLayout, type RulesViewMode, type SourceLineRange, type Tap } from './node-rules-view';
import InfoTip from './InfoTip';
import MacTitleStrip from './mac-title-strip';
import WinTitleBar from './win-title-bar';
import { RulesFindBar, useRulesFind } from './RulesFind';
import { contentKey } from './rules-find';
import { editorLineHeightPx, editorScrollTopForLine, rulesFullscreenPadding, RULES_EDITOR_FONT_SIZE, RULES_EDITOR_LINE_HEIGHT } from './rules-fullscreen-layout';

type Phase = 'loading' | 'ready' | 'saving' | 'unavailable';

export default function NodeRulesSection({ cfg, node, session, onDirtyChange }: {
  cfg: HubConfig; node: RulesTarget; session: Session;
  /** 草稿和节点上的不一样了 / 又一样了。节点页用它在切分区、返回之前先问一句(草稿只活在这个组件里)。 */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [fileName, setFileName] = useState<string>(() => predictedRulesFileName(session, node));
  const [onNode, setOnNode] = useState<string | null>(null);
  const [editor, setEditor] = useState('');
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'muted' | 'ok' | 'error'>('muted');
  const [mode, setMode] = useState<RulesViewMode>(RULES_DEFAULT_MODE);
  // 双击跳源码:jump = 切到编辑后要选中的原文行;anchorLine = 编辑切回阅读时滚回光标所在块。
  const [jump, setJump] = useState<SourceLineRange | null>(null);
  const [anchorLine, setAnchorLine] = useState<number | null>(null);
  const editorRef = useRef<any>(null);
  // 原生编辑框没有 selectionStart:光标位置从 onSelectionChange 记下来(编辑切回阅读时滚回光标所在块)。
  const caretRef = useRef<number | null>(null);
  const [full, setFull] = useState(false);
  const fullBtn = useRef<any>(null);
  // 退出全屏后焦点回到「全屏」按钮(键盘用户不至于掉回页面顶部)。
  // Modal 卸载时 web 端会把焦点放回 body,所以等它卸完(fade 约 300 ms)再聚焦;两次都试,哪次赶上算哪次。
  const closeFull = useCallback(() => { setFull(false); for (const ms of [0, 350]) setTimeout(() => fullBtn.current?.focus?.(), ms); }, []);
  // 挂载标志 + 读取代数。代数:每次 runRead 自增,只有最新一次的结果能改界面 —— 读取中切走再切回、
  // 连点「重新读取」、兜底计时器已经放弃的那次,晚到的结果一律丢掉,不会把新状态盖回去。
  // (原先是一个只在卸载时置 true、从不复位的 cancelled:同一实例的 effect 被清理后再跑一次
  // —— StrictMode —— 之后每次读取都在入队后静默 return,界面停在「正在读取」。)
  const mounted = useRef(true);
  const readGen = useRef(0);
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearWatchdog = () => { if (watchdog.current) { clearTimeout(watchdog.current); watchdog.current = null; } };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; readGen.current++; clearWatchdog(); }; }, []);

  const say = (text: string, tone: 'muted' | 'ok' | 'error' = 'muted') => { setMessage(text); setMessageTone(tone); };

  // 版本明确太旧就不发请求 —— 当场说清楚要升到哪一版,而不是转 60 秒圈再报超时。
  const support = rulesSupport(session);

  const runRead = useCallback(async () => {
    const gen = ++readGen.current;
    const stale = () => !mounted.current || gen !== readGen.current;
    clearWatchdog();
    if (support.kind === 'unsupported') { setPhase('unavailable'); say(rulesUnsupportedMessage(support), 'error'); return; }
    setPhase('loading');
    say(`正在向节点读取 ${predictedRulesFileName(session, node)}…`);
    // 兜底:不管下面的 await 链卡在哪一步,RULES_MAX_WAIT_MS 后一定退出加载态、让「重新读取」可点。
    watchdog.current = setTimeout(() => {
      if (stale()) return;
      readGen.current++; // 放弃这一次:它之后就算回来了也不再改界面
      setPhase('unavailable');
      say(rulesMaxWaitMessage(), 'error');
    }, RULES_MAX_WAIT_MS);
    try {
      const enq = await readNodeRulesFile(cfg, node);
      if (stale()) return;
      // 单飞被拒(request_in_flight)时 hub 带回正在跑的那条,接着等它,不报错。
      const follow = requestIdToFollow(enq);
      if (!follow) { setPhase('unavailable'); say(enq.ok ? 'Hub 返回空响应' : enq.error, 'error'); return; }
      const res = await waitForRulesFileResult(cfg, follow, { nextDelayMs: nextPollDelayMs, isTerminal, isCancelled: stale });
      if (stale()) return;
      const out = rulesReadOutcome(res, support);
      if (out.fileName) setFileName(out.fileName);
      // 过期(content_purged)、找不到、认不出的状态、失败、超时:退出加载态、说原因,绝不当成空文件放进编辑器。
      if (out.kind === 'problem') { setPhase('unavailable'); say(out.message || '读取没有完成，请点「重新读取」', 'error'); return; }
      setOnNode(out.exists === false ? '' : out.content);
      setEditor(out.content);
      setPhase('ready');
      say(out.message, 'muted');
    } catch (e) {
      if (stale()) return;
      setPhase('unavailable');
      say(`读取出错：${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      if (gen === readGen.current) clearWatchdog();
    }
  }, [cfg, node, session, support.kind]);

  // 只在「读哪个文件」变了时重读(rulesReadKey):节点页每次刷新都新造 node/session 对象,
  // 挂在 runRead 身份上会一刷新就重读、把没保存的草稿冲掉。手动重读走「重新读取」按钮。
  const readKey = rulesReadKey(cfg, node);
  const runReadRef = useRef(runRead);
  runReadRef.current = runRead;
  useEffect(() => { void runReadRef.current(); }, [readKey]);

  const runSave = async () => {
    if (phase !== 'ready') return;
    const gone = () => !mounted.current;
    setPhase('saving');
    say(`正在写入 ${fileName}…`);
    try {
      const enq = await writeNodeRulesFile(cfg, node, editor);
      if (gone()) return;
      if (!enq.ok) {
        // 上一条(多半是读)还没做完:等它结束再让用户重试保存,不把「等一下」说成失败。
        const follow = requestIdToFollow(enq);
        if (follow) { await waitForRulesFileResult(cfg, follow, { nextDelayMs: nextPollDelayMs, isTerminal, isCancelled: gone }); if (gone()) return; setPhase('ready'); say('上一条请求已结束，请再点一次保存', 'muted'); return; }
        setPhase('ready'); say(enq.error, 'error'); return;
      }
      const res = await waitForRulesFileResult(cfg, enq.request_id, { nextDelayMs: nextPollDelayMs, isTerminal, isCancelled: gone });
      if (gone()) return;
      setPhase('ready');
      if (!res.ok) { say(rulesErrorMessage(res.error), 'error'); return; }
      if (res.file_name) setFileName(res.file_name);
      if (res.status !== 'done') { say(rulesStatusMessage(res, support), 'error'); return; }
      setOnNode(editor);
      say(rulesStatusMessage(res, support), 'ok');
    } catch (e) {
      if (gone()) return;
      setPhase('ready');
      say(`保存出错：${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  };

  const dirty = phase === 'ready' && hasUnsavedChanges(editor, onNode);
  // 「有没有没保存的改动」往上报。保存中(phase=saving)那一下 dirty 会短暂变 false,所以按草稿 vs 节点上的比,不按 phase。
  const unsavedForLeave = onNode !== null && hasUnsavedChanges(editor, onNode);
  const onDirtyRef = useRef(onDirtyChange);
  onDirtyRef.current = onDirtyChange;
  useEffect(() => { onDirtyRef.current?.(unsavedForLeave); }, [unsavedForLeave]);
  useEffect(() => () => onDirtyRef.current?.(false), []);

  // 成功/普通提示几秒后自己消失(先淡出再清掉;系统要求减少动效时不淡出、直接消失);错误和进行中的说明一直留着。
  const [fading, setFading] = useState(false);
  useEffect(() => {
    setFading(false);
    const ms = message ? statusAutoHideMs(messageTone, phase) : null;
    if (ms == null) return;
    const reduce = prefersReducedMotion();
    const fadeT = reduce ? null : setTimeout(() => setFading(true), Math.max(0, ms - 300));
    const clearT = setTimeout(() => { setMessage(''); setFading(false); }, ms);
    return () => { if (fadeT) clearTimeout(fadeT); clearTimeout(clearT); };
  }, [message, messageTone, phase]);
  const toneColor = messageTone === 'ok' ? colors.running : messageTone === 'error' ? colors.failed : colors.textMuted;

  const busy = phase === 'loading' || phase === 'saving';
  const hasContent = phase === 'ready' || phase === 'saving';
  const view = rulesViewState(editor, hasContent ? onNode : null);

  const changeMode = (next: RulesViewMode) => {
    if (next === mode) return;
    if (mode === 'edit' && next === 'read') {
      const ta = editorRef.current;
      const caret = typeof ta?.selectionStart === 'number' ? ta.selectionStart : caretRef.current;
      setAnchorLine(typeof caret === 'number' ? lineAtOffset(jumpText(ta?.value, editor), caret) : null);
    }
    setMode(next);
  };
  const jumpToSource = (range: SourceLineRange) => { setJump(range); setMode('edit'); };

  // Ctrl/⌘+F 查找 / 替换(RulesFind.tsx):阅读区、编辑框、全屏共用一份查找状态。
  const sectionRef = useRef<any>(null);
  const find = useRulesFind({
    mode, draft: editor, setDraft: setEditor, editable: phase === 'ready', hasContent, full, editorRef, sectionRef,
    jumpLine: jump ? jump.start : null, onRequestEdit: () => changeMode('edit'),
  });

  // 一行工具条:左 = 阅读/编辑 + 文件名 + ⓘ + 未保存;中 = 内联状态句;右 = 全屏 / 重新读取 / 保存(小按钮)。
  // 分区说明和卡片说明原来叠两段,现在收进 ⓘ(Vincent 09-25「这个地方占的位置太大了」)。
  const statusColor = phase === 'loading' || phase === 'saving' ? colors.textMuted : toneColor;
  // 手机竖屏上工具条会折行:状态句不再占 120 的最小宽度(否则按钮被挤到第三行),双击提示只在宽处显示(ⓘ 里有)。
  const [barWidth, setBarWidth] = useState(0);
  const bar = rulesToolbarLayout(barWidth);
  const statusLine = message ? (
    <Text
      numberOfLines={messageTone === 'error' ? undefined : 1}
      style={[{ color: statusColor, fontSize: 12, lineHeight: 18 }, WEB ? { transitionProperty: 'opacity', transitionDuration: '300ms', opacity: fading ? 0 : 1 } as any : null]}
    >{message}</Text>
  ) : mode === 'read' && hasContent && bar.showHint && !find.open ? (
    <Text numberOfLines={1} style={{ color: colors.textMuted, fontSize: 11, opacity: 0.8 }}>双击内容可跳到源码编辑</Text>
  ) : null;
  const toolbar = (inFull: boolean) => (
    <View onLayout={inFull ? undefined : (e) => setBarWidth(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm, zIndex: 10 }}>
      <ModeToggle mode={mode} onChange={changeMode} />
      <Text style={{ color: colors.text, fontSize: 13, fontFamily: MONO, flexShrink: 1 }} selectable numberOfLines={1}>{fileName}</Text>
      <InfoTip label="规则文件说明" text={rulesInfoText(fileName, true)} />
      {view.unsaved ? <UnsavedMark /> : null}
      {busy ? <ActivityIndicator size="small" color={colors.accent} /> : null}
      {find.open && inFull === full ? <RulesFindBar find={find} /> : null}
      {/* 查找栏开着时状态句让位(minWidth 0、不显示双击提示),免得把右边按钮挤到下一行。
          窄工具条(手机竖屏):这里只留一个撑开的空位把按钮推到右边,状态句放到最后单独一行。 */}
      {bar.statusOwnLine ? <View style={{ flex: 1 }} /> : (
        <View style={{ flex: 1, minWidth: find.open ? 0 : 120 }}>{statusLine}</View>
      )}
      {hasContent && !inFull ? (
        <SmallBtn ref={fullBtn} onPress={() => setFull(true)} accessibilityLabel="全屏阅读规则文件" label="全屏" />
      ) : null}
      <SmallBtn onPress={() => void runRead()} disabled={busy} label="重新读取" />
      {/* 主按钮:强调色底 + onAccent 字(强调色字压强调色底在浅色主题下看不见,Vincent 09-02 截图里那个空白按钮)。 */}
      <SmallBtn primary onPress={() => void runSave()} disabled={!dirty} label={saveButtonLabel(phase)} />
      {bar.statusOwnLine && message ? <View style={{ width: '100%' }}>{statusLine}</View> : null}
    </View>
  );

  const bodyProps: RulesBodyProps = {
    mode, draft: editor, onDraft: setEditor, editable: phase === 'ready', dirty, fileName,
    onJump: jumpToSource, jump, clearJump: () => setJump(null), anchorLine, clearAnchor: () => setAnchorLine(null), editorRef, findReadRef: find.readRef,
    onCaret: (offset) => { caretRef.current = offset; },
  };

  // 编辑框/阅读区吃满节点页剩余高度(flex: 1,最矮 NODE_RULES_EDITOR_MIN_HEIGHT);按钮在内容**上方**
  // 的工具条里 —— 放下面的话矮窗(Vincent 的 2000×650)里要先滚页面才看得到「保存」。
  return (
    <View ref={sectionRef} style={{ flex: 1 }}>
      <View style={{ flex: 1, backgroundColor: colors.card, borderRadius: 12, padding: spacing.md, gap: spacing.sm }}>
        {toolbar(false)}
        {hasContent && !full ? <RulesBody {...bodyProps} /> : null}
      </View>
      {full ? (
        <RulesFullscreen onClose={closeFull} toolbar={toolbar(true)} source={view.renderSource} bodyProps={bodyProps} />
      ) : null}
    </View>
  );
}

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const WEB = Platform.OS === 'web';
/** 工具条按钮高:桌面 30;手指点的原生端 36(再加 hitSlop,够到 48dp 的触控区)。 */
const TOUCH_BTN_HEIGHT = WEB ? 30 : 36;

// 编辑框里某个字符偏移处的 y(相对 textarea 内容顶部)。长行会折行,按行号乘行高会越滚越偏,
// 所以用一个同宽同字体的隐藏镜像 div 量真实高度。只在 web 用。
function caretTopInTextarea(ta: any, offset: number): number | null {
  const doc = (globalThis as any).document;
  const win = globalThis as any;
  if (!doc?.createElement || !win.getComputedStyle) return null;
  const cs = win.getComputedStyle(ta);
  const div = doc.createElement('div');
  for (const k of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'tabSize', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) div.style[k] = cs[k];
  Object.assign(div.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-99999px', boxSizing: 'border-box', width: `${ta.clientWidth}px`, whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: 'break-word', border: '0' });
  div.textContent = String(ta.value ?? '').slice(0, offset);
  const mark = doc.createElement('span');
  mark.textContent = '\u200b';
  div.appendChild(mark);
  doc.body.appendChild(div);
  const top = mark.offsetTop;
  div.remove();
  return top;
}

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

// 工具条小按钮(约 30px 高)。primary = 强调色底(保存);其余描边。
const SmallBtn = forwardRef<any, { label: string; onPress: () => void; disabled?: boolean; primary?: boolean; accessibilityLabel?: string }>(
  function SmallBtn({ label, onPress, disabled, primary, accessibilityLabel }, ref) {
    return (
      <FocusRing ref={ref} onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled: !!disabled }}
        hitSlop={WEB ? undefined : 6}
        style={[{ height: TOUCH_BTN_HEIGHT, paddingHorizontal: spacing.md, borderRadius: 6, justifyContent: 'center', alignItems: 'center' },
          primary ? { backgroundColor: colors.accent } : { borderWidth: 1, borderColor: colors.border },
          disabled ? { opacity: 0.4 } : null]}>
        <Text style={{ fontSize: 12, fontWeight: primary ? '600' : '400', color: primary ? colors.onAccent : colors.textSecondary }}>{label}</Text>
      </FocusRing>
    );
  });

function ModeToggle({ mode, onChange }: { mode: RulesViewMode; onChange: (m: RulesViewMode) => void }) {
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: 7, padding: 2, gap: 2 }}>
      {(['read', 'edit'] as const).map((m) => (
        <FocusRing key={m} accessibilityRole="tab" accessibilityState={{ selected: mode === m }} onPress={() => onChange(m)}
          hitSlop={WEB ? undefined : 4}
          style={{ paddingHorizontal: spacing.md, paddingVertical: WEB ? 3 : 7, borderRadius: 5, backgroundColor: mode === m ? colors.subtleFill : 'transparent' }}>
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

function RulesBody({ mode, draft, onDraft, editable, dirty, fileName, onHeadingLayout, scrollRef, onJump, jump, clearJump, anchorLine, clearAnchor, editorRef, findReadRef, onCaret }: RulesBodyProps & {
  onHeadingLayout?: (index: number, y: number) => void; scrollRef?: any;
}) {
  const frame = { flex: 1, minHeight: NODE_RULES_EDITOR_MIN_HEIGHT, borderWidth: 1, borderColor: dirty ? colors.accent : colors.border, borderRadius: 8 } as const;
  const readRef = useRef<any>(null);
  const setReadEl = useCallback((el: any) => { readRef.current = el; findReadRef?.(el); }, [findReadRef]);
  const onJumpRef = useRef(onJump);
  onJumpRef.current = onJump;
  const ownScroll = useRef<any>(null);
  const readScroll = scrollRef ?? ownScroll;

  // 原生端(没有 DOM):MarkdownMessage 逐块报布局,双击按手指的 y 找块(node-rules-view.ts blockAtY)。
  // 条目带上是哪份文字报的(docKey),草稿变了以后旧文档残留的块不参与命中。
  const docKey = contentKey(draft);
  const blocks = useRef(new Map<string, BlockLayout & { docKey: string }>());
  const onBlockLayout = useCallback((b: MarkdownBlockLayout) => { blocks.current.set(b.id, { ...b, docKey }); }, [docKey]);
  const currentRects = () => resolveBlockRects([...blocks.current.values()].filter((b) => b.docKey === docKey));
  const touchDown = useRef<{ x: number; y: number } | null>(null);
  const lastTap = useRef<Tap | null>(null);
  const originY = useRef<number | null>(null);
  const nativeTouch = WEB ? {} : {
    collapsable: false,
    onTouchStart: (e: any) => {
      const { pageX, pageY, touches } = e.nativeEvent;
      if (touches && touches.length > 1) { touchDown.current = null; return; }
      touchDown.current = { x: pageX, y: pageY };
      // 阅读内容顶部的 page 坐标(随滚动变化),和触摸点同一坐标系 ⇒ 相减就是内容里的 y。
      readRef.current?.measure?.((_x: number, _y: number, _w: number, _h: number, _px: number, py: number) => { originY.current = py; });
    },
    onTouchEnd: (e: any) => {
      const { pageX, pageY } = e.nativeEvent;
      const down = touchDown.current;
      touchDown.current = null;
      if (!down || !isTap(down, { x: pageX, y: pageY })) { lastTap.current = null; return; }
      const tap = { t: Date.now(), x: pageX, y: pageY };
      if (!isDoubleTap(lastTap.current, tap)) { lastTap.current = tap; return; }
      lastTap.current = null;
      const range = originY.current == null ? null : blockAtY(currentRects(), pageY - originY.current);
      if (range) onJumpRef.current(range);
    },
  };

  // 阅读区:双击任意带行号的块 → 跳到编辑框里对应的原文行。原生双击会选中一个词,这里只在规则阅读区里接管。
  useEffect(() => {
    const el = readRef.current;
    if (mode !== 'read' || !el?.addEventListener) return;
    const onDbl = (event: any) => {
      const hit = event.target?.closest?.('[data-md-line]');
      const range = hit ? sourceRangeFromDataset(hit.dataset) : null;
      if (!range) return;
      event.preventDefault?.();
      (globalThis as any).getSelection?.()?.removeAllRanges?.();
      onJumpRef.current(range);
    };
    el.addEventListener('dblclick', onDbl);
    return () => el.removeEventListener('dblclick', onDbl);
  }, [mode, draft.trim() === '']);

  // 编辑框:刚从双击切过来 ⇒ 选中那几行、滚到框中间。等 textarea 挂上再做。
  useEffect(() => {
    if (mode !== 'edit' || !jump) return;
    const t = setTimeout(() => {
      const ta = editorRef.current;
      if (!ta) return;
      const sel = sourceSelection(jumpText(ta.value, draft), jump);
      ta.focus?.();
      if (!WEB) {
        // 原生 TextInput:setSelection 选中并让光标滚进可见区。键盘弹起、编辑框被压矮以后再选一次,
        // 免得选中的那几行落在键盘后面。
        // (这个补选不随 effect 清理:clearJump 触发的重渲染会立刻清掉它。编辑框卸了就是 ref 为空,空操作。)
        onCaret?.(sel.start);
        ta.setSelection?.(sel.start, sel.end);
        setTimeout(() => editorRef.current?.setSelection?.(sel.start, sel.end), 350);
        clearJump();
        return;
      }
      ta.setSelectionRange?.(sel.start, sel.end);
      const top = caretTopInTextarea(ta, sel.start);
      if (top != null && ta.clientHeight) {
        const lh = editorLineHeightPx((globalThis as any).getComputedStyle?.(ta)?.lineHeight);
        ta.scrollTop = editorScrollTopForLine(top, ta.clientHeight, lh);
      }
      clearJump();
    }, 0);
    return () => clearTimeout(t);
  }, [mode, jump]);

  // 阅读区:刚从编辑切回来 ⇒ 滚到光标所在的那一块。
  useEffect(() => {
    if (mode !== 'read' || anchorLine == null) return;
    const t = setTimeout(() => {
      const root = readRef.current;
      if (!WEB) {
        // 原生:用块布局找光标所在块,滚到它(等 onLayout 报上来,所以晚一点)。
        const rects = currentRects();
        const line = blockLineForCaret(rects.map((r) => r.start), anchorLine);
        const rect = line == null ? null : rects.find((r) => r.start === line);
        if (rect) readScroll.current?.scrollTo?.({ y: Math.max(0, rect.top + spacing.lg - 80), animated: false });
        clearAnchor();
        return;
      }
      const nodes: any[] = root?.querySelectorAll ? Array.from(root.querySelectorAll('[data-md-line]')) : [];
      const starts = nodes.map((n) => Number(n.dataset.mdLine)).filter((n) => Number.isInteger(n));
      const line = blockLineForCaret(starts, anchorLine);
      const target = line == null ? null : nodes.find((n) => Number(n.dataset.mdLine) === line);
      target?.scrollIntoView?.({ block: 'center' });
      clearAnchor();
    }, WEB ? 0 : 200);
    return () => clearTimeout(t);
  }, [mode, anchorLine]);

  if (mode === 'read') {
    // 阅读区要和编辑框一样「吃满剩余高度、内部滚动」。直接给 ScrollView flex:1 不行:节点页外层是
    // 高度不定的滚动容器,48 KB 的文档会把它撑到一万多像素高、整页一起滚。外层 View 占位(flex:1,
    // 不贡献内容高度),ScrollView 绝对定位铺满它,滚动只发生在框内。
    return (
      <View style={frame}>
        {/* nestedScrollEnabled:Android 上它万一又被放进可滚的父级里,手势也归它而不是被外层抢走。 */}
        <ScrollView ref={readScroll} nestedScrollEnabled style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} contentContainerStyle={{ padding: spacing.lg }}>
          {draft.trim()
            ? <View ref={setReadEl} {...nativeTouch}><MarkdownMessage onHeadingLayout={onHeadingLayout} key={docKey} sourceLines={WEB} onBlockLayout={WEB ? undefined : onBlockLayout}>{draft}</MarkdownMessage></View>
            : <Text style={{ color: colors.textMuted, fontSize: 13 }}>{fileName} 还没有内容。切到「编辑」写点规则再保存。</Text>}
        </ScrollView>
      </View>
    );
  }
  return (
    <TextInput
      ref={editorRef}
      value={draft}
      onChangeText={onDraft}
      onSelectionChange={(e) => onCaret?.(e.nativeEvent.selection.start)}
      editable={editable}
      multiline
      scrollEnabled
      spellCheck={false}
      autoCapitalize="none"
      autoCorrect={false}
      placeholder={`# ${fileName}\n\n（还没有内容，写点规则再保存）`}
      placeholderTextColor={colors.textMuted}
      textAlignVertical="top"
      style={{ ...frame, color: colors.text, padding: spacing.md, fontSize: RULES_EDITOR_FONT_SIZE, lineHeight: RULES_EDITOR_LINE_HEIGHT, fontFamily: MONO }}
    />
  );
}

// 全屏:盖住整个应用窗口(不是系统全屏)。左边目录(h1–h3),右边同一份内容 + 同一条工具条。
// Esc / 关闭按钮退出,焦点回到「全屏」按钮。
type RulesBodyProps = {
  mode: RulesViewMode; draft: string; onDraft: (s: string) => void; editable: boolean; dirty: boolean; fileName: string;
  onJump: (range: SourceLineRange) => void; jump: SourceLineRange | null; clearJump: () => void;
  anchorLine: number | null; clearAnchor: () => void; editorRef: any;
  /** 查找:阅读区容器(遍历文本节点、挂高亮用)。 */
  findReadRef?: (el: any) => void;
  /** 编辑框光标位置(原生端读不到 selectionStart,靠这个记)。 */
  onCaret?: (offset: number) => void;
};

function RulesFullscreen({ onClose, toolbar, source, bodyProps }: {
  onClose: () => void; toolbar: ReactNode; source: string; bodyProps: RulesBodyProps;
}) {
  const mode = bodyProps.mode;
  const outline = buildRulesOutline(source);
  // 手机竖屏放不下 260 宽的目录:窄窗只留正文。
  const { width: windowWidth } = useWindowDimensions();
  const withOutline = showRulesOutline(windowWidth, outline.length);
  const ys = useRef<Record<number, number>>({});
  const scrollRef = useRef<any>(null);
  const closeRef = useRef<any>(null);
  // Android edge-to-edge 下 Modal 恒画到状态栏 / 挖孔底下(见 rules-fullscreen-layout.ts ①):四边按安全区垫。
  const safe = rulesFullscreenPadding(Platform.OS, useSafeAreaInsets(), StatusBar.currentHeight);
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
      <View style={[{ flex: 1, backgroundColor: colors.bg }, safe]} accessibilityViewIsModal>
        {/* Modal 是 position:fixed 铺满整个窗口的,App.tsx 顶上那条 MacTitleStrip 被它盖住了 ⇒ macOS 的
            红黄绿灯直接压在「阅读/编辑」上(Vincent 0.2.94 截图)。这里再挂同一个组件:28px 空带 +
            data-tauri-drag-region,只在 Tauri+macOS 渲染,Windows/Linux/网页返回 null、布局不变。
            Windows 同理:decorations=false,自绘的 WinTitleBar(最小化/最大化/关闭 + 拖动)也被盖住 ⇒
            同样再挂一次;它自己只在 Tauri+Windows 渲染。两者平台互斥,任何平台最多出一条。 */}
        <MacTitleStrip />
        <WinTitleBar />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <View style={{ flex: 1 }}>{toolbar}</View>
          <FocusRing ref={closeRef} onPress={onClose} accessibilityLabel="退出全屏(Esc)" style={{ paddingHorizontal: spacing.md, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{WEB ? '退出全屏 Esc' : '退出全屏'}</Text>
          </FocusRing>
        </View>
        <View style={{ flex: 1, flexDirection: 'row' }}>
          {withOutline ? (
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
          <View style={{ flex: 1, padding: withOutline ? spacing.lg : spacing.sm, alignItems: 'center' }}>
            <View style={{ flex: 1, width: '100%', maxWidth: 1080 }}>{content}</View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
