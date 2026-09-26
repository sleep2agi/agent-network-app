// 语音输入的界面:
//   · 手机 / 双栏(微信式):输入行最左边 🎤/⌨ 切换按钮;语音模式下输入框整条变成「按住 说话」大按钮。
//   · 桌面:工具栏里的麦克风按钮(按住说话),不变。
//   · 录音浮层:屏幕中间的大卡片(流式中间结果 + 电平 + 计时),底部一个明确的「取消区」。
//   · 未配置时的「去设置」提示条。
// 状态与手势全在 useVoiceInput;这里只画。

import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { colors, onThemeChange, spacing } from './theme';
import { ds, uiScale } from './ui-scale';
import { composerControlSize } from './composer-row-layout';
import { cancelZoneLabel, formatElapsed, holdBarLabel, holdBarTone, overlayHint, toggleButtonShows, VOICE_DRAFT_CARD_MAX_LINES, type ComposerInputMode } from './voice-input-model';
import type { VoiceInput } from './useVoiceInput';

/** 桌面工具栏里的麦克风按钮(按住说话)。手机上不再用它 —— 改为切换按钮 + 「按住 说话」条。 */
export function VoiceMicButton({ voice, size = 20, style }: { voice: VoiceInput; size?: number; style?: object }) {
  const busy = voice.state.phase === 'transcribing';
  const live = voice.state.phase === 'recording' || voice.state.phase === 'cancelArmed' || voice.state.phase === 'starting';
  return (
    <View
      {...voice.micHandlers}
      accessible
      accessibilityRole="button"
      accessibilityLabel={voice.configured ? '按住说话' : '语音输入(未配置)'}
      accessibilityHint={voice.configured ? '按住录音,松开识别成文字,上滑取消' : '需要先在 设置 → 语音输入 里配置'}
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
  const key = { width: ds(3), height: ds(3), borderRadius: 1, backgroundColor: color };
  return (
    <View style={[styles.kbd, { borderColor: color }]}>
      <View style={styles.kbdRow}>{[0, 1, 2, 3].map(i => <View key={i} style={key} />)}</View>
      <View style={styles.kbdRow}>{[0, 1, 2].map(i => <View key={i} style={key} />)}</View>
      <View style={[styles.kbdSpace, { backgroundColor: color }]} />
    </View>
  );
}

/** 输入行最左边的切换按钮:键盘模式显示 🎤(点了进语音),语音模式显示 ⌨(点了回键盘)。 */
export function ComposerModeToggle({ mode, onToggle, disabled }: { mode: ComposerInputMode; onToggle: () => void; disabled?: boolean }) {
  const shows = toggleButtonShows(mode);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={shows === 'mic' ? '切换到按住说话' : '切换到键盘输入'}
      disabled={disabled}
      onPress={onToggle}
      hitSlop={6}
      testID="composer-mode-toggle"
      style={({ pressed }) => [styles.toggle, pressed && { opacity: 0.6 }, disabled && { opacity: 0.4 }]}
    >
      {shows === 'mic'
        ? <Ionicons name="mic-outline" size={20} color={colors.text} />
        : <KeyboardGlyph color={colors.text} />}
    </Pressable>
  );
}

