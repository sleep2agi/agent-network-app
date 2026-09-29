import { t } from './i18n';
import { useTranslation } from './i18n-react';
import './i18n-chat';
// 语音输入的界面:
//   · 手机 / 双栏(微信式):输入行最左边 🎤/⌨ 切换按钮;语音模式下输入框整条变成「按住 说话」大按钮。
//   · 桌面:工具栏里的麦克风按钮(按住说话),同样插到光标处。
//   · 录音浮层 —— 手机:微信式 VoiceHoldOverlay(全屏压暗 + 绿色气泡 + ✕ / 文 两个圈 + 底部弧形面板);
//     桌面:VoiceRecordingOverlay(屏幕中间的大卡片 + 底部「取消区」),不变。
//   · 未配置时的「去设置」提示条。
// 状态与手势全在 useVoiceInput;这里只画。

import { useEffect, useRef, useState, type Ref } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, Platform, Pressable, ScrollView, StyleSheet, View, type TextInput as RNTextInput } from 'react-native';
import { Text, TextInput } from './ui-text';
import { Ionicons } from './icons';
import { colors, onThemeChange, spacing, radius } from './theme';
import { ds, uiScale } from './ui-scale';
import { composerControlSize } from './composer-row-layout';
import { formatElapsed, holdBarTone, isLivePhase, toggleButtonShows, TOO_SHORT_NOTICE, VOICE_DRAFT_CARD_MAX_LINES, VOICE_TOGGLE_ICON, type ComposerInputMode, type VoicePhase } from './voice-input-model';
import { barScale, HOLD_OVERLAY, holdOverlayTone, pushLevel, type HoldOverlayLayout } from './voice-hold-overlay-model';
import type { VoiceInput } from './useVoiceInput';
import { elevated } from './elevation';

type MicHandlers = VoiceInput['micHandlers'];

const holdBarLabel = (phase: VoicePhase) => t(phase === 'cancelArmed' ? 'voice.releaseCancel' : phase === 'transcribing' ? 'voice.transcribing' : ['starting', 'recording', 'toTextArmed'].includes(phase) ? 'voice.releaseText' : 'voice.holdSpaced');
const cancelZoneLabel = (phase: VoicePhase) => t(phase === 'cancelArmed' ? 'voice.releaseCancel' : 'voice.slideCancel');
const overlayHint = (phase: VoicePhase) => t(phase === 'cancelArmed' ? 'voice.releaseCancel' : phase === 'transcribing' ? 'voice.transcribing' : phase === 'starting' ? 'voice.preparing' : 'voice.releaseHint');
const holdOverlayLabel = (phase: VoicePhase) => phase === 'toTextArmed' ? t('voice.releaseDraft') : holdBarLabel(phase === 'idle' ? 'recording' : phase);

/**
 * 网页 / 桌面 webview:mousedown 的默认动作会把焦点从输入框挪到按钮上(textarea 失焦)。
 * 麦克风不需要焦点,阻止默认动作 → 按住说话期间输入框保持焦点、选区不动。原生上不需要(也没有这个事件)。
 */
const keepInputFocus = Platform.OS === 'web' ? { onMouseDown: (e: { preventDefault(): void }) => e.preventDefault() } : null;

/** 桌面工具栏里的麦克风按钮(按住说话)。手机 / 双栏没有麦克风按钮:语音只走左边 🔊 切换出来的「按住 说话」条。 */
export function VoiceMicButton({ voice, size = 20, style, handlers }: { voice: VoiceInput; size?: number; style?: object; handlers?: MicHandlers }) {
  useTranslation();
  const busy = voice.state.phase === 'transcribing';
  const live = isLivePhase(voice.state.phase) || voice.state.phase === 'starting';
  return (
    <View
      {...(handlers ?? voice.micHandlers)}
      {...keepInputFocus}
      accessible
      accessibilityRole="button"
      accessibilityLabel={voice.configured ? t('voice.hold') : t('voice.unconfigured')}
      accessibilityHint={voice.configured ? t('voice.holdHint') : t('voice.setupHint')}
      accessibilityState={{ busy, disabled: busy }}
      testID="voice-mic"
      style={[styles.mic, live && styles.micLive, style]}
    >
      {busy
        ? <ActivityIndicator size="small" color={colors.textMuted} />
        : <Ionicons name={live ? 'mic' : 'mic-outline'} size={size} color={live ? colors.bg : voice.configured ? colors.textSecondary : colors.textMuted} />}
    </View>
  );
}

