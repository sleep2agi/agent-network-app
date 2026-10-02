// 任务描述的「⤢ 全屏」(模型与理由见 task-description-fullscreen-model.ts)。
//   · DesktopDescriptionFullscreen:盖住整个窗口的编辑器,阅读 / 编辑 / 左右 —— 规则文件(#491)同一套零件
//     (SplitEditorParts:模式切换、分隔条、预览节流);🖼 / 🎤 在工具条上,录音条在底部。
//   · PhoneDescriptionPage:推入的一整页,‹ 返回 · 编辑/预览 · 🖼;编辑时底部「按住 说话」,按住时微信式浮层铺满这一页。
// 草稿、图片上传、语音状态都在 TaskDescriptionEditor;这里只摆位置。
// 定时任务的「任务内容」也用这一套(ScheduledTasksScreen / ScheduleContentFullscreen):标题、字数上限、未保存提示可换,
// 🖼 可以不给(onPickImage = null),可以带一个「保存」(save;定时任务详情页没有外层的保存按钮)。
import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import { colors, radius, spacing } from './theme';
import { t } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-tasks';
import { useModalSafePadding } from './safe-area-runtime';
import MacTitleStrip from './mac-title-strip';
import WinTitleBar from './win-title-bar';
import { EDITOR_BTN_HEIGHT, EditorHeaderButton, FocusRing, ModeToggle, prefersReducedMotion, SplitDivider, useDebounced } from './SplitEditorParts';
import { rulesModeTabs, rulesSplitAvailable, SPLIT_PREVIEW_DEBOUNCE_MS, SPLIT_RATIO_DEFAULT, clampSplitRatio, splitPaneWidths } from './rules-split';
import { RULES_READ_MAX_WIDTH } from './rules-fullscreen-layout';
import type { RulesViewMode } from './node-rules-view';
import { effectiveDesktopMode, type InlineMode } from './task-description-fullscreen-model';
import { CONTROL_H, Segmented, useTaskStyles } from './TaskBoardParts';
import { DESCRIPTION_MAX } from './task-board-model';
import { holdOverlayLayout, type HoldOverlayLayout } from './voice-hold-overlay-model';
import { VoiceHoldOverlay } from './VoiceInputUI';
import type { VoiceInput } from './useVoiceInput';

/** 两种全屏共用的编辑框参数(值、选区跟踪、占位字)。 */
export type EditorBinding = {
  value: string;
  onChange: (v: string) => void;
  onSelectionChange: (e: { nativeEvent: { selection: { start: number; end: number } } }) => void;
  placeholder: string;
  /** 编辑框宿主(web 上是 <textarea>):粘贴图片、语音插入读选区都靠它。 */
  setInput: (el: any) => void;
  /** 字数上限(默认任务描述的 DESCRIPTION_MAX;定时任务内容是 Hub 的 10000)。 */
  maxLength?: number;
};

/** 全屏里的「保存」:没有外层保存按钮的地方(定时任务详情页)才给。 */
export type FullscreenSave = { label: string; disabled: boolean; onPress: () => void };

/** 两种全屏共用的可换文案 / 可选零件;不给 = 任务描述原样。 */
export type FullscreenChrome = {
  /** 手机页顶栏的标题(默认「描述」)。 */
  title?: string;
  /** 有未保存修改时的提示(默认「回到详情点保存修改」)。 */
  unsavedText?: string;
  save?: FullscreenSave | null;
  /** 正文下面多放的东西(保存出错 / 冲突时的选择)。 */
  below?: ReactNode;
};

const WEB = Platform.OS === 'web';

function useEscape(onClose: () => void) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    const doc = (globalThis as any).document;
    if (!doc?.addEventListener) return;
    // 在 keyup 上关,和 react-native-web 的 Modal 同一拍:底下的详情页如果也是 Modal,它这时还不是最上层,
    // 不会跟着关(keydown 就关的话,紧接着的 keyup 会把详情页也关掉、草稿丢了)。
    // 只认「keydown 走到了 document」的那次 Esc:录音中的 Esc 在 window 捕获阶段被录音条接走(取消录音),
    // 到不了这里 —— 松开时不关全屏。
    let armed = false;
    const onDown = (event: any) => { if (event.key === 'Escape') armed = true; };
    const onUp = (event: any) => {
      if (event.key !== 'Escape' || !armed) return;
      armed = false;
      ref.current();
    };
    doc.addEventListener('keydown', onDown);
    doc.addEventListener('keyup', onUp);
    return () => { doc.removeEventListener('keydown', onDown); doc.removeEventListener('keyup', onUp); };
  }, []);
}

