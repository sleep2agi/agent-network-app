import { useEffect, useSyncExternalStore } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { checkDesktopUpdate, desktopUpdateSnapshot, installDesktopUpdate, subscribeDesktopUpdates } from './desktop-updater';
import { colors, spacing } from './theme';

export default function DesktopUpdatePrompt() {
  const update = useSyncExternalStore(subscribeDesktopUpdates, desktopUpdateSnapshot, desktopUpdateSnapshot);
  useEffect(() => {
    if (!(globalThis as any).__TAURI_INTERNALS__) return;
    const timer = setTimeout(() => { void checkDesktopUpdate(); }, 2500);
    return () => clearTimeout(timer);
  }, []);

  const visible = update.kind === 'available' || update.kind === 'downloading';
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>发现新版本</Text>
          <Text style={styles.version}>v{'version' in update ? update.version : ''}</Text>
          {update.kind === 'available' ? <Text style={styles.notes}>{update.notes}</Text> : null}
          {update.kind === 'downloading' ? (
            <View style={styles.progress}><ActivityIndicator color={colors.accent} /><Text style={styles.notes}>正在下载安装…{update.percent == null ? '' : ` ${update.percent}%`}</Text></View>
          ) : (
            <Pressable style={styles.button} onPress={() => { void installDesktopUpdate(); }}>
              <Text style={styles.buttonText}>立即更新并重启</Text>
            </Pressable>
          )}
          <Text style={styles.hint}>更新包会进行签名校验；不会静默安装未知来源文件。</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0009', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 440, borderRadius: 16, padding: 22, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  version: { color: colors.accent, fontSize: 14, marginTop: spacing.xs },
  notes: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: spacing.md },
  progress: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  button: { marginTop: spacing.lg, backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  hint: { color: colors.textMuted, fontSize: 10, lineHeight: 15, marginTop: spacing.md },
});