/** Ionicons 没有键盘图标:用几个方块画一个(外框 + 两排键 + 空格键)。 */
function KeyboardGlyph({ color }: { color: string }) {
  useTranslation();
  const key = { width: ds(3), height: ds(3), borderRadius: 1, backgroundColor: color };
  return (
    <View style={[styles.kbd, { borderColor: color }]}>
      <View style={styles.kbdRow}>{[0, 1, 2, 3].map(i => <View key={i} style={key} />)}</View>
      <View style={styles.kbdRow}>{[0, 1, 2].map(i => <View key={i} style={key} />)}</View>
      <View style={[styles.kbdSpace, { backgroundColor: color }]} />
    </View>
  );
}

/** 输入行最左边的切换按钮:键盘模式显示 🔊(圆圈里的声波,点了进语音),语音模式显示 ⌨(点了回键盘)。 */
export function ComposerModeToggle({ mode, onToggle, disabled }: { mode: ComposerInputMode; onToggle: () => void; disabled?: boolean }) {
  useTranslation();
  const shows = toggleButtonShows(mode);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={shows === 'voice' ? t('voice.switchVoice') : t('voice.switchKeyboard')}
      disabled={disabled}
      onPress={onToggle}
      hitSlop={6}
      testID="composer-mode-toggle"
      style={({ pressed }) => [styles.toggle, pressed && { opacity: 0.6 }, disabled && { opacity: 0.4 }]}
    >
      {shows === 'voice'
        ? <Ionicons name={VOICE_TOGGLE_ICON} size={20} color={colors.text} />
        : <KeyboardGlyph color={colors.text} />}
    </Pressable>
  );
}

/** 语音模式下代替输入框的整条「按住 说话」。高 = 行内按钮高(composerControlSize),亮 / 暗主题都用正文色 + 实心底,不再是灰色小图标。 */
export function VoiceHoldBar({ voice, handlers }: { voice: VoiceInput; handlers?: MicHandlers }) {
  useTranslation();
  const { phase } = voice.state;
  const tone = holdBarTone(phase);
  return (
    <View
      {...(handlers ?? voice.micHandlers)}
      {...keepInputFocus}
      accessible
      accessibilityRole="button"
      accessibilityLabel={holdBarLabel(phase)}
      accessibilityHint={voice.configured ? t('voice.holdInsertHint') : t('voice.setupHint')}
      accessibilityState={{ busy: tone === 'busy', disabled: tone === 'busy' }}
      testID="voice-hold-bar"
      style={[styles.holdBar, tone === 'pressed' && styles.holdBarPressed, tone === 'cancel' && styles.holdBarCancel, tone === 'busy' && styles.holdBarBusy]}
    >
      {tone === 'busy' ? <ActivityIndicator size="small" color={colors.textSecondary} style={{ marginRight: 8 }} /> : null}
      <Text style={[styles.holdBarText, (tone === 'pressed' || tone === 'cancel') && styles.holdBarTextOn]} testID="voice-hold-bar-label">{holdBarLabel(phase)}</Text>
    </View>
  );
}

const BARS = 9;

/**
 * 按住期间的浮层(不接收触摸,手势留在按钮上):屏幕中间一张大卡片 —— 流式中间结果(边说边出字)、
 * 电平条、计时;底部一个取消区(上滑进去变红,松手即取消)。`bottom` = 输入区顶端到屏幕底的距离。
 */
