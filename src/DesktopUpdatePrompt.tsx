import { useEffect, useSyncExternalStore } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { checkDesktopUpdate, desktopUpdateSnapshot, installDesktopUpdate, latestReleaseNotes, subscribeDesktopUpdates } from './desktop-updater';
import { colors, onThemeChange, spacing, themeMode } from './theme';
import { desktopPromptView } from './update-prompt-model';
import { APP_VERSION } from './version';

export default function DesktopUpdatePrompt() {
  const update = useSyncExternalStore(subscribeDesktopUpdates, desktopUpdateSnapshot, desktopUpdateSnapshot);
  // 挂在 AppRoot 的 key={theme} 重挂树外面:弹窗开着时系统配色一变(跟随系统),模块级 styles
  // 已重建,但不订阅就不重画 —— 半边新主题半边旧主题。
  useSyncExternalStore(onThemeChange, themeMode, themeMode);
  useEffect(() => {
    if (!(globalThis as any).__TAURI_INTERNALS__) return;
    const timer = setTimeout(() => { void checkDesktopUpdate(); }, 2500);
    return () => clearTimeout(timer);
  }, []);

  const visible = update.kind === 'available' || update.kind === 'downloading';
  // 当前版本 → 新版本、更新来源(清单地址的主机:线路一 ModelScope / 线路二 GitHub)、下载进度与大小。
  const view = desktopPromptView(update, APP_VERSION);
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>发现新版本</Text>
          <View style={styles.versions} testID="desktop-update-versions">
            {view?.versions.current ? (
              <>
                <View style={styles.versionCol}>
                  <Text style={styles.versionCaption}>当前版本</Text>
                  <Text style={styles.versionOld}>{view.versions.current}</Text>
                </View>
                <Text style={styles.arrow}>→</Text>
              </>
            ) : null}
            <View style={styles.versionCol}>
              <Text style={styles.versionCaption}>新版本</Text>
              <Text style={styles.versionNew}>{view?.versions.next ?? ''}</Text>
            </View>
          </View>
          {view?.sourceLine ? <Text style={styles.meta} testID="desktop-update-source">{view.sourceLine}</Text> : null}
          {update.kind === 'available' ? (
            // 只放本版那一段,限高可滚动;按钮在滚动区外面,永远看得见。
            <ScrollView style={styles.notesScroll} contentContainerStyle={styles.notesContent} testID="desktop-update-notes">
              <Text style={styles.notes} selectable>{latestReleaseNotes(update.notes)}</Text>
            </ScrollView>
          ) : null}
          {update.kind === 'downloading' ? (
            <View style={styles.progressBlock}>
              <View style={styles.progress}><ActivityIndicator color={colors.accent} size="small" /><Text style={styles.progressText}>{view?.progressLine}</Text></View>
              <View style={styles.bar}><View style={[styles.barFill, { width: `${update.percent ?? 0}%` }]} /></View>
            </View>
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

const makeStyles = () =>
  StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0009', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 440, maxHeight: '85%', borderRadius: 16, padding: 22, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  notesScroll: { maxHeight: 240, marginTop: spacing.md, borderRadius: 10, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  notesContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  title: { color: colors.text, fontSize: 18, fontWeight: '600' },
  versions: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md, marginTop: spacing.md },
  versionCol: { gap: 2 },
  versionCaption: { color: colors.textMuted, fontSize: 11 },
  versionOld: { color: colors.textSecondary, fontSize: 17, lineHeight: 26, fontWeight: '500' },
  versionNew: { color: colors.accent, fontSize: 20, lineHeight: 26, fontWeight: '600' },
  // 两列数值同一行高(26)→ 标题行、数值行、箭头各自同一条中线。
    arrow: { color: colors.textMuted, fontSize: 17, lineHeight: 26 },
  meta: { color: colors.textSecondary, fontSize: 12, marginTop: spacing.xs },
  progressBlock: { marginTop: spacing.lg },
  progressText: { color: colors.textSecondary, fontSize: 13, flexShrink: 1 },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.border, marginTop: spacing.sm, overflow: 'hidden' },
  barFill: { height: 6, backgroundColor: colors.accent },
  notes: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: spacing.md },
  progress: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  button: { marginTop: spacing.lg, height: 44, backgroundColor: colors.accent, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  hint: { color: colors.textMuted, fontSize: 10, lineHeight: 15, marginTop: spacing.md },
});

// 🔴 模块级 StyleSheet 是在 import 那一刻按当时的 colors 算死的。
// 不重建的话,这个文件永远停在 DARK —— 白色主题下侧栏/弹窗仍是黑的。
// 同 ServerScreen.tsx 的写法;有一道测试守着,见 theme-restyle-coverage.test.ts。
let styles = makeStyles();
onThemeChange(() => {
  styles = makeStyles();
});
