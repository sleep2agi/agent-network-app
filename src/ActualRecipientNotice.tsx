import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SendConfirmation } from './actual-recipient';
import { colors, spacing } from './theme';

export default function ActualRecipientNotice({
  confirmation,
  onDismiss,
}: {
  confirmation: SendConfirmation;
  onDismiss?: () => void;
}) {
  const actual = confirmation.actualRecipient;
  return (
    <View style={styles.notice} testID="actual-recipient-notice">
      <View style={styles.copy}>
        <Text style={styles.title}>{confirmation.queued ? '已排队' : '已发送'}</Text>
        {actual ? (
          <>
            <Text style={styles.alias} selectable>实际接收：{actual.alias}</Text>
            <Text style={styles.identity} selectable>节点 {actual.toNodeId} · 网络 {actual.networkId}</Text>
          </>
        ) : (
          <Text style={styles.identity}>实际接收方：Hub 未报告（兼容旧版）</Text>
        )}
      </View>
      {onDismiss ? (
        <Pressable accessibilityRole="button" accessibilityLabel="关闭发送确认" onPress={onDismiss} hitSlop={8}>
          <Text style={styles.close}>×</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row', alignItems: 'flex-start', marginHorizontal: spacing.md,
    marginBottom: spacing.sm, padding: spacing.sm, borderRadius: 10,
    backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  copy: { flex: 1 },
  title: { color: colors.text, fontSize: 12, fontWeight: '700' },
  alias: { color: colors.text, fontSize: 12, marginTop: 2 },
  identity: { color: colors.textMuted, fontSize: 10, marginTop: 2 },
  close: { color: colors.textMuted, fontSize: 20, lineHeight: 20, paddingLeft: spacing.sm },
});