export function VoiceRecordingOverlay({ voice, bottom, hidden }: { voice: VoiceInput; bottom: number; hidden?: boolean }) {
  useTranslation();
  const { phase } = voice.state;
  // hidden:手机上由微信式 VoiceHoldOverlay 接管(holdOverlayApplies),这张卡只留给非手机的回退(窄桌面窗口)。
  if (hidden || phase === 'idle') return null;
  const cancel = phase === 'cancelArmed';
  const level = voice.level;
  const live = isLivePhase(phase);
  return (
    <View pointerEvents="none" style={[styles.overlayWrap, { bottom }]} testID="voice-overlay">
      <View style={[styles.card, cancel && styles.cardCancel]} testID="voice-overlay-card">
        {voice.interim ? (
          // 流式中间结果:只显示最后几行(长句时看的是正在说的那截),终稿松手后才进输入框。
          <Text style={[styles.interim, cancel && styles.interimCancel]} numberOfLines={5} ellipsizeMode="head" testID="voice-interim">{voice.interim}</Text>
        ) : (
          <Text style={styles.interimPlaceholder}>{phase === 'transcribing' ? t('voice.transcribing') : t('voice.speak')}</Text>
        )}
        {phase === 'transcribing' ? (
          <ActivityIndicator color="#fff" style={{ marginTop: 10 }} />
        ) : (
          <View style={styles.bars}>
            {Array.from({ length: BARS }, (_, i) => {
              // 中间高两边低的电平条;level=0 时仍留一点高度表示「在录」。
              const shape = 1 - Math.abs(i - (BARS - 1) / 2) / ((BARS + 1) / 2);
              const h = 6 + Math.round(34 * Math.min(1, level * (0.6 + shape)));
              return <View key={i} style={[styles.bar, { height: h }, cancel && styles.barCancel]} />;
            })}
          </View>
        )}
        <View style={styles.cardFoot}>
          {live ? <Text style={styles.elapsed} testID="voice-elapsed">{formatElapsed(voice.elapsedMs)}</Text> : null}
          <Text style={styles.hint} testID="voice-hint">{overlayHint(phase)}</Text>
        </View>
      </View>
      {live ? (
        <View style={styles.cancelZoneWrap} testID="voice-cancel-zone">
          <View style={[styles.cancelZone, cancel && styles.cancelZoneOn]}>
            <Ionicons name="close" size={cancel ? 30 : 24} color={cancel ? '#fff' : '#e5e7eb'} />
          </View>
          <Text style={[styles.cancelZoneText, cancel && styles.cancelZoneTextOn]} testID="voice-cancel-zone-label">{cancelZoneLabel(phase)}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** 系统「减弱动态效果」:开着时气泡不缩放、波形不补帧(直接跳到新高度)。 */
function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then(v => { if (alive) setReduce(!!v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', v => setReduce(!!v));
    return () => { alive = false; sub?.remove?.(); };
  }, []);
  return reduce;
}

// 原生驱动:网页导出没有原生动画模块(RN 会警告并回退到 JS),只在安卓 / iOS 开。
const NATIVE_DRIVER = Platform.OS !== 'web';

/** 气泡里的波形:最近 N 次电平从左往右滚,每根条在两次电平之间由动画补到 60fps(scaleY,原生驱动)。 */
function HoldWaveform({ level, live, reduceMotion, color }: { level: number; live: boolean; reduceMotion: boolean; color: string }) {
  useTranslation();
  const n = HOLD_OVERLAY.bars;
  const scales = useRef(Array.from({ length: n }, () => new Animated.Value(barScale(0, 0, n)))).current;
  const historyRef = useRef<number[]>([]);
  useEffect(() => {
    if (!live) { historyRef.current = []; return; }
    historyRef.current = pushLevel(historyRef.current, level, n);
    const anims = historyRef.current.map((v, i) => Animated.timing(scales[i], { toValue: barScale(v, i, n), duration: reduceMotion ? 0 : 110, useNativeDriver: NATIVE_DRIVER }));
    Animated.parallel(anims).start();
  }, [level, live, reduceMotion, n, scales]);
  return (
    <View style={styles.holdBars} testID="voice-hold-bars">
      {scales.map((sc, i) => <Animated.View key={i} style={[styles.holdBar1, { backgroundColor: color, transform: [{ scaleY: sc }] }]} />)}
    </View>
  );
}

/**
 * 手机「按住 说话」浮层(微信式)。不接收触摸(手势留在下面的大条上,命中判定在 ChatScreen 用同一份 layout 做)。
 *   · 全屏 50% 压暗;中间偏下一个带尾巴的绿色气泡:电平波形 + 秒数 + 流式中间结果(≤3 行,再多在气泡里滚)
 *   · 左上 ✕(进去变红放大 →「松开手指，取消」),右上「文」(进去高亮 → 松开把文字放进草稿、不发送)
 *   · 底部弧形大面板盖住原来的大条,面板上方一行状态文案
 *   · 松开太快:中间一个「说话时间太短」提示,停一会儿自己消失
 * `layout` 来自 voice-hold-overlay-model.ts holdOverlayLayout(宿主宽高 + 底部安全区)。
 */
export function VoiceHoldOverlay({ voice, layout }: { voice: VoiceInput; layout: HoldOverlayLayout | null }) {
  useTranslation();
  const { phase, notice } = voice.state;
  const reduceMotion = useReduceMotion();
  const [toast, setToast] = useState(false);
  const lastStateRef = useRef(voice.state);
  useEffect(() => {
    const prev = lastStateRef.current;
    lastStateRef.current = voice.state;
    if (voice.state !== prev && phase === 'idle' && notice === TOO_SHORT_NOTICE) {
      setToast(true);
      const id = setTimeout(() => setToast(false), HOLD_OVERLAY.tooShortToastMs);
      return () => clearTimeout(id);
    }
    if (phase !== 'idle') setToast(false);
    return undefined;
  }, [voice.state, phase, notice]);

  const shown = phase !== 'idle';
  const appear = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!shown) { appear.setValue(0); return; }
    if (reduceMotion) { appear.setValue(1); return; }
    Animated.timing(appear, { toValue: 1, duration: HOLD_OVERLAY.scaleInMs, useNativeDriver: NATIVE_DRIVER }).start();
  }, [shown, reduceMotion, appear]);

  const tone = holdOverlayTone(phase);
  const circleScale = { cancel: useRef(new Animated.Value(1)).current, toText: useRef(new Animated.Value(1)).current };
  useEffect(() => {
    const to = (v: Animated.Value, on: boolean) => {
      const target = on ? HOLD_OVERLAY.circleSizeActive / HOLD_OVERLAY.circleSize : 1;
      if (reduceMotion) v.setValue(target);
      else Animated.spring(v, { toValue: target, speed: 40, bounciness: 6, useNativeDriver: NATIVE_DRIVER }).start();
    };
    to(circleScale.cancel, tone === 'cancel');
    to(circleScale.toText, tone === 'toText');
  }, [tone, reduceMotion, circleScale.cancel, circleScale.toText]);

  const scrollRef = useRef<ScrollView>(null);
  if (!layout || (!shown && !toast)) return null;
  const W = layout.width;
  const live = isLivePhase(phase);
  const cancel = tone === 'cancel';
  const bubbleBg = cancel ? colors.failed : colors.voiceBubble;
  const bubbleFg = cancel ? '#ffffff' : colors.onVoiceBubble;
  const circleBox = (x: number) => ({ left: x - HOLD_OVERLAY.circleSize / 2, top: layout.circleY - HOLD_OVERLAY.circleSize / 2 });

  if (!shown) {
    return (
      <View pointerEvents="none" style={styles.holdToastWrap} testID="voice-hold-toast">
        <View style={styles.holdToast} accessibilityLiveRegion="polite">
          <Ionicons name="alert-circle-outline" size={34} color="#ffffff" />
          <Text style={styles.holdToastText}>{t('voice.tooShort')}</Text>
        </View>
      </View>
    );
  }

  return (
    <View pointerEvents="none" style={styles.holdWrap} testID="voice-overlay" {...({ dataSet: { zone: tone, phase } } as object)}>
      <Animated.View
        testID="voice-hold-bubble"
        style={[styles.holdBubbleBox, { width: layout.bubbleWidth, left: (W - layout.bubbleWidth) / 2, bottom: layout.height - layout.bubbleBottom }, { opacity: appear, transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }] }]}
      >
        <View style={[styles.holdBubble, { backgroundColor: bubbleBg }]}>
          {phase === 'transcribing'
            ? <ActivityIndicator color={bubbleFg} />
            : <View style={styles.holdBubbleHead}>
                <HoldWaveform level={voice.level} live={live} reduceMotion={reduceMotion} color={bubbleFg} />
                <Text style={[styles.holdElapsed, { color: bubbleFg }]} testID="voice-elapsed">{formatElapsed(voice.elapsedMs)}</Text>
              </View>}
          {voice.interim ? (
            <ScrollView
              ref={scrollRef}
              style={{ maxHeight: HOLD_OVERLAY.interimLineHeight * HOLD_OVERLAY.interimMaxLines }}
              onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
              showsVerticalScrollIndicator={false}
              testID="voice-interim-scroll"
            >
              <Text style={[styles.holdInterim, { color: bubbleFg }, cancel && styles.interimCancel]} testID="voice-interim">{voice.interim}</Text>
            </ScrollView>
          ) : null}
        </View>
        <View style={[styles.holdTail, { backgroundColor: bubbleBg }]} />
      </Animated.View>
      {live ? (
        <>
          <Animated.View testID="voice-hold-cancel" style={[styles.holdCircle, circleBox(layout.cancelX), cancel && styles.holdCircleCancel, { transform: [{ scale: circleScale.cancel }] }]}>
            <Ionicons name="close" size={28} color={cancel ? '#ffffff' : '#e5e7eb'} />
          </Animated.View>
          <Animated.View testID="voice-hold-totext" style={[styles.holdCircle, circleBox(layout.textX), tone === 'toText' && styles.holdCircleOn, { transform: [{ scale: circleScale.toText }] }]}>
            <Text style={[styles.holdCircleGlyph, tone === 'toText' && { color: colors.onVoiceBubble }]}>{t('voice.textGlyph')}</Text>
          </Animated.View>
          <Text style={[styles.holdLabel, { top: layout.labelCenterY - 11 }]} testID="voice-hold-label">{holdOverlayLabel(phase)}</Text>
          <View style={[styles.holdArcWrap, { top: layout.arcTop }]} testID="voice-hold-arc">
            <View style={[styles.holdArc, { width: layout.arcDiameter, height: layout.arcDiameter, borderRadius: radius.pill, left: (W - layout.arcDiameter) / 2 }, tone !== 'neutral' && styles.holdArcDim]} />
            <View style={[styles.holdArcContent, { bottom: layout.bottomInset, top: layout.arcSag }]} testID="voice-hold-arc-content">
              <Ionicons name="mic" size={30} color={tone !== 'neutral' ? colors.textMuted : colors.voiceArcText} />
            </View>
          </View>
        </>
      ) : null}
    </View>
  );
}

