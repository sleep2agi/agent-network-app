import { View } from 'react-native';
import { Text } from './ui-text';
import type { UnreadBadge } from './unread-ledger';
import { styles } from './app-styles';

/** formatUnreadBadge 返回 null 时完全不渲染 —— 不留空红点（#161）。 */
export default function AgentUnreadBadge({
  badge,
  testID,
  inline = false,
}: {
  /** `dot: true` = 手动「标为未读」(agent-row-menu.ts rowBadgeWithManual):不带数字的小红点。 */
  badge: (UnreadBadge & { dot?: boolean }) | null;
  testID?: string;
  /** Phone / two-pane rows (0.2.106): in the row's right column, not pinned to the avatar corner. */
  inline?: boolean;
}) {
  if (!badge) return null;
  return (
    <View
      testID={testID ?? 'unread-badge'}
      accessibilityRole="text"
      accessibilityLabel={badge.a11yLabel}
      style={[inline ? [styles.unreadBadge, styles.unreadBadgeInline] : styles.unreadBadge, badge.dot ? styles.unreadDot : null]}
    >
      {badge.dot ? null : <Text style={styles.unreadBadgeText}>{badge.text}</Text>}
    </View>
  );
}
