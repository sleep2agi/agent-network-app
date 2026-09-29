// 任务详情的「描述」:markdown 编辑 / 预览,可以放图片,可以 ⤢ 全屏,可以语音输入。
//   桌面:Ctrl/⌘+V 粘贴截图、把图片拖进编辑框、🖼 按钮选文件;手机:🖼 按钮打开相册(没有拖放)。
//   图片走聊天同一条上传路(/api/upload,12MB),带 network_id 归到当前网络;在光标处插入
//   `![名字](/api/files/<id>)`(独占一行)。
//   预览用 MarkdownMessage(和聊天同一个渲染器),Hub 图片带 Authorization 头下载 —— 地址里不放 token;
//   点图:桌面开 #464 的独立图片窗口,手机 / 纯网页用 App 内的 ImageViewer。
//   全屏与语音:手机 / 桌面各一套,见 task-description-fullscreen-model.ts;画在 TaskDescriptionFullscreen.tsx。
//   语音和聊天是同一套:useVoiceInput(识别)+ voice-insert-model(按下那一刻冻结选区、插到光标处)。
//   所见即所得(owner 09-30):桌面 / 网页的鼠标界面,小编辑框是 富文本 / 源码,全屏的「阅读」是可编辑的富文本
//   (RichDescriptionEditor.web.tsx;往返规则见 rich-markdown.ts)。富文本时语音、图片插到富文本编辑器的选区。
//   描述里有富文本保不住的内容(HTML 等)时退回原来的 编辑 / 预览,并说明原因。手机不变(原因见 task-description-fullscreen-model.ts)。
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, View, type GestureResponderEvent } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import MarkdownMessage from './MarkdownMessage';
import AuthedThumb from './AuthedThumb';
import AuthedWebThumb from './AuthedWebThumb';
import ImageViewer from './ImageViewer';
import { colors, spacing } from './theme';
import { t } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-chat';
import './i18n-tasks';
import type { HubConfig } from './api';
import { pickImages, uploadImage, type PickedImage } from './attach';
import { attachmentFromFile, filesFromTransfer, transferHasFiles } from './desktop-file-intake';
import { openGallery, type ViewerImage, type ViewerState } from './image-viewer-model';
import { imagePreviewSurface, imageWindowPayload } from './image-window-model';
import { openImageWindow } from './image-window';
import { DESCRIPTION_MAX } from './task-board-model';
import { checkDescriptionImage, descriptionImages, hubImageMarkdown, imageAlt, insertAtCaret } from './task-description-images';
import { Segmented, useTaskStyles } from './TaskBoardParts';
import { fieldStyles } from './TaskCreateDialog';
import type { RulesViewMode } from './node-rules-view';
import { rulesSplitAvailable } from './rules-split';
import { descriptionEditable, desktopFullscreenMode, fullscreenKind, initialInlineMode, inlineModeAfterFullscreen, inlineModeFor, richEditorActive, settingsPromptKind, voiceEntry, type InlineMode } from './task-description-fullscreen-model';
import { loadRich, RICH_EDITOR_AVAILABLE, RichDescriptionEditor, richSafetyNow } from './rich-support';
import type { RichEditorHandle } from './rich-editor-types';
import { DesktopDescriptionFullscreen, PhoneDescriptionPage, type EditorBinding } from './TaskDescriptionFullscreen';
import { useVoiceInput } from './useVoiceInput';
import { VoiceHoldBar, VoiceSettingsPrompt } from './VoiceInputUI';
import { DesktopMicButton, DesktopVoiceBar } from './DesktopVoiceBar';
import { DESKTOP_CLICK_EVENT, desktopVoiceNotice, micClickAction, showVoiceBar } from './desktop-voice-bar-model';
import { holdOverlayApplies, zoneAt as holdZoneAt, type HoldOverlayLayout } from './voice-hold-overlay-model';
import { beginVoicePress, createSelectionCapture, hostSelection, insertAtSelection, refocusAfterInsert, voiceInsertTarget, withPressStart, type TextSelection, type VoiceSource } from './voice-insert-model';
import { TOO_SHORT_NOTICE } from './voice-input-model';
import { KBD_IDLE, kbdVoiceBlur, kbdVoiceKeyDown, kbdVoiceKeyUp, kbdVoiceSync, type KbdVoiceMode, type KbdVoiceState, type KbdVoiceStep } from './voice-shortcut-model';
import { comboChips, comboFromEvent, shortcutForCombo } from './shortcuts-model';
import { isMacKeyboard, shortcutBindings, shortcutCaptureActive } from './shortcuts-store';