/**
 * 未配置时按麦克风 → 「未配置语音识别，去设置」;没有设置入口(独立聊天窗口)时只提示位置。
 * note:没有入口时换一句说法(任务描述有没保存的修改时:先保存再去设置)。
 */
export function VoiceSettingsPrompt({ voice, onOpenSettings, note }: { voice: VoiceInput; onOpenSettings?: () => void; note?: string }) {
  useTranslation();
  if (!voice.settingsPrompt) return null;
  return (
    <View style={styles.promptWrap} testID="voice-settings-prompt">
      {onOpenSettings ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t('voice.setup')}
          onPress={() => { voice.dismissSettingsPrompt(); onOpenSettings(); }}
          style={({ pressed }) => [styles.prompt, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="mic-off-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.promptText}>{t('voice.setupPrefix')}<Text style={styles.promptLink}>{t('voice.settingsLink')}</Text></Text>
        </Pressable>
      ) : (
        <View style={styles.prompt}>
          <Ionicons name="mic-off-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.promptText}>{note ?? t('voice.setupMainWindow')}</Text>
        </View>
      )}
    </View>
  );
}

const DRAFT_CARD_LINE_HEIGHT = 20;
/** 草稿卡片(含上方间距)能长到的最大高度:4 行 + 上下内边距 8 + 发丝边框 + draftCardWrap 的 paddingTop。按住浮层的面板要盖过它。 */
export const VOICE_DRAFT_CARD_BLOCK_MAX = spacing.xs + 8 * 2 + 2 + DRAFT_CARD_LINE_HEIGHT * VOICE_DRAFT_CARD_MAX_LINES;

