import { Text, View } from 'react-native';
import type { UnreadBadge } from './unread-ledger';
import { styles } from './app-styles';

/** formatUnreadBadge 返回 null 时完全不渲染 —— 不留空红点（#161）。 */
export default function AgentUnreadBadge({
  badge,
  testID,
}: {
  badge: UnreadBadge | null;
  testID?: string;
}) {
  if (!badge) return null;
  return (
    <View
      testID={testID ?? 'unread-badge'}
      accessibilityRole="text"
      accessibilityLabel={badge.a11yLabel}
      style={styles.unreadBadge}
    >
      <Text style={styles.unreadBadgeText}>{badge.text}</Text>
    </View>
  );
}
