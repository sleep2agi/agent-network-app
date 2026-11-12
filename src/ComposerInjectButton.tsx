// #4685 —— 回合在飞时的「插话」次级动作：把这条内容**注入当前正在跑的那一轮**（原生 steer），
// 不停上一轮，也不新开一轮。
//
// 与 ComposerStopButton / 「打断并发送」的区别：
//   · 停止按钮      → 停下，什么也不发
//   · 打断并发送    → 停下，再以新指令开新一轮
//   · 插话（这里）  → 不停，把内容并入当前轮
// 三者互不兜底：插话失败不会自动改成打断，也不会自动降级成普通发送（那会让用户以为插进去了）。
import { Pressable } from 'react-native';
import { Text } from './ui-text';

import { Ionicons } from './icons';
import { t } from './i18n';
import { colors } from './theme';
import { ds } from './ui-scale';

export default function ComposerInjectButton(props: {
  enabled: boolean;
  desktop?: boolean;
  onPress: () => void;
}) {
  const { enabled, desktop = false, onPress } = props;
  if (!enabled) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('chat.inject.action')}
      accessibilityHint={t('chat.inject.actionHint')}
      testID="composer-inject"
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6 }}
      style={({ pressed }) => [
        { flexDirection: 'row', alignItems: 'center', gap: desktop ? ds(3) : ds(2), paddingHorizontal: desktop ? ds(2) : ds(1) },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Ionicons name="git-merge-outline" size={12} color={colors.textMuted} />
      <Text style={{ fontSize: 11, color: colors.textMuted }} numberOfLines={1}>{t('chat.inject.action')}</Text>
    </Pressable>
  );
}
