import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text } from 'react-native';
import type { DesktopMessageNotice as Notice } from './desktop-message-consume';
import { colors, spacing, themeMode } from './theme';

const AUTO_DISMISS_MS = 8000;

const severityColor = (severity: Notice['severity']): string => {
  switch (severity) {
    case 'success': return colors.running;
    case 'warning': return colors.blocked;
    case 'error': return colors.failed;
    default: return colors.accent;
  }
};

export default function DesktopMessageNotice({
  notice,
  onDismiss,
}: {
  notice: Notice;
  onDismiss?: () => void;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const light = themeMode() === 'light';
  const surface = light ? '#f4f6f8f2' : '#161618f2';
  const outline = light ? '#e1e5ea' : '#26262b';
  const heading = notice.title || notice.from || '消息';

  useEffect(() => {
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    if (!onDismiss) return;
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [notice, onDismiss, opacity]);

  return (
    <Animated.View
      style={[styles.toast, { backgroundColor: surface, borderColor: outline, opacity }]}
      testID="desktop-message-notice"
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="关闭主动消息"
        onPress={onDismiss}
        hitSlop={8}
        style={styles.body}
      >
        <Animated.View style={[styles.dot, { backgroundColor: severityColor(notice.severity) }]} />
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>{heading}</Text>
        <Text style={[styles.detail, { color: colors.textSecondary }]} numberOfLines={2}>{notice.message}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    alignSelf: 'center',
    maxWidth: 440,
    marginBottom: spacing.xs,
    borderRadius: 14,
    borderWidth: 1,
  },
  body: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: spacing.sm },
  title: { fontSize: 12, fontWeight: '600', marginRight: spacing.sm, maxWidth: 120 },
  detail: { fontSize: 12, flexShrink: 1 },
});