type Upload = { id: string; name: string; state: 'uploading' | 'error'; message?: string };

// 编辑框粘贴截图 / 拖入图片(只 web)。纯文字粘贴不拦(照常进输入框)。
function useImageIntake(enabled: boolean, input: any, box: any, add: (images: PickedImage[]) => void, setDragOver: (on: boolean) => void) {
  const addRef = useRef(add);
  addRef.current = add;
  useEffect(() => {
    if (!enabled || Platform.OS !== 'web' || !input?.addEventListener || !box?.addEventListener) return;
    const onPaste = (e: any) => {
      const files = filesFromTransfer(e.clipboardData);
      if (!files.length) return;
      e.preventDefault?.();
      addRef.current(files.map(file => attachmentFromFile(file)));
    };
    const onDragOver = (e: any) => { if (transferHasFiles(e.dataTransfer)) { e.preventDefault?.(); setDragOver(true); } };
    const onDragLeave = () => setDragOver(false);
    const onDrop = (e: any) => {
      const files = filesFromTransfer(e.dataTransfer);
      setDragOver(false);
      if (!files.length) return;
      e.preventDefault?.();
      addRef.current(files.map(file => attachmentFromFile(file)));
    };
    input.addEventListener('paste', onPaste);
    box.addEventListener('dragover', onDragOver);
    box.addEventListener('dragleave', onDragLeave);
    box.addEventListener('drop', onDrop);
    return () => {
      input.removeEventListener('paste', onPaste);
      box.removeEventListener('dragover', onDragOver);
      box.removeEventListener('dragleave', onDragLeave);
      box.removeEventListener('drop', onDrop);
    };
  }, [enabled, input, box, setDragOver]);
}

// 桌面语音快捷键(设置 → 快捷键 → 输入:按住说话 / 语音输入开关),和聊天页同一个状态机(voice-shortcut-model.ts)。
// 只在描述可编辑时挂;挂在 window 的捕获阶段,接住的键 DesktopWorkspace(document 捕获)就不再提示「先打开一个会话」。
function useVoiceShortcuts(active: boolean, actions: { voice: ReturnType<typeof useVoiceInput>; start: () => void; done: () => void; cancel: () => void; notice: (text: string) => void }) {
  const [kbd, setKbd] = useState<{ mode: KbdVoiceMode; combo: string } | null>(null);
  const stateRef = useRef<KbdVoiceState>(KBD_IDLE);
  const ref = useRef(actions);
  ref.current = actions;
  useEffect(() => {
    const win = (globalThis as any).window;
    const doc = (globalThis as any).document;
    if (!active || !win?.addEventListener) return;
    const mac = isMacKeyboard();
    const run = (r: KbdVoiceStep, event?: Event) => {
      stateRef.current = r.state;
      if (r.consume) { event?.preventDefault(); event?.stopPropagation(); }
      const { voice: v, start, done, cancel, notice } = ref.current;
      if (r.effect === 'press') {
        if (!v.available) { notice(t('chat.voiceUnavailable')); stateRef.current = KBD_IDLE; return; }
        start();
        // 未配置:🎤 那条路弹「去设置」提示、不开录 —— 键盘这边不进入录音态。
        if (!v.configured) stateRef.current = KBD_IDLE;
        else if (r.state.mode !== 'idle') setKbd({ mode: r.state.mode, combo: r.state.combo });
      } else if (r.effect === 'release') done();
      else if (r.effect === 'cancel') cancel();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || shortcutCaptureActive()) return;
      const combo = comboFromEvent(e, mac);
      const id = shortcutForCombo(shortcutBindings(), combo);
      const shortcut = id === 'input.voiceHold' ? 'hold' : id === 'input.voiceToggle' ? 'toggle' : null;
      const escape = e.key === 'Escape' || e.key === 'Esc';
      if (!shortcut && !escape) return;
      run(kbdVoiceKeyDown(stateRef.current, { shortcut, combo, repeat: e.repeat, escape }, { composer: true, voiceIdle: ref.current.voice.state.phase === 'idle' }), e);
    };
    const onKeyUp = (e: KeyboardEvent) => run(kbdVoiceKeyUp(stateRef.current, e, mac), e);
    const onBlur = () => run(kbdVoiceBlur(stateRef.current));
    const onVisibility = () => { if (doc?.visibilityState === 'hidden') onBlur(); };
    win.addEventListener('keydown', onKeyDown, true);
    win.addEventListener('keyup', onKeyUp, true);
    win.addEventListener('blur', onBlur);
    doc?.addEventListener?.('visibilitychange', onVisibility);
    return () => {
      win.removeEventListener('keydown', onKeyDown, true);
      win.removeEventListener('keyup', onKeyUp, true);
      win.removeEventListener('blur', onBlur);
      doc?.removeEventListener?.('visibilitychange', onVisibility);
    };
  }, [active]);
  const phase = actions.voice.state.phase;
  useEffect(() => {
    stateRef.current = kbdVoiceSync(stateRef.current, phase);
    if (phase === 'idle') setKbd(null);
  }, [phase]);
  return kbd;
}

