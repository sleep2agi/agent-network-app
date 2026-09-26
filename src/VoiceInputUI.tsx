// 语音输入的三块界面:麦克风按钮(按住说话)、录音浮层、未配置时的「去设置」提示条。
// 状态与手势全在 useVoiceInput;这里只画。

import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { colors, onThemeChange, spacing } from './theme';
import { formatElapsed, overlayHint } from './voice-input-model';
import type { VoiceInput } from './useVoiceInput';

/** 麦克风按钮。手机:在输入框里的右侧;桌面:工具栏里、「发送」左边。 */
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

const BARS = 7;

/** 按住期间盖在消息区底部的浮层(不接收触摸,手势留在麦克风上)。 */
export function VoiceRecordingOverlay({ voice, bottom }: { voice: VoiceInput; bottom: number }) {
  const { phase } = voice.state;
  if (phase === 'idle') return null;
  const cancel = phase === 'cancelArmed';
  const level = voice.level;
  return (
    <View pointerEvents="none" style={[styles.overlayWrap, { bottom }]} testID="voice-overlay">
      <View style={[styles.overlay, cancel && styles.overlayCancel]}>
        {phase === 'transcribing' ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <View style={styles.bars}>
            {Array.from({ length: BARS }, (_, i) => {
              // 中间高两边低的电平条;level=0 时仍留一点高度表示「在录」。
              const shape = 1 - Math.abs(i - (BARS - 1) / 2) / ((BARS + 1) / 2);
              const h = 6 + Math.round(30 * Math.min(1, level * (0.6 + shape)));
              return <View key={i} style={[styles.bar, { height: h }, cancel && styles.barCancel]} />;
            })}
          </View>
        )}
        {phase === 'recording' || phase === 'cancelArmed' ? <Text style={styles.elapsed} testID="voice-elapsed">{formatElapsed(voice.elapsedMs)}</Text> : null}
        <Text style={styles.hint} testID="voice-hint">{overlayHint(phase)}</Text>
      </View>
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

const makeStyles = () => StyleSheet.create({
  mic: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  micLive: { backgroundColor: colors.accent },
  overlayWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 20 },
  overlay: { minWidth: 168, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, borderRadius: 14, backgroundColor: 'rgba(20,20,24,0.88)', alignItems: 'center', gap: 6 },
  overlayCancel: { backgroundColor: 'rgba(185,28,28,0.92)' },
  bars: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 38 },
  bar: { width: 4, borderRadius: 2, backgroundColor: '#7ee0ee' },
  barCancel: { backgroundColor: '#fecaca' },
  elapsed: { color: '#fff', fontSize: 13, fontVariant: ['tabular-nums'] },
  hint: { color: '#e5e7eb', fontSize: 12 },
  promptWrap: { alignItems: 'center', marginVertical: 4 },
  prompt: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, maxWidth: '92%' },
  promptText: { color: colors.text, fontSize: 12 },
  promptLink: { color: colors.accent, fontWeight: '600' },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