/** 语音模式下代替输入框的整条「按住 说话」。高 = 行内按钮高(composerControlSize),亮 / 暗主题都用正文色 + 实心底,不再是灰色小图标。 */
export function VoiceHoldBar({ voice }: { voice: VoiceInput }) {
  const { phase } = voice.state;
  const tone = holdBarTone(phase);
  return (
    <View
      {...voice.micHandlers}
      accessible
      accessibilityRole="button"
      accessibilityLabel={holdBarLabel(phase)}
      accessibilityHint={voice.configured ? '按住录音,松开把文字放进输入框,上滑取消' : '需要先在 设置 → 语音输入 里配置'}
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
export function VoiceRecordingOverlay({ voice, bottom }: { voice: VoiceInput; bottom: number }) {
  const { phase } = voice.state;
  if (phase === 'idle') return null;
  const cancel = phase === 'cancelArmed';
  const level = voice.level;
  const live = phase === 'recording' || phase === 'cancelArmed';
  return (
    <View pointerEvents="none" style={[styles.overlayWrap, { bottom }]} testID="voice-overlay">
      <View style={[styles.card, cancel && styles.cardCancel]} testID="voice-overlay-card">
        {voice.interim ? (
          // 流式中间结果:只显示最后几行(长句时看的是正在说的那截),终稿松手后才进输入框。
          <Text style={[styles.interim, cancel && styles.interimCancel]} numberOfLines={5} ellipsizeMode="head" testID="voice-interim">{voice.interim}</Text>
        ) : (
          <Text style={styles.interimPlaceholder}>{phase === 'transcribing' ? '正在识别…' : '请说话…'}</Text>
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

/** 未配置时按麦克风 → 「未配置语音识别，去设置」;没有设置入口(独立聊天窗口)时只提示位置。 */
export function VoiceSettingsPrompt({ voice, onOpenSettings }: { voice: VoiceInput; onOpenSettings?: () => void }) {
  if (!voice.settingsPrompt) return null;
  return (
    <View style={styles.promptWrap} testID="voice-settings-prompt">
      {onOpenSettings ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="未配置语音识别，去设置"
          onPress={() => { voice.dismissSettingsPrompt(); onOpenSettings(); }}
          style={({ pressed }) => [styles.prompt, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="mic-off-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.promptText}>未配置语音识别，<Text style={styles.promptLink}>去设置 ›</Text></Text>
        </Pressable>
      ) : (
        <View style={styles.prompt}>
          <Ionicons name="mic-off-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.promptText}>未配置语音识别:在主窗口 设置 → 语音输入 里配置</Text>
        </View>
      )}
    </View>
  );
}

const DRAFT_CARD_LINE_HEIGHT = 20;

/**
 * 语音模式下的草稿卡片(「按住 说话」上方):显示识别出来的草稿,最多 4 行,再多在卡片里滚。
 * 点文字 = 切到键盘并聚焦(唯一会弹软键盘的路);✕ = 清空草稿。只画,状态在 ChatScreen。
 */
export function VoiceDraftCard({ text, onPress, onClear, disabled }: { text: string; onPress: () => void; onClear: () => void; disabled?: boolean }) {
  return (
    <View style={styles.draftCardWrap} testID="voice-draft-card">
      <View style={styles.draftCard}>
        <ScrollView style={{ flex: 1, maxHeight: DRAFT_CARD_LINE_HEIGHT * VOICE_DRAFT_CARD_MAX_LINES }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="编辑语音草稿"
            accessibilityHint="切换到键盘输入并编辑这段文字"
            disabled={disabled}
            onPress={onPress}
            testID="voice-draft-card-text"
          >
            <Text style={styles.draftCardText}>{text}</Text>
          </Pressable>
        </ScrollView>
        <Pressable accessibilityRole="button" accessibilityLabel="清空语音草稿" disabled={disabled} onPress={onClear} hitSlop={8} style={styles.draftCardClear} testID="voice-draft-card-clear">
          <Ionicons name="close" size={14} color={colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = () => StyleSheet.create({
  mic: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  micLive: { backgroundColor: colors.accent },
  // Same height as the 「按住 说话」 bar and the ＋ / 发送 slot (composer-row-layout.ts composerControlSize).
  toggle: { width: composerControlSize(uiScale().densityFactor), height: composerControlSize(uiScale().densityFactor), borderRadius: composerControlSize(uiScale().densityFactor) / 2, borderWidth: 1.5, borderColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  kbd: { width: ds(20), height: ds(15), borderWidth: 1.5, borderRadius: 3, alignItems: 'center', justifyContent: 'space-evenly', paddingVertical: 1 },
  kbdRow: { flexDirection: 'row', gap: ds(1.5) },
  kbdSpace: { width: ds(9), height: 1.5, borderRadius: 1 },
  holdBar: {
    // Inside the column-direction inputWrap: stretch across, fixed height. (flex:1 here is a
    // VERTICAL flex with basis 0 — the web export collapsed the bar to its text height.)
    alignSelf: 'stretch',
    // Exactly the row control height (was a 44dp floor while the circles were ds(36) → the bar
    // stood taller than the buttons and off their centre line).
    height: composerControlSize(uiScale().densityFactor),
    borderRadius: 10,
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
  card: { width: 300, maxWidth: '86%', minHeight: 170, paddingVertical: spacing.lg, paddingHorizontal: spacing.lg, borderRadius: 18, backgroundColor: 'rgba(20,20,24,0.92)', alignItems: 'center', justifyContent: 'center', gap: 10 },
  cardCancel: { backgroundColor: 'rgba(185,28,28,0.94)' },
  interim: { color: '#fff', fontSize: 18, lineHeight: 26, textAlign: 'center', alignSelf: 'stretch' },
  interimCancel: { opacity: 0.65, textDecorationLine: 'line-through' },
  interimPlaceholder: { color: '#9ca3af', fontSize: 15 },
  bars: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 42 },
  bar: { width: 5, borderRadius: 3, backgroundColor: '#7ee0ee' },
  barCancel: { backgroundColor: '#fecaca' },
  cardFoot: { alignItems: 'center', gap: 2 },
  elapsed: { color: '#fff', fontSize: 14, fontVariant: ['tabular-nums'] },
  hint: { color: '#e5e7eb', fontSize: 12 },
  cancelZoneWrap: { position: 'absolute', bottom: 16, alignItems: 'center', gap: 6 },
  cancelZone: { width: 64, height: 64, borderRadius: 32, borderWidth: 2, borderColor: 'rgba(255,255,255,0.7)', backgroundColor: 'rgba(20,20,24,0.85)', alignItems: 'center', justifyContent: 'center' },
  cancelZoneOn: { width: 76, height: 76, borderRadius: 38, borderColor: '#fff', backgroundColor: '#dc2626' },
  cancelZoneText: { color: '#f3f4f6', fontSize: 12, fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 },
  cancelZoneTextOn: { color: '#fff' },
  promptWrap: { alignItems: 'center', marginVertical: 4 },
  prompt: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, maxWidth: '92%' },
  promptText: { color: colors.text, fontSize: 12 },
  promptLink: { color: colors.accent, fontWeight: '600' },
  draftCardWrap: { paddingHorizontal: spacing.md, paddingTop: spacing.xs },
  draftCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingVertical: 8, paddingLeft: 12, paddingRight: 8, borderRadius: 10, backgroundColor: colors.inputBg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  draftCardText: { color: colors.text, fontSize: 15, lineHeight: DRAFT_CARD_LINE_HEIGHT },
  draftCardClear: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.border },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