export default function TaskDescriptionEditor({ cfg, value, onChange, pointer, title, dirty = false, onOpenVoiceSettings }: {
  cfg: HubConfig;
  value: string;
  onChange: (v: string) => void;
  /** 鼠标界面:可粘贴 / 拖放图片,点图开独立窗口,全屏是桌面编辑器,语音是 🎤 + 录音条。 */
  pointer: boolean;
  /** 图片窗口的标题(任务名)。 */
  title: string;
  /** 详情里有没保存的修改(全屏里提示;未配置语音时不给「去设置」跳转,免得丢草稿)。 */
  dirty?: boolean;
  /** 设置 → 语音输入。 */
  onOpenVoiceSettings?: () => void;
}) {
  useTranslation();
  const s = useTaskStyles();
  const f = fieldStyles();
  // 富文本只在鼠标界面的 web(桌面壳 / 网页);这段描述还得能保真地进富文本(richSafety)。
  const richCapable = pointer && RICH_EDITOR_AVAILABLE;
  // 判据按需加载:第一次打开时还没到,先按预览起步,到了之后预览自动换成富文本(inlineModeFor)。
  const [richReady, setRichReady] = useState(() => richSafetyNow('') !== null);
  useEffect(() => {
    if (!richCapable || richReady) return;
    let live = true;
    void loadRich().then(() => { if (live) setRichReady(true); });
    return () => { live = false; };
  }, [richCapable, richReady]);
  const [mode, setMode] = useState<InlineMode>(() => initialInlineMode(value, richCapable ? richSafetyNow(value) : false));
  // 桌面全屏的模式 / 手机全屏页开着没有。
  const [full, setFull] = useState<RulesViewMode | null>(null);
  const [page, setPage] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const [notice, setNotice] = useState('');
  const capture = useRef(createSelectionCapture()).current;
  const latest = useRef(value);
  latest.current = value;
  const [inlineInput, setInlineInput] = useState<any>(null);
  const [inlineBox, setInlineBox] = useState<any>(null);
  const [fullInput, setFullInput] = useState<any>(null);
  const [fullBox, setFullBox] = useState<any>(null);
  const fullscreen = fullscreenKind(pointer);
  // 富文本编辑器开着时内容就是它产出的,不用再判;源码 / 预览时每次改动重判(源码里写进 HTML → 富文本不可用)。
  const richShowing = richCapable && (full ? full === 'read' : mode === 'rich');
  const richOk = useMemo(() => richCapable && richReady && (richShowing || richSafetyNow(value) === true), [richCapable, richReady, richShowing, value]);
  const shown = inlineModeFor(mode, richOk);
  const richRef = useRef<RichEditorHandle | null>(null);
  const richActive = useRef(false);
  richActive.current = richEditorActive(shown, full, richOk);
  const activeInput = () => (full || page ? fullInput : inlineInput);
  const tauri = Platform.OS === 'web' && !!(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

  // 插完之后光标落在插入文字之后:值更新、编辑框重渲染之后再放(web 上直接设 textarea 的选区)。
  const pendingCaret = useRef<{ at: number; focus: boolean } | null>(null);
  useEffect(() => {
    const p = pendingCaret.current;
    if (!p) return;
    pendingCaret.current = null;
    const el = activeInput();
    if (el?.setSelectionRange) {
      try { el.setSelectionRange(p.at, p.at); } catch { /* 已卸载 */ }
    }
    if (p.focus) el?.focus?.();
  });
  const onSelectionChange = (e: { nativeEvent: { selection: TextSelection } }) => capture.track(e.nativeEvent.selection);
  const insertText = (next: { value: string; caret: number }, focus: boolean) => {
    latest.current = next.value;
    capture.track({ start: next.caret, end: next.caret });
    pendingCaret.current = { at: next.caret, focus };
    onChange(next.value);
  };

  // 上传一张:先检查类型 / 大小(错误就地显示),再上传,成功后在「当时的光标处」插入。
  const addImages = async (images: PickedImage[]) => {
    for (const img of images) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const problem = checkDescriptionImage({ name: img.fileName, type: img.mimeType, size: img.fileSize });
      if (problem) { setUploads(u => [...u, { id: key, name: img.fileName, state: 'error', message: problem }]); continue; }
      setUploads(u => [...u, { id: key, name: img.fileName, state: 'uploading' }]);
      try {
        const up = await uploadImage(cfg, img, { networkId: cfg.networkId });
        const rich = richActive.current ? richRef.current : null;
        if (rich) { rich.insertImage(`/api/files/${up.file_id}`, imageAlt(img.fileName)); setUploads(u => u.filter(x => x.id !== key)); continue; }
        const next = insertAtCaret(latest.current, capture.peek().live, hubImageMarkdown(img.fileName, up.file_id));
        insertText({ value: next.text, caret: next.caret }, false);
        setUploads(u => u.filter(x => x.id !== key));
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        setUploads(u => u.map(x => (x.id === key ? { ...x, state: 'error', message: t('tasks.copy.123', { v0: img.fileName, v1: error }) } : x)));
      }
    }
  };
  useImageIntake(pointer && shown === 'edit' && !full, inlineInput, inlineBox, images => { void addImages(images); }, setDragOver);
  useImageIntake(pointer && !!full && full !== 'read', fullInput, fullBox, images => { void addImages(images); }, setDragOver);

  // ── 语音 ──
  const sourceRef = useRef<VoiceSource>('desktopMic');
  const holdLayoutRef = useRef<HoldOverlayLayout | null>(null);
  const originRef = useRef({ x: 0, y: 0 });
  const measureOriginRef = useRef<(() => void) | null>(null);
  const showNotice = (text: string) => setNotice(pointer ? desktopVoiceNotice(text) : text);
  const voice = useVoiceInput({
    onInsert: text => {
      const source = sourceRef.current;
      const rich = richActive.current ? richRef.current : null;
      if (rich) { capture.take(); rich.insertText(text, refocusAfterInsert(source)); return; }
      const r = insertAtSelection(latest.current, text, voiceInsertTarget(source, capture.take()));
      // 大条(手机)插完不聚焦:不弹键盘(聊天 #422 同一条)。
      insertText({ value: r.value, caret: r.cursor }, refocusAfterInsert(source));
    },
    // 手机:「说话时间太短」由浮层在屏幕中间提示,这里不重复。
    onNotice: text => { if (holdLayoutRef.current && text === TOO_SHORT_NOTICE) return; showNotice(text); },
    zoneAt: (pageX, pageY, prev) => {
      const l = holdLayoutRef.current;
      if (!l) return null;
      return holdZoneAt({ x: pageX - originRef.current.x, y: pageY - originRef.current.y }, l, prev);
    },
  });
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(id);
  }, [notice]);
  // 按下的第一时间:记来源、从编辑框宿主读当前选区并冻结(上一句还在识别时不覆盖)。
  const handlersFor = (source: VoiceSource) => withPressStart(
    voice.micHandlers,
    () => {
      if (source === 'holdBar') measureOriginRef.current?.();
      const host = hostSelection(activeInput());
      if (host) capture.track(host);
      sourceRef.current = beginVoicePress(source, capture);
    },
    () => voice.state.phase === 'idle',
  );
  const micClick = () => {
    const a = micClickAction(voice.state.phase);
    if (a === 'start') handlersFor('desktopMic').onResponderGrant(DESKTOP_CLICK_EVENT as unknown as GestureResponderEvent);
    else if (a === 'done') voiceDone();
  };
  const voiceDone = () => voice.micHandlers.onResponderRelease(DESKTOP_CLICK_EVENT as unknown as GestureResponderEvent);
  const voiceCancel = () => voice.micHandlers.onResponderTerminate();
  // 手机全屏页用小编辑框同一个 编辑/预览;桌面全屏有自己的 阅读/编辑/左右。
  const editable = page ? mode === 'edit' : descriptionEditable(shown, full, richOk);
  const entry = voiceEntry({ pointer, available: voice.available, editable, phonePage: page });
  const kbd = useVoiceShortcuts(entry === 'desktopMic', { voice, start: micClick, done: voiceDone, cancel: voiceCancel, notice: showNotice });
  const holdOverlayOn = holdOverlayApplies({ desktop: pointer, os: Platform.OS, userAgent: Platform.OS === 'web' ? String((globalThis as any).navigator?.userAgent ?? '') : '' });
  const mic = entry === 'desktopMic' ? <DesktopMicButton voice={voice} onPress={micClick} /> : null;
  const kbdHint = kbd ? t(voice.state.phase === 'transcribing' ? 'voice.transcribing' : voice.state.phase === 'starting' ? 'voice.preparing' : kbd.mode === 'hold' ? 'voice.releaseKeys' : 'voice.pressKeys', { keys: comboChips(kbd.combo, isMacKeyboard()).join(isMacKeyboard() ? '' : '+') }) : undefined;
  const voiceBar = entry === 'desktopMic' && showVoiceBar(voice.state.phase) ? <DesktopVoiceBar voice={voice} onDone={voiceDone} onCancel={voiceCancel} hint={kbdHint} /> : null;
  const promptKind = settingsPromptKind(dirty, !!onOpenVoiceSettings);
  const prompt = (
    <VoiceSettingsPrompt
      voice={voice}
      onOpenSettings={promptKind === 'link' ? onOpenVoiceSettings : undefined}
      note={promptKind === 'saveFirst' ? t('taskDesc.voiceSaveFirst') : undefined}
    />
  );

  // 看大图:描述里所有图都在图库里,←/→ 走这些图。
  const gallery = (): ViewerImage[] => descriptionImages(latest.current).map(img => {
    const url = `${cfg.serverUrl}/api/files/${img.fileId}`;
    const name = img.alt || t('tasks.copy.124');
    return Platform.OS === 'web'
      ? { key: img.fileId, name, authUri: url, save: true }
      : { key: img.fileId, name, fileId: img.fileId, save: true };
  });
  const openViewer = (fileId: string, resolvedUri?: string) => {
    const images = gallery();
    const env = { os: Platform.OS, tauri };
    if (imagePreviewSurface(env) === 'window') {
      const payload = imageWindowPayload({ conversation: images, message: images, tappedKey: fileId, profileId: cfg.profileId, serverUrl: cfg.serverUrl, title, now: Date.now() });
      if (payload) { void openImageWindow(payload, { measureUri: resolvedUri }).then(ok => { if (!ok) setViewer(openGallery(images, fileId, resolvedUri)); }); return; }
    }
    setViewer(openGallery(images, fileId, resolvedUri));
  };

  const renderImage = (img: { alt: string; fileId: string }, key: number) => {
    const url = `${cfg.serverUrl}/api/files/${img.fileId}`;
    const name = img.alt || t('tasks.copy.124');
    return (
      <View key={key} testID={`req-description-image-${img.fileId}`}>
        {tauri ? (
          <AuthedWebThumb uri={url} name={name} token={cfg.token} onPress={objectUrl => openViewer(img.fileId, objectUrl)} />
        ) : Platform.OS !== 'web' ? (
          <AuthedThumb fileId={img.fileId} name={name} serverUrl={cfg.serverUrl} token={cfg.token} onPress={localUri => openViewer(img.fileId, localUri)} />
        ) : (
          // 纯网页没有带鉴权下载图片的通道:只显示名字,不把 token 放进地址。
          <Text style={s.muted}>[{t('tasks.copy.124')}] {img.alt}</Text>
        )}
      </View>
    );
  };
  const preview = (text: string) => <MarkdownMessage renderImage={renderImage}>{text}</MarkdownMessage>;

  const pick = async () => {
    const images = await pickImages(9).catch(() => []);
    if (images.length) await addImages(images);
  };

  const openFull = () => {
    if (fullscreen === 'phonePage') { setPage(true); return; }
    // 放不放得下左右由全屏自己按正文宽判(窄窗口退回编辑);这里按「宽布局」给默认。
    setFull(desktopFullscreenMode(shown, rulesSplitAvailable(true, Number.MAX_SAFE_INTEGER)));
  };
  const closeFull = () => {
    if (voice.state.phase !== 'idle') voiceCancel();
    if (full) setMode(inlineModeAfterFullscreen(full, richOk));
    setFull(null);
    setPage(false);
  };

  const status = (
    <>
      {uploads.map(u => (
        <View key={u.id} style={[f.row, { gap: 6 }]} testID={`req-description-upload-${u.state}`}>
          <Ionicons name={u.state === 'error' ? 'alert-circle-outline' : 'cloud-upload-outline'} size={14} color={u.state === 'error' ? colors.failed : colors.textMuted} />
          <Text style={[u.state === 'error' ? s.err : s.muted, { flex: 1 }]} numberOfLines={2}>{u.state === 'error' ? u.message : t('tasks.copy.134', { v0: u.name })}</Text>
          {u.state === 'error' ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('tasks.copy.58')} onPress={() => setUploads(list => list.filter(x => x.id !== u.id))} hitSlop={8}>
              <Ionicons name="close" size={14} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
      ))}
      {notice ? <Text style={s.muted} accessibilityLiveRegion="polite" testID="req-description-voice-notice">{notice}</Text> : null}
    </>
  );
  const editorBinding = (setInput: (el: any) => void): EditorBinding => ({
    value,
    onChange,
    onSelectionChange,
    placeholder: pointer ? t('tasks.copy.129') : t('tasks.copy.130'),
    setInput,
  });
  const inlineVoice = !full && !page;
  const richEditor = (variant: 'inline' | 'full') => (
    <RichDescriptionEditor
      value={value}
      onChange={onChange}
      placeholder={t('taskDesc.richPlaceholder')}
      handleRef={richRef}
      onFiles={files => { void addImages(files.map(file => attachmentFromFile(file))); }}
      onOpenImage={openViewer}
      images={{ serverUrl: cfg.serverUrl, token: cfg.token, authed: tauri }}
      variant={variant}
      testID={variant === 'full' ? 'req-description-full-rich' : 'req-description-rich'}
    />
  );
  const inlineEditable = shown === 'edit' || shown === 'rich';
  const modeItems: { key: InlineMode; label: string }[] = richOk
    ? [{ key: 'rich', label: t('taskDesc.rich') }, { key: 'edit', label: t('taskDesc.source') }]
    : [{ key: 'edit', label: t('tasks.copy.127') }, { key: 'preview', label: t('tasks.copy.128') }];

  return (
    <View style={{ gap: spacing.sm }} testID="req-description">
      <View style={[f.row, { justifyContent: 'space-between' }]}>
        <Text style={f.label}>{t('tasks.copy.125')}</Text>
        <View style={[f.row, { gap: spacing.sm, flexShrink: 0 }]} testID="req-description-toolbar">
          {inlineEditable ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('tasks.copy.126')} onPress={() => { void pick(); }} style={s.iconButton} testID="req-description-image-button">
              <Ionicons name="image-outline" size={18} color={colors.textSecondary} />
            </Pressable>
          ) : null}
          {inlineVoice && inlineEditable ? mic : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('taskDesc.fullscreenA11y')}
            onPress={openFull}
            style={({ hovered }: any) => [s.iconButton, { width: 'auto', flexShrink: 0, flexDirection: 'row', gap: 4, paddingHorizontal: spacing.sm }, hovered && { backgroundColor: colors.rowHover }]}
            testID="req-description-fullscreen"
          >
            <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 16 }}>⤢</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 12 }} numberOfLines={1} testID="req-description-fullscreen-label">{t('taskDesc.fullscreen')}</Text>
          </Pressable>
          <Segmented s={s} items={modeItems} value={shown} onChange={setMode} testID="req-description-mode" />
        </View>
      </View>
      {richCapable && richReady && !richOk ? <Text style={s.muted} testID="req-description-rich-unavailable">{t('taskDesc.richUnavailable')}</Text> : null}
      {shown === 'rich' ? (
        // 全屏开着时全屏里那个是唯一的富文本编辑器(语音 / 图片插到它那里),这里只画预览。
        full ? (
          <View style={[f.input, { minHeight: 60, backgroundColor: 'transparent' }]}>{value.trim() ? preview(value) : null}</View>
        ) : (
          <View style={{ gap: spacing.xs }}>
            {richEditor('inline')}
            {value.length > DESCRIPTION_MAX * 0.9 ? <Text style={s.muted}>{value.length} / {DESCRIPTION_MAX}</Text> : null}
            {inlineVoice ? voiceBar : null}
          </View>
        )
      ) : shown === 'edit' ? (
        <View ref={setInlineBox} collapsable={false} style={{ gap: spacing.xs }}>
          <TextInput
            ref={setInlineInput}
            value={value}
            onChangeText={onChange}
            onSelectionChange={onSelectionChange}
            multiline
            maxLength={DESCRIPTION_MAX}
            placeholder={pointer ? t('tasks.copy.129') : t('tasks.copy.130')}
            placeholderTextColor={colors.textMuted}
            style={[f.input, { minHeight: 140, textAlignVertical: 'top' }, dragOver && !full && { borderColor: colors.accent, backgroundColor: colors.accent + '10' }]}
            testID="req-description-input"
            accessibilityLabel={t('tasks.copy.131')}
          />
          {value.length > DESCRIPTION_MAX * 0.9 ? <Text style={s.muted}>{value.length} / {DESCRIPTION_MAX}</Text> : null}
          {inlineVoice ? voiceBar : null}
        </View>
      ) : (
        <Pressable onPress={() => setMode('edit')} accessibilityRole="button" accessibilityLabel={t('tasks.copy.132')} style={[f.input, { minHeight: 60, backgroundColor: 'transparent' }]} testID="req-description-preview">
          {value.trim() ? preview(value) : <Text style={s.muted}>{t('tasks.copy.133')}</Text>}
        </Pressable>
      )}
      {inlineVoice ? prompt : null}
      {inlineVoice ? status : null}
      {full ? (
        <DesktopDescriptionFullscreen
          mode={full}
          onMode={setFull}
          editor={editorBinding(setFullInput)}
          rich={richOk ? richEditor('full') : null}
          setDropBox={setFullBox}
          dragOver={dragOver}
          preview={preview}
          onPickImage={() => { void pick(); }}
          mic={mic}
          voiceBar={voiceBar}
          below={<>{prompt}{status}</>}
          dirty={dirty}
          onClose={closeFull}
        />
      ) : null}
      {page ? (
        <PhoneDescriptionPage
          mode={mode}
          onMode={setMode}
          editor={editorBinding(setFullInput)}
          preview={preview}
          onPickImage={() => { void pick(); }}
          holdBar={entry === 'holdBar' ? <VoiceHoldBar voice={voice} handlers={handlersFor('holdBar')} /> : null}
          voice={voice}
          holdOverlayOn={holdOverlayOn}
          holdLayoutRef={holdLayoutRef}
          originRef={originRef}
          measureOriginRef={measureOriginRef}
          below={<>{prompt}{status}</>}
          dirty={dirty}
          onClose={closeFull}
        />
      ) : null}
      <ImageViewer state={viewer} onClose={() => setViewer(null)} serverUrl={cfg.serverUrl} token={cfg.token} />
    </View>
  );
}
