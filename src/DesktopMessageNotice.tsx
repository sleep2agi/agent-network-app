import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet } from 'react-native';
import { Text } from './ui-text';
import { t } from './i18n';
import './i18n-tasks';
import type { DesktopMessageNotice as Notice } from './desktop-message-consume';
import { colors, onThemeChange, spacing, themeMode, radius } from './theme';

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
  onOpenTask,
}: {
  notice: Notice;
  onDismiss?: () => void;
  /** 任务通知(notice.taskNotice):点提示打开这张任务。不传 = 点了只是关掉(与普通消息一样)。 */
  onOpenTask?: (requirementId: string) => void;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const light = themeMode() === 'light';
  const surface = light ? '#f4f6f8f2' : '#161618f2';
  const outline = light ? '#e1e5ea' : '#26262b';
  const heading = notice.title || notice.from || '消息';
  const task = notice.taskNotice && onOpenTask ? notice.taskNotice : null;

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
        accessibilityLabel={task ? t('tasks.noticeOpenA11y') : '关闭主动消息'}
        onPress={task ? () => { onOpenTask!(task.requirementId); onDismiss?.(); } : onDismiss}
        hitSlop={8}
        style={styles.body}
      >
        <Animated.View style={[styles.dot, { backgroundColor: severityColor(notice.severity) }]} />
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>{heading}</Text>
        <Text style={[styles.detail, { color: colors.textSecondary }]} numberOfLines={2}>{notice.message}</Text>
        {task ? <Text style={[styles.open, { color: colors.accent }]} testID="desktop-message-open-task">{t('tasks.noticeOpen')}</Text> : null}
      </Pressable>
    </Animated.View>
  );
}

const makeStyles = () =>
  StyleSheet.create({
  toast: {
    alignSelf: 'center',
    maxWidth: 440,
    marginBottom: spacing.xs,
    borderRadius: radius.surface,
    borderWidth: 1,
  },
  body: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  dot: { width: 6, height: 6, borderRadius: radius.pill, marginRight: spacing.sm },
  title: { fontSize: 12, fontWeight: '600', marginRight: spacing.sm, maxWidth: 120 },
  detail: { fontSize: 12, flexShrink: 1 },
  open: { fontSize: 12, fontWeight: '600', marginLeft: spacing.sm, flexShrink: 0 },
});

// 🔴 模块级 StyleSheet 是在 import 那一刻按当时的 colors 算死的;不重建的话
// 这个组件永远停在 DARK —— 白色主题下会是黑的。同 ServerScreen/ServerSidebar 的写法,
// 有一道门守着(theme-restyle-coverage.test.ts),本文件正是被它逮住的。
let styles = makeStyles();
onThemeChange(() => {
  styles = makeStyles();
});
