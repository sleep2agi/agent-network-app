// #4591 —— 聊天页「停止当前回合」按钮。
//
// 只负责画：什么时候能点由 ChatScreen 用 interruptable(sessionStatus) 决定，
// 结果文案由 turn-interrupt.ts 的纯函数给出（在飞 / 空闲 / 超时未确认 / 失败 四态）。
import { Pressable } from 'react-native';
import { Text } from './ui-text';

import { Ionicons } from './icons';
import { t } from './i18n';
import { colors } from './theme';
import { ds } from './ui-scale';
import type { InterruptState } from './turn-interrupt';

export default function ComposerStopButton(props: {
  state: InterruptState;
  enabled: boolean;
  desktop?: boolean;
  onPress: () => void;
}) {
  const { state, enabled, desktop, onPress } = props;
  const busy = state.phase === 'sending' || state.phase === 'waiting';
  const label = (() => {
    switch (state.phase) {
      case 'sending': return t('chat.interrupt.sending');
      case 'waiting': return t('chat.interrupt.waiting');
      case 'interrupted': return t('chat.interrupt.interrupted');
      case 'unconfirmed': return t('chat.interrupt.unconfirmed');
      case 'failed': return t('chat.interrupt.failed', { message: state.detail ?? '' });
      case 'unsupported': return t('chat.interrupt.unsupported');
      default: return t('chat.interrupt.button');
    }
  })();
  const actionable = enabled && !busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={enabled ? t('chat.interrupt.a11y') : t('chat.interrupt.idleHint')}
      testID="composer-stop-entry"
      onPress={onPress}
      disabled={!actionable}
      hitSlop={{ top: 6, bottom: 6 }}
      style={({ pressed }) => [
        { flexDirection: 'row', alignItems: 'center', gap: ds(3), paddingHorizontal: ds(2) },
        !actionable && { opacity: 0.45 },
        pressed && actionable && { opacity: 0.7 },
      ]}
    >
      <Ionicons name="stop-circle-outline" size={desktop ? 13 : 12} color={colors.textMuted} />
      <Text style={{ fontSize: desktop ? 12 : 11, color: colors.textMuted }} numberOfLines={1} testID="composer-stop-label">
        {label}
      </Text>
    </Pressable>
  );
}
