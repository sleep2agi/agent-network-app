// 手机的底部确认单(微信「删除联系人」那种):说明 + 红字确认 + 取消。
// 用户管理的「移出网络」(成员页)与「删除分组」(分组页)共用。
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { colors, onThemeChange, radius, spacing } from './theme';
import { t as tr } from './i18n';
import './i18n-users';
import { useModalSafePadding } from './safe-area-runtime';

export default function RemoveSheet({ name, busy, onCancel, onConfirm, message, confirmLabel }: { name: string; busy: boolean; onCancel: () => void; onConfirm: () => void; message?: string; confirmLabel?: string }) {
  const safe = useModalSafePadding('fullScreen');
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.sheetBackdrop} onPress={onCancel} testID="member-remove-backdrop">
        <Pressable style={[styles.sheet, { paddingBottom: Math.max(safe.paddingBottom ?? 0, spacing.sm) }]} onPress={() => {}} testID="member-remove-sheet">
          <Text style={styles.sheetText}>{message ?? tr('users.removeConfirm', { name })}</Text>
          <Pressable accessibilityRole="button" disabled={busy} onPress={onConfirm} style={({ pressed }) => [styles.sheetBtn, styles.sheetDivider, pressed && styles.pressed]} testID="member-remove-confirm">
            {busy ? <ActivityIndicator size="small" color={colors.failed} /> : <Text style={styles.sheetDanger}>{confirmLabel ?? tr('users.removeYes')}</Text>}
          </Pressable>
          <View style={styles.sheetGap} />
          <Pressable accessibilityRole="button" onPress={onCancel} style={({ pressed }) => [styles.sheetBtn, pressed && styles.pressed]} testID="member-remove-cancel">
            <Text style={styles.sheetCancel}>{tr('users.cancel')}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = () => StyleSheet.create({
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.surface, borderTopRightRadius: radius.surface, overflow: 'hidden' },
  sheetText: { color: colors.textMuted, fontSize: 13, lineHeight: 19, textAlign: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  sheetBtn: { minHeight: 56, alignItems: 'center', justifyContent: 'center' },
  sheetDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  sheetGap: { height: 8, backgroundColor: colors.bg },
  sheetCancel: { color: colors.text, fontSize: 16 },
  sheetDanger: { color: colors.failed, fontSize: 16, fontWeight: '600' },
  pressed: { opacity: 0.75 },
});

let styles = makeStyles();
onThemeChange(() => { styles = makeStyles(); });
