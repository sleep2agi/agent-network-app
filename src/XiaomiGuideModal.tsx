import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from './theme';
import { XIAOMI_GUIDE_FOOTNOTE, XIAOMI_GUIDE_INTRO, XIAOMI_GUIDE_STEPS, XIAOMI_GUIDE_TITLE } from './xiaomi-guide';
import { openAppDetailsSettings, openXiaomiAutostartSettings } from './mobile-notifications';

/** 设置 → 通知 →「小米/HyperOS 后台设置指引」。文案在 xiaomi-guide.ts。 */
export default function XiaomiGuideModal({ onClose }: { onClose: () => void }) {
  const styles = makeStyles();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card} testID="xiaomi-guide">
          <Text style={styles.title}>{XIAOMI_GUIDE_TITLE}</Text>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            <Text style={styles.intro}>{XIAOMI_GUIDE_INTRO}</Text>
            {XIAOMI_GUIDE_STEPS.map(step => (
              <View key={step.title} style={styles.step}>
                <Text style={styles.stepTitle}>{step.title}</Text>
                <Text style={styles.stepDetail}>{step.detail}</Text>
              </View>
            ))}
            <Text style={styles.footnote}>{XIAOMI_GUIDE_FOOTNOTE}</Text>
          </ScrollView>
          <Pressable testID="xiaomi-guide-open-app-settings" accessibilityRole="button" style={({ pressed }) => [styles.primary, pressed && { opacity: 0.7 }]} onPress={() => { void openAppDetailsSettings(); }}>
            <Text style={styles.primaryText}>打开应用设置</Text>
          </Pressable>
          <Pressable testID="xiaomi-guide-open-autostart" accessibilityRole="button" style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.7 }]} onPress={() => { void openXiaomiAutostartSettings(); }}>
            <Text style={styles.secondaryText}>打开自启动管理</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.close} onPress={onClose}>
            <Text style={styles.closeText}>知道了</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// 弹窗在主题重挂的树之内(SettingsScreen 里),每次打开时按当前主题建样式即可。
const makeStyles = () => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: { width: '100%', maxWidth: 460, maxHeight: '90%', backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: spacing.lg },
  title: { color: colors.text, fontSize: 17, fontWeight: '600' },
  scroll: { marginTop: spacing.sm, flexGrow: 0 },
  scrollContent: { paddingBottom: spacing.sm, gap: spacing.md },
  intro: { color: colors.textSecondary, fontSize: 13, lineHeight: 20 },
  step: { gap: 4 },
  stepTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  stepDetail: { color: colors.textSecondary, fontSize: 13, lineHeight: 20 },
  footnote: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  primary: { marginTop: spacing.md, backgroundColor: colors.accent, borderRadius: 10, paddingVertical: spacing.sm + 2, alignItems: 'center' },
  primaryText: { color: colors.onAccent, fontSize: 14, fontWeight: '600' },
  secondary: { marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: spacing.sm + 2, alignItems: 'center' },
  secondaryText: { color: colors.text, fontSize: 14 },
  close: { marginTop: spacing.sm, paddingVertical: spacing.sm, alignItems: 'center' },
  closeText: { color: colors.textSecondary, fontSize: 14 },
});
