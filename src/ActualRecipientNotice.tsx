import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SendConfirmation } from './actual-recipient';
import { colors, spacing, themeMode } from './theme';
import { ACTUAL_NOTICE_A11Y } from './actual-recipient';

export default function ActualRecipientNotice({
  confirmation,
  onDismiss,
}: {
  confirmation: SendConfirmation;
  onDismiss?: () => void;
}) {
  const actual = confirmation.actualRecipient;
  const queued = confirmation.queued;
  const light = themeMode() === 'light';
  const tone = queued ? colors.blocked : colors.running;
  const surface = light
    ? (queued ? '#fff8eb' : '#effaf3')
    : (queued ? '#261d0e' : '#102219');
  const outline = light
    ? (queued ? '#f0d7a6' : '#bfe5cc')
    : (queued ? '#5b4420' : '#245b38');
  return (
    <View
      style={[styles.notice, { backgroundColor: surface, borderColor: outline }]}
      testID="actual-recipient-notice"
      {...ACTUAL_NOTICE_A11Y}
    >
      <View style={[styles.statusDot, { backgroundColor: tone }]} />
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.text }]}>{queued ? '已排队' : '已发送'}</Text>
        {actual ? (
          <Text style={[styles.identity, { color: colors.textSecondary }]} selectable numberOfLines={1}>
            接收方 {actual.alias} · 节点 {actual.toNodeId ?? '未报告'} · 网络 {actual.networkId ?? '未报告'}
          </Text>
        ) : (
          <Text style={[styles.identity, { color: colors.textSecondary }]} numberOfLines={1}>
            接收方由旧版 Hub 处理
          </Text>
        )}
      </View>
      {onDismiss ? (
        <Pressable accessibilityRole="button" accessibilityLabel="关闭发送确认" onPress={onDismiss} hitSlop={8}>
          <Text style={[styles.close, { color: colors.textMuted }]}>×</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row', alignItems: 'center', marginHorizontal: spacing.md,
    marginBottom: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: 9,
    borderWidth: 1,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4, marginRight: spacing.sm },
  copy: { flex: 1 },
  title: { fontSize: 12, fontWeight: '700', lineHeight: 16 },
  identity: { fontSize: 11, lineHeight: 15 },
  close: { fontSize: 18, lineHeight: 18, paddingLeft: spacing.sm },
});
