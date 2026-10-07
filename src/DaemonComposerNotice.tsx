// 看板 #692 —— 守护节点(host_supervisor)的会话页底部:不是输入框,是一行说明 + 两个入口。
// 判据与入口的数据在 daemon-node.ts(纯逻辑,有单测);这里只负责画。桌面与手机共用。
import { Pressable, View } from 'react-native';
import { Ionicons } from './icons';
import { Text } from './ui-text';
import { t } from './i18n';
import { colors, spacing } from './theme';

export default function DaemonComposerNotice({ managedCount, onOpenManaged, onOpenLogs, bottomInset = 0 }: {
  /** 它托管的节点数;0 或没有打开方式时不画这个入口。 */
  managedCount: number;
  onOpenManaged?: () => void;
  /** 打开节点信息页的「运行日志」分区;不传(没有节点页)时不画。 */
  onOpenLogs?: () => void;
  /** Android edge-to-edge:手势条高度(同输入行的 composerInset)。 */
  bottomInset?: number;
}) {
  const link = (testID: string, icon: string, label: string, onPress: () => void) => (
    <Pressable
      testID={testID}
      accessibilityRole="link"
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 }, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name={icon as any} size={15} color={colors.accent} />
      <Text style={{ color: colors.accent, fontSize: 13 }}>{label}</Text>
      <Ionicons name="chevron-forward" size={13} color={colors.accent} />
    </Pressable>
  );
  const showManaged = managedCount > 0 && !!onOpenManaged;
  return (
    <View
      testID="daemon-composer-notice"
      style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md + bottomInset, gap: spacing.sm }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
        <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} style={{ marginTop: 1 }} />
        <Text style={{ flex: 1, color: colors.textSecondary, fontSize: 13, lineHeight: 19 }} testID="daemon-composer-text">{t('chat.daemon.notice')}</Text>
      </View>
      {showManaged || onOpenLogs ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg, paddingLeft: 22 }}>
          {showManaged ? link('daemon-open-managed', 'git-network-outline', t('chat.daemon.managed', { count: managedCount }), onOpenManaged!) : null}
          {onOpenLogs ? link('daemon-open-logs', 'document-text-outline', t('chat.info.section:logs'), onOpenLogs) : null}
        </View>
      ) : null}
    </View>
  );
}
