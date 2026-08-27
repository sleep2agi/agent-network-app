import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text } from 'react-native';
import { ACTUAL_NOTICE_A11Y, NOTICE_AUTO_DISMISS_MS, noticePalette, type SendNotice } from './actual-recipient';
import { spacing, themeMode } from './theme';

/**
 * 一条自动消失的居中提示,只在**值得打断**的时候出现(排队 / Hub 改投了别的
 * 节点)。正常送达不走这里 —— 见 sendNoticeFor。
 *
 * 形态上刻意不是横幅:限宽居中、圆角、跟随主题的浅底、到点自己走。全宽 + 常驻
 * + 要人手动点 × 的那一版把「送达」呈现成了待办事项。
 */
export default function ActualRecipientNotice({
  notice,
  onDismiss,
}: {
  notice: SendNotice;
  onDismiss?: () => void;
}) {
  const palette = noticePalette(notice.kind, themeMode() === 'light' ? 'light' : 'dark');
  const opacity = useRef(new Animated.Value(0)).current;

  // 每换一条提示重新计时:连发两条时,第二条不该继承第一条剩下的时间。
  useEffect(() => {
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    if (!onDismiss) return;
    const timer = setTimeout(onDismiss, NOTICE_AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [notice, onDismiss, opacity]);

  return (
    <Animated.View
      style={[styles.toast, { backgroundColor: palette.surface, borderColor: palette.outline, opacity }]}
      testID="actual-recipient-notice"
      {...ACTUAL_NOTICE_A11Y}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="关闭发送提示"
        onPress={onDismiss}
        hitSlop={8}
        style={styles.body}
      >
        <Animated.View style={[styles.dot, { backgroundColor: palette.dot }]} />
        <Text style={[styles.title, { color: palette.title }]} numberOfLines={1}>{notice.title}</Text>
        <Text style={[styles.detail, { color: palette.detail }]} numberOfLines={1}>{notice.detail}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    alignSelf: 'center',
    maxWidth: 420,
    marginBottom: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
  },
  body: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: spacing.sm },
  title: { fontSize: 12, fontWeight: '600', marginRight: spacing.sm },
  detail: { fontSize: 12, flexShrink: 1 },
});