export function DesktopDescriptionFullscreen({ mode, onMode, editor, rich, setDropBox, dragOver, preview, onPickImage, mic, voiceBar, below, dirty, onClose, chrome = {} }: {
  mode: RulesViewMode;
  onMode: (m: RulesViewMode) => void;
  editor: EditorBinding;
  /** 所见即所得编辑器(富文本可用时):「阅读」换成它 —— 看和改在同一个地方;「编辑」叫「源码」。 */
  rich: ReactNode | null;
  /** 拖放图片的区域(整个正文区)。 */
  setDropBox: (el: any) => void;
  dragOver: boolean;
  preview: (text: string) => ReactNode;
  /** 🖼;null = 这里不能放图片(定时任务内容)。 */
  onPickImage: (() => void) | null;
  /** 🎤(不支持语音时 null)。 */
  mic: ReactNode;
  /** 录音条(没在录音时 null)。 */
  voiceBar: ReactNode;
  /** 录音条下面的提示:去设置 / 上传进度 / 语音提示。 */
  below: ReactNode;
  dirty: boolean;
  onClose: () => void;
  chrome?: FullscreenChrome;
}) {
  useTranslation();
  const [bodyWidth, setBodyWidth] = useState(0);
  const [ratio, setRatio] = useState(SPLIT_RATIO_DEFAULT);
  const [focused, setFocused] = useState(false);
  const splitOk = rulesSplitAvailable(true, bodyWidth || 10_000);
  const shown = effectiveDesktopMode(mode, splitOk);
  const split = shown === 'split';
  const previewText = useDebounced(editor.value, split ? SPLIT_PREVIEW_DEBOUNCE_MS : 0);
  const closeRef = useRef<any>(null);
  useEscape(onClose);
  useEffect(() => {
    const id = setTimeout(() => closeRef.current?.focus?.(), 0);
    return () => clearTimeout(id);
  }, []);
  const labels: Record<RulesViewMode, string> = rich
    ? { read: t('taskDesc.rich'), edit: t('taskDesc.source'), split: t('taskDesc.split') }
    : { read: t('taskDesc.read'), edit: t('tasks.copy.127'), split: t('taskDesc.split') };
  const editable = shown !== 'read' || !!rich;
  // 编辑框本身不画浏览器的焦点黑框(左右模式里只框住左半边,很突兀):焦点落在编辑框里时整个外框变强调色。
  const frame = { flex: 1, borderWidth: 1, borderColor: dragOver || focused ? colors.accent : colors.border, borderRadius: radius.control, backgroundColor: dragOver ? colors.accent + '10' : colors.bg, overflow: 'hidden' as const };
  const input = (style: object) => (
    <TextInput
      ref={editor.setInput}
      value={editor.value}
      onChangeText={editor.onChange}
      onSelectionChange={editor.onSelectionChange}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      multiline
      scrollEnabled
      maxLength={editor.maxLength ?? DESCRIPTION_MAX}
      placeholder={editor.placeholder}
      placeholderTextColor={colors.textMuted}
      textAlignVertical="top"
      testID="req-description-full-input"
      accessibilityLabel={t('tasks.copy.131')}
      style={{ ...style, color: colors.text, padding: spacing.md, fontSize: 14, lineHeight: 21, ...(WEB ? { outlineStyle: 'none' } : null) } as any}
    />
  );
  const rendered = (text: string, emptyKey: string) => (
    <View style={{ width: '100%', maxWidth: RULES_READ_MAX_WIDTH, alignSelf: 'center' }}>
      {text.trim() ? preview(text) : <Text style={{ color: colors.textMuted, fontSize: 13 }}>{t(emptyKey)}</Text>}
    </View>
  );
  const scroller = (text: string, emptyKey: string, testID: string) => (
    <ScrollView testID={testID} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} contentContainerStyle={{ padding: spacing.lg }}>
      {rendered(text, emptyKey)}
    </ScrollView>
  );
  const inner = Math.max(0, bodyWidth - 2);
  const { left } = splitPaneWidths(inner, ratio);
  const body = shown === 'read' && rich ? (
    <View style={{ flex: 1, minHeight: 0 }}>{rich}</View>
  ) : shown === 'read' ? (
    <View style={frame}>{scroller(editor.value, 'taskDesc.emptyRead', 'req-description-full-read')}</View>
  ) : split ? (
    <View style={[frame, { flexDirection: 'row' }]} testID="req-description-split">
      <View testID="req-description-split-source" style={{ width: inner ? left : '50%', borderRightWidth: 1, borderRightColor: colors.border }}>
        {input({ flex: 1 })}
      </View>
      <View testID="req-description-split-preview" style={{ flex: 1 }}>{scroller(previewText, 'taskDesc.emptySplit', 'req-description-split-scroll')}</View>
      {inner ? (
        <SplitDivider
          left={left}
          width={inner}
          ratio={ratio}
          onRatio={setRatio}
          onCommit={r => setRatio(clampSplitRatio(r))}
          label={t('taskDesc.splitDivider')}
          valueText={pct => t('taskDesc.splitValue', { pct })}
          testID="req-description-split-divider"
        />
      ) : null}
    </View>
  ) : (
    <View style={frame}>{input({ flex: 1 })}</View>
  );
  return (
    // web 上不给 onRequestClose:react-native-web 的 Modal 在 Esc 的 keyup 上关 —— 录音中按 Esc 取消录音(keydown,
    // 录音条接走),松开时它会把全屏也关掉。web 的 Esc 由 useEscape 管。
    <Modal transparent={false} visible onRequestClose={WEB ? undefined : onClose} animationType={prefersReducedMotion() ? 'none' : 'fade'}>
      <View style={{ flex: 1, backgroundColor: colors.bg }} accessibilityViewIsModal testID="req-description-fullscreen">
        {/* 同规则文件全屏:Modal 盖住了 App.tsx 顶上的 MacTitleStrip / WinTitleBar,这里再挂一次(各自只在自己的平台渲染)。 */}
        <MacTitleStrip />
        <WinTitleBar />
        <View testID="req-description-full-toolbar" style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <ModeToggle mode={shown} tabs={rulesModeTabs(splitOk)} onChange={onMode} labels={labels} testID="req-description-full-mode" />
          {editable && onPickImage ? (
            <FocusRing accessibilityRole="button" accessibilityLabel={t('tasks.copy.126')} onPress={onPickImage} testID="req-description-full-image"
              style={{ width: EDITOR_BTN_HEIGHT, height: EDITOR_BTN_HEIGHT, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="image-outline" size={18} color={colors.textSecondary} />
            </FocusRing>
          ) : null}
          {editable ? mic : null}
          <Text style={{ flex: 1, color: colors.textMuted, fontSize: 12 }} numberOfLines={1} testID="req-description-full-dirty">{dirty ? chrome.unsavedText ?? t('taskDesc.unsaved') : ''}</Text>
          {/* 保存 / 退出全屏:和规则文件全屏同一个顶栏按钮(EditorHeaderButton,同高同圆角,保存禁用时浅灰底灰字)。 */}
          {chrome.save ? (
            <EditorHeaderButton primary onPress={chrome.save.onPress} disabled={chrome.save.disabled} label={chrome.save.label} testID="req-description-full-save" />
          ) : null}
          <EditorHeaderButton ref={closeRef} onPress={onClose} accessibilityLabel={t('taskDesc.exitFullscreen')} label={WEB ? t('taskDesc.exitFullscreenEsc') : t('taskDesc.exitFullscreen')} testID="req-description-full-close" />
        </View>
        <View ref={setDropBox} collapsable={false} style={{ flex: 1, padding: spacing.lg, gap: spacing.sm }}>
          <View style={{ flex: 1 }} onLayout={e => setBodyWidth(e.nativeEvent.layout.width)}>{body}</View>
          {voiceBar}
          {below}
        </View>
      </View>
    </Modal>
  );
}

/**
 * 手机全屏页。按住浮层的几何(holdOverlayLayout)按这一页的宽高 + 底部安全区 + 大条的上沿算;
 * 手指命中用同一份几何(holdLayoutRef),手指坐标减去这一页在窗口里的原点(measureOrigin,按下时量)。
 */
export function PhoneDescriptionPage({ mode, onMode, editor, preview, onPickImage, holdBar, voice, holdOverlayOn, holdLayoutRef, originRef, measureOriginRef, below, dirty, onClose, chrome = {} }: {
  mode: InlineMode;
  onMode: (m: InlineMode) => void;
  editor: EditorBinding;
  preview: (text: string) => ReactNode;
  /** 🖼;null = 这里不能放图片(定时任务内容)。 */
  onPickImage: (() => void) | null;
  /** 「按住 说话」大条(不支持语音 / 预览模式时 null)。 */
  holdBar: ReactNode;
  voice: VoiceInput;
  /** 微信式按住浮层只在安卓 / iOS 画(voice-hold-overlay-model.ts holdOverlayApplies)。 */
  holdOverlayOn: boolean;
  holdLayoutRef: MutableRefObject<HoldOverlayLayout | null>;
  originRef: MutableRefObject<{ x: number; y: number }>;
  measureOriginRef: MutableRefObject<(() => void) | null>;
  below: ReactNode;
  dirty: boolean;
  onClose: () => void;
  chrome?: FullscreenChrome;
}) {
  useTranslation();
  const s = useTaskStyles();
  const safe = useModalSafePadding('fullScreen');
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [barTop, setBarTop] = useState<number | undefined>(undefined);
  const probeRef = useRef<View>(null);
  measureOriginRef.current = () => probeRef.current?.measureInWindow((x, y) => { originRef.current = { x, y }; });
  const layout = holdOverlayOn && holdBar && size.width > 0 && size.height > 0 ? holdOverlayLayout(size.width, size.height, safe.paddingBottom, barTop) : null;
  holdLayoutRef.current = layout;
  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View
        style={{ flex: 1, backgroundColor: colors.bg, paddingTop: safe.paddingTop }}
        onLayout={e => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
        testID="req-description-page"
        accessibilityViewIsModal
      >
        <View ref={probeRef} collapsable={false} pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, width: 0, height: 0 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: 56, paddingHorizontal: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border }} testID="req-description-page-header">
          <Pressable accessibilityRole="button" accessibilityLabel={t('tasks.copy.144')} onPress={onClose} hitSlop={8} style={[s.iconButton, { marginLeft: -spacing.sm }]} testID="req-description-page-back">
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>
          <Text style={{ flex: 1, color: colors.text, fontSize: 17, fontWeight: '600' }} numberOfLines={1} testID="req-description-page-title">{chrome.title ?? t('tasks.copy.125')}</Text>
          {mode === 'edit' && onPickImage ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('tasks.copy.126')} onPress={onPickImage} hitSlop={6} style={s.iconButton} testID="req-description-page-image">
              <Ionicons name="image-outline" size={20} color={colors.textSecondary} />
            </Pressable>
          ) : null}
          <Segmented s={s} items={[{ key: 'edit', label: t('tasks.copy.127') }, { key: 'preview', label: t('tasks.copy.128') }]} value={mode} onChange={onMode} testID="req-description-page-mode" />
          {chrome.save ? (
            <EditorHeaderButton primary onPress={chrome.save.onPress} disabled={chrome.save.disabled} label={chrome.save.label} height={CONTROL_H} fontSize={14} testID="req-description-page-save" />
          ) : null}
        </View>
        {dirty ? <Text style={{ color: colors.textMuted, fontSize: 12, paddingHorizontal: spacing.lg, paddingTop: spacing.sm }} testID="req-description-page-dirty">{chrome.unsavedText ?? t('taskDesc.unsaved')}</Text> : null}
        <View style={{ flex: 1, padding: spacing.lg, gap: spacing.sm }}>
          {mode === 'edit' ? (
            <TextInput
              ref={editor.setInput}
              value={editor.value}
              onChangeText={editor.onChange}
              onSelectionChange={editor.onSelectionChange}
              multiline
              maxLength={editor.maxLength ?? DESCRIPTION_MAX}
              placeholder={editor.placeholder}
              placeholderTextColor={colors.textMuted}
              textAlignVertical="top"
              testID="req-description-page-input"
              accessibilityLabel={t('tasks.copy.131')}
              style={{ flex: 1, color: colors.text, fontSize: 15, lineHeight: 22, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.control }}
            />
          ) : (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: spacing.sm }} testID="req-description-page-preview">
              {editor.value.trim() ? preview(editor.value) : <Text style={{ color: colors.textMuted, fontSize: 14 }}>{t('taskDesc.emptyRead')}</Text>}
            </ScrollView>
          )}
          {below}
        </View>
        {holdBar ? (
          <View
            style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm + safe.paddingBottom, borderTopWidth: 1, borderTopColor: colors.border }}
            onLayout={e => setBarTop(e.nativeEvent.layout.y)}
            testID="req-description-page-voice"
          >
            {holdBar}
          </View>
        ) : null}
        {holdOverlayOn ? <VoiceHoldOverlay voice={voice} layout={layout} /> : null}
      </View>
    </Modal>
  );
}
