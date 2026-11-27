// #4591 —— 聊天页「停止当前回合」按钮。
//
// 只负责画紧凑高辨识度胶囊按钮：什么时候能点由 ChatScreen 用 interruptable(sessionStatus) 决定，
// 详细超时/失败解释走输入框上方的 composerNotice 轻提示，不再把一长串灰字焊在工具栏里。
import { ActivityIndicator, Pressable } from 'react-native';
import { Text } from './ui-text';

import { Ionicons } from './icons';
import { t } from './i18n';
import { colors, radius, spacing, themeMode, weight } from './theme';
import { ds } from './ui-scale';
import { stopButtonPresentation, type InterruptState } from './turn-interrupt';

export default function ComposerStopButton(props: {
  state: InterruptState;
  enabled: boolean;
  desktop?: boolean;
  onPress: () => void;
}) {
  const { state, enabled, desktop, onPress } = props;
  const busy = state.phase === 'sending' || state.phase === 'waiting';
  const view = stopButtonPresentation(state.phase);
  const label = t(view.labelKey);
  const a11yLabel = state.phase === 'unconfirmed'
    ? t('chat.interrupt.unconfirmed')
    : state.phase === 'failed'
      ? t('chat.interrupt.failed', { message: state.detail ?? '' })
      : state.phase === 'unsupported'
        ? t('chat.interrupt.unsupported')
        : label;
  const actionable = enabled && !busy && state.phase !== 'interrupted';
  const isDark = themeMode() === 'dark';
  const accent = view.tone === 'success' ? colors.running : view.tone === 'muted' ? colors.textMuted : colors.failed;
  const pillBg = view.tone === 'muted'
    ? colors.subtleFill
    : `${accent}${isDark ? '22' : '14'}`;
  const pillBorder = view.tone === 'muted'
    ? colors.border
    : `${accent}${isDark ? '52' : '38'}`;
  const iconSize = desktop ? 11 : 10;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint={enabled ? t('chat.interrupt.a11y') : t('chat.interrupt.idleHint')}
      testID="composer-stop-entry"
      onPress={onPress}
      disabled={!actionable}
      hitSlop={{ top: 6, bottom: 6 }}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: ds(4),
          height: desktop ? ds(30) : ds(26),
          paddingHorizontal: desktop ? spacing.md : spacing.sm,
          borderRadius: radius.pill,
          borderWidth: 1,
          backgroundColor: pillBg,
          borderColor: pillBorder,
        },
        !actionable && !busy && view.tone !== 'success' && { opacity: 0.5 },
        pressed && actionable && { opacity: 0.72 },
      ]}
    >
      {view.kind === 'spinner' ? (
        <ActivityIndicator size="small" color={accent} style={{ transform: [{ scale: 0.72 }] }} />
      ) : view.kind === 'check' ? (
        <Ionicons name="checkmark" size={desktop ? 13 : 12} color={accent} />
      ) : view.kind === 'retry' ? (
        <Ionicons name="refresh" size={desktop ? 12 : 11} color={accent} />
      ) : (
        <Ionicons name="stop" size={iconSize} color={accent} />
      )}
      <Text
        style={{ fontSize: desktop ? 12 : 11, fontWeight: weight.strong, color: accent }}
        numberOfLines={1}
        testID="composer-stop-label"
      >
        {label}
      </Text>
    </Pressable>
  );
}
