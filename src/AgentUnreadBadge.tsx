import { Text, View } from 'react-native';
import type { UnreadBadge } from './unread-ledger';
import { styles } from './app-styles';

/** formatUnreadBadge 返回 null 时完全不渲染 —— 不留空红点（#161）。 */
export default function AgentUnreadBadge({
  badge,
  testID,
  inline = false,
}: {
  badge: UnreadBadge | null;
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
      style={inline ? [styles.unreadBadge, styles.unreadBadgeInline] : styles.unreadBadge}
    >
      <Text style={styles.unreadBadgeText}>{badge.text}</Text>
    </View>
  );
}
