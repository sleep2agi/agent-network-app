// 桌面语音输入的界面(模型与理由见 desktop-voice-bar-model.ts):
//   · DesktopMicButton:输入框工具栏里的 🎤,点一下开始录音(不是按住)。
//   · DesktopVoiceBar:录音中代替工具栏那一行的录音条 —— 红点 · 电平条 · 计时 · 提示 ……「取消 ✕」「完成 ✓」,
//     Enter = 完成、Esc = 取消;流式中间结果作为灰色预览字显示在输入框里(条的上方)。
// 状态全在 useVoiceInput,动作(开始 / 完成 / 取消)由 ChatScreen 传进来,和它的选区冻结、插到光标处同一条路。
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
import { colors, onThemeChange, radius, spacing } from './theme';
import { ds } from './ui-scale';
import { formatElapsed } from './voice-input-model';
import { barHint, barKeyAction, isRecordingPhase } from './desktop-voice-bar-model';
import type { VoiceInput } from './useVoiceInput';

// mousedown 的默认动作会把焦点从输入框挪到按钮上:阻止它 → 录音期间输入框保持焦点、选区不动。
const keepInputFocus = Platform.OS === 'web' ? { onMouseDown: (e: { preventDefault(): void }) => e.preventDefault() } : null;

export function DesktopMicButton({ voice, onPress }: { voice: VoiceInput; onPress: () => void }) {
  return (
    <Pressable
      {...keepInputFocus}
      accessibilityRole="button"
      accessibilityLabel={voice.configured ? '语音输入' : '语音输入(未配置)'}
      accessibilityHint={voice.configured ? '点一下开始录音,完成后文字插到光标处' : '需要先在 设置 → 语音输入 里配置'}
      onPress={onPress}
      hitSlop={6}
      testID="voice-mic"
      style={({ pressed, hovered }: any) => [styles.mic, (hovered || pressed) && styles.micHover]}
    >
      <Ionicons name="mic-outline" size={20} color={voice.configured ? colors.textSecondary : colors.textMuted} />
    </Pressable>
  );
}

const BARS = 7;

/** hint:用键盘快捷键录音时换成快捷键自己的结束 / 取消说法(voice-shortcut-model.ts kbdVoiceHint)。 */
export function DesktopVoiceBar({ voice, onDone, onCancel, hint }: { voice: VoiceInput; onDone: () => void; onCancel: () => void; hint?: string }) {
  const { phase } = voice.state;
  const recording = isRecordingPhase(phase);
  const live = phase === 'recording' || phase === 'cancelArmed';
  const actions = useRef({ onDone, onCancel, phase });
  actions.current = { onDone, onCancel, phase };
  // Enter / Esc:window 捕获阶段,先于输入框自己的 Enter 发送。
  useEffect(() => {
    const win = (globalThis as any).window;
    if (!win?.addEventListener) return;
    const onKey = (e: KeyboardEvent) => {
      const a = barKeyAction(actions.current.phase, e);
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      if (a === 'done') actions.current.onDone();
      else if (a === 'cancel') actions.current.onCancel();
    };
    win.addEventListener('keydown', onKey, true);
    return () => win.removeEventListener('keydown', onKey, true);
  }, []);
  return (
    <>
      {voice.interim ? (
        <Text style={styles.ghost} numberOfLines={2} ellipsizeMode="head" testID="voice-bar-interim">{voice.interim}</Text>
      ) : null}
      <View style={styles.bar} testID="voice-bar" accessibilityLiveRegion="polite">
        <View style={[styles.dot, !live && styles.dotIdle]} testID="voice-bar-dot" />
        {phase === 'transcribing' ? (
          <ActivityIndicator size="small" color={colors.textSecondary} testID="voice-bar-spinner" />
        ) : (
          <View style={styles.levels} testID="voice-bar-level">
            {Array.from({ length: BARS }, (_, i) => {
              const shape = 1 - Math.abs(i - (BARS - 1) / 2) / ((BARS + 1) / 2);
              const h = live ? 4 + Math.round(14 * Math.min(1, voice.level * (0.6 + shape) * 2)) : 4;
              return <View key={i} style={[styles.level, { height: h }]} />;
            })}
          </View>
        )}
        <Text style={styles.elapsed} testID="voice-bar-elapsed">{formatElapsed(voice.elapsedMs)}</Text>
        <Text style={styles.hint} numberOfLines={1} testID="voice-bar-hint">{hint ?? barHint(phase)}</Text>
        <Pressable
          {...keepInputFocus}
          accessibilityRole="button"
          accessibilityLabel="取消录音"
          disabled={!recording}
          onPress={onCancel}
          testID="voice-bar-cancel"
          style={({ pressed, hovered }: any) => [styles.button, (hovered || pressed) && styles.buttonHover, !recording && styles.disabled]}
        >
          <Ionicons name="close" size={16} color={colors.textSecondary} />
          <Text style={styles.buttonText}>取消</Text>
        </Pressable>
        <Pressable
          {...keepInputFocus}
          accessibilityRole="button"
          accessibilityLabel="完成录音,插入文字"
          disabled={!recording}
          onPress={onDone}
          testID="voice-bar-done"
          style={({ pressed }) => [styles.button, styles.done, pressed && { opacity: 0.75 }, !recording && styles.disabled]}
        >
          <Ionicons name="checkmark" size={16} color={colors.onAccent} />
          <Text style={[styles.buttonText, styles.doneText]}>完成</Text>
        </Pressable>
      </View>
    </>
  );
}

const makeStyles = () => StyleSheet.create({
  mic: { width: ds(32), height: ds(32), borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  micHover: { backgroundColor: colors.rowHover },
  // 与工具栏同高、同一个 paddingTop:换上来时输入框不跳。
  // 2026-09-29 卡片化输入区:工具栏是 paddingTop 4 + 34 = 38 高(ChatScreen desktopToolbar),这里一致。
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: 4, height: 38 },
  dot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.failed },
  dotIdle: { backgroundColor: colors.textMuted },
  levels: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 18 },
  level: { width: 3, borderRadius: radius.pill, backgroundColor: colors.accent },
  elapsed: { color: colors.text, fontSize: 12, fontVariant: ['tabular-nums'] },
  hint: { flex: 1, color: colors.textMuted, fontSize: 11 },
  button: { flexDirection: 'row', alignItems: 'center', gap: 4, height: ds(32), paddingHorizontal: spacing.md, borderRadius: radius.control, borderWidth: 1, borderColor: colors.border },
  buttonHover: { backgroundColor: colors.rowHover },
  buttonText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  done: { backgroundColor: colors.accent, borderColor: colors.accent },
  doneText: { color: colors.onAccent },
  disabled: { opacity: 0.45 },
  ghost: { color: colors.textMuted, fontSize: 14, lineHeight: 21, fontStyle: 'italic' },
});

// 与其它组件同一套主题写法:模块级 styles 随主题重建。
let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