/**
 * 语音模式下的草稿卡片(「按住 说话」上方):显示草稿,最多 4 行,再多在卡片里滚。
 * 卡片是一个**不弹软键盘**的输入框(owner:键盘模式的麦克风太小不好按,要在语音模式里就能选插入位置):
 * 点一下放光标、长按 / 拖动选中,「按住 说话」的识别结果插到这里的选区;✕ = 清空草稿。只画,状态在 ChatScreen。
 * 软键盘:安卓 / iOS 用 showSoftInputOnFocus={false};网页 inputmode="none"。
 */
export function VoiceDraftCard({ value, selection, onChangeText, onSelectionChange, onClear, busy, inputRef }: {
  value: string;
  selection?: { start: number; end: number };
  onChangeText: (text: string) => void;
  onSelectionChange?: (e: { nativeEvent: { selection: { start: number; end: number } } }) => void;
  onClear: () => void;
  busy?: boolean;
  inputRef?: Ref<RNTextInput>;
}) {
  useTranslation();
  // 网页的 textarea 不会随内容长高(原生多行输入框会):按内容高度给,最多 4 行。
  const [webHeight, setWebHeight] = useState<number | undefined>(undefined);
  return (
    <View style={styles.draftCardWrap} testID="voice-draft-card">
      <View style={styles.draftCard}>
        <TextInput
          ref={inputRef}
          value={value}
          selection={selection}
          onChangeText={onChangeText}
          onSelectionChange={onSelectionChange}
          multiline
          scrollEnabled
          showSoftInputOnFocus={false}
          {...(Platform.OS === 'web' ? { inputMode: 'none' as const, rows: 1 } : null)}
          onContentSizeChange={Platform.OS === 'web' ? e => setWebHeight(e.nativeEvent.contentSize.height) : undefined}
          accessibilityLabel={t('voice.draft')}
          accessibilityHint={t('voice.draftHint')}
          testID="voice-draft-card-text"
          style={[styles.draftCardText, styles.draftCardInput, Platform.OS === 'web' && webHeight ? { height: Math.min(webHeight, DRAFT_CARD_LINE_HEIGHT * VOICE_DRAFT_CARD_MAX_LINES) } : null]}
        />
        <Pressable accessibilityRole="button" accessibilityLabel={t('voice.clearDraft')} disabled={busy} onPress={onClear} hitSlop={8} style={styles.draftCardClear} testID="voice-draft-card-clear">
          <Ionicons name="close" size={14} color={colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  mic: { width: 32, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  micLive: { backgroundColor: colors.accent },
  // Same height as the 「按住 说话」 bar and the ＋ / 发送 slot (composer-row-layout.ts composerControlSize).
  toggle: { width: composerControlSize(uiScale().densityFactor), height: composerControlSize(uiScale().densityFactor), borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  kbd: { width: ds(20), height: ds(15), borderWidth: 1.5, borderRadius: radius.mark, alignItems: 'center', justifyContent: 'space-evenly', paddingVertical: 1 },
  kbdRow: { flexDirection: 'row', gap: ds(1.5) },
  kbdSpace: { width: ds(9), height: 1.5, borderRadius: radius.pill },
  holdBar: {
    // Inside the column-direction inputWrap: stretch across, fixed height. (flex:1 here is a
    // VERTICAL flex with basis 0 — the web export collapsed the bar to its text height.)
    alignSelf: 'stretch',
    // Exactly the row control height (was a 44dp floor while the circles were ds(36) → the bar
    // stood taller than the buttons and off their centre line).
    height: composerControlSize(uiScale().densityFactor),
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.inputBg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    // 网页 / 桌面窄窗:按住拖动时不要选中文字。
    userSelect: 'none',
  } as any,
  holdBarPressed: { backgroundColor: colors.accent, borderColor: colors.accent },
  holdBarCancel: { backgroundColor: colors.failed, borderColor: colors.failed },
  holdBarBusy: { opacity: 0.7 },
  holdBarText: { color: colors.text, fontSize: 16, fontWeight: '600', letterSpacing: 1 },
  holdBarTextOn: { color: colors.onAccent },
  overlayWrap: { position: 'absolute', left: 0, right: 0, top: 0, alignItems: 'center', justifyContent: 'center', zIndex: 20, backgroundColor: 'rgba(0,0,0,0.28)' },
  card: { width: 300, maxWidth: '86%', minHeight: 170, paddingVertical: spacing.lg, paddingHorizontal: spacing.lg, borderRadius: radius.surface, backgroundColor: 'rgba(20,20,24,0.92)', alignItems: 'center', justifyContent: 'center', gap: 10 },
  cardCancel: { backgroundColor: 'rgba(185,28,28,0.94)' },
  interim: { color: '#fff', fontSize: 18, lineHeight: 26, textAlign: 'center', alignSelf: 'stretch' },
  interimCancel: { opacity: 0.65, textDecorationLine: 'line-through' },
  interimPlaceholder: { color: '#9ca3af', fontSize: 15 },
  bars: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 42 },
  bar: { width: 5, borderRadius: radius.pill, backgroundColor: '#7ee0ee' },
  barCancel: { backgroundColor: '#fecaca' },
  cardFoot: { alignItems: 'center', gap: 2 },
  elapsed: { color: '#fff', fontSize: 14, fontVariant: ['tabular-nums'] },
  hint: { color: '#e5e7eb', fontSize: 12 },
  cancelZoneWrap: { position: 'absolute', bottom: 16, alignItems: 'center', gap: 6 },
  cancelZone: { width: 64, height: 64, borderRadius: radius.pill, borderWidth: 2, borderColor: 'rgba(255,255,255,0.7)', backgroundColor: 'rgba(20,20,24,0.85)', alignItems: 'center', justifyContent: 'center' },
  cancelZoneOn: { width: 76, height: 76, borderRadius: radius.pill, borderColor: '#fff', backgroundColor: '#dc2626' },
  cancelZoneText: { color: '#f3f4f6', fontSize: 12, fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 },
  cancelZoneTextOn: { color: '#fff' },
  holdWrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 30, backgroundColor: 'rgba(0,0,0,0.5)', overflow: 'hidden' },
  holdBubbleBox: { position: 'absolute', alignItems: 'center' },
  holdBubble: { alignSelf: 'stretch', borderRadius: radius.bubble, paddingVertical: 12, paddingHorizontal: 14, gap: 8, minHeight: 64, justifyContent: 'center' },
  holdBubbleHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  holdBars: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 28 },
  holdBar1: { width: 3, height: 28, borderRadius: radius.pill },
  holdElapsed: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  holdInterim: { fontSize: 16, lineHeight: HOLD_OVERLAY.interimLineHeight },
  // 尾巴:转 45° 的小方块,一半藏在气泡下面。
  holdTail: { width: HOLD_OVERLAY.bubbleTail * 2, height: HOLD_OVERLAY.bubbleTail * 2, marginTop: -HOLD_OVERLAY.bubbleTail, transform: [{ rotate: '45deg' }], borderRadius: 2 },
  holdCircle: { position: 'absolute', width: HOLD_OVERLAY.circleSize, height: HOLD_OVERLAY.circleSize, borderRadius: radius.pill, backgroundColor: 'rgba(60,60,64,0.92)', alignItems: 'center', justifyContent: 'center' },
  holdCircleCancel: { backgroundColor: '#e5484d' },
  holdCircleOn: { backgroundColor: colors.voiceBubble },
  holdCircleGlyph: { color: '#e5e7eb', fontSize: 22, fontWeight: '600' },
  holdLabel: { position: 'absolute', left: 0, right: 0, height: 22, lineHeight: 22, textAlign: 'center', color: '#f3f4f6', fontSize: 15, fontWeight: '600' },
  holdArcWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  holdArc: { position: 'absolute', top: 0, backgroundColor: colors.voiceArc },
  holdArcDim: { backgroundColor: colors.voiceArcDim },
  holdArcContent: { position: 'absolute', left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  holdToastWrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 30, alignItems: 'center', justifyContent: 'center' },
  holdToast: { width: 140, paddingVertical: 18, borderRadius: radius.control, backgroundColor: 'rgba(20,20,24,0.88)', alignItems: 'center', gap: 8 },
  holdToastText: { color: '#ffffff', fontSize: 14 },
  promptWrap: { alignItems: 'center', marginVertical: 4 },
  prompt: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.card, maxWidth: '92%', ...elevated('floating') },
  promptText: { color: colors.text, fontSize: 12 },
  promptLink: { color: colors.accent, fontWeight: '600' },
  draftCardWrap: { paddingHorizontal: spacing.md, paddingTop: spacing.xs },
  draftCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingVertical: 8, paddingLeft: 12, paddingRight: 8, borderRadius: radius.control, backgroundColor: colors.inputBg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  draftCardText: { color: colors.text, fontSize: 15, lineHeight: DRAFT_CARD_LINE_HEIGHT },
  // 输入框的默认内边距 / 外框去掉,看起来和原来的纯文字卡片一样;高度随内容,最多 4 行后在框内滚。
  draftCardInput: { flex: 1, maxHeight: DRAFT_CARD_LINE_HEIGHT * VOICE_DRAFT_CARD_MAX_LINES, padding: 0, margin: 0, textAlignVertical: 'top', borderWidth: 0, outlineStyle: 'none' } as any,
  draftCardClear: { width: 20, height: 20, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.border },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
