import { useEffect, useSyncExternalStore } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { androidPromptVisible, INSTALL_PERMISSION_HINT } from './android-update-core';
import {
  androidUpdatePromptDismissed,
  androidUpdateSnapshot,
  dismissAndroidUpdate,
  downloadAndroidUpdate,
  installAndroidUpdate,
  openApkInBrowser,
  openUnknownSourcesSettings,
  subscribeAndroidUpdates,
} from './android-updater';
import { latestReleaseNotes } from './desktop-updater';
import { androidPromptView } from './update-prompt-model';
import { routePrefs } from './update-route-prefs';
import { colors, onThemeChange, spacing, themeMode } from './theme';
import { APP_VERSION } from './version';
import { useModalSafePadding } from './safe-area-runtime';
import { withBasePadding } from './modal-safe-area';

/**
 * 安卓更新弹窗。只在用户点了「软件更新」之后出现(安卓不做启动时自动检查)。
 * 当前版本 → 新版本 + 本版说明 → 下载(大小、进度)→ sha256 → 系统安装器;一个「在浏览器中下载」。
 * 下载来源(镜像优先、GitHub 兜底、记住上次成功的)全在 android-updater.ts 里静默处理,这里不出现任何来源。
 * 文案全部来自 update-prompt-model.ts(有测试),这里只摆放。
 */
export default function AndroidUpdatePrompt({ currentVersion = APP_VERSION }: { currentVersion?: string } = {}) {
  const update = useSyncExternalStore(subscribeAndroidUpdates, androidUpdateSnapshot, androidUpdateSnapshot);
  const dismissed = useSyncExternalStore(subscribeAndroidUpdates, androidUpdatePromptDismissed, androidUpdatePromptDismissed);
  // 同 DesktopUpdatePrompt:在 key={theme} 重挂树外面,跟随系统时要自己订阅主题才会重画。
  useSyncExternalStore(onThemeChange, themeMode, themeMode);
  const visible = androidPromptVisible(update, dismissed);
  const view = androidPromptView(update, { currentVersion });
  // 启动时读一次「上次成功来源」;顺带静默删掉 0.2.121 遗留的「下载线路」偏好。
  useEffect(() => { void routePrefs.hydrate().catch(() => undefined); }, []);
  const safe = useModalSafePadding('fullScreen');
  if (!view || !('apk' in update)) return null;
  const onPrimary = () => {
    if (!view.primary) return;
    if (view.primary.action === 'install') void installAndroidUpdate();
    else void downloadAndroidUpdate();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => { if (update.kind !== 'downloading') dismissAndroidUpdate(); }}>
      <View style={[styles.backdrop, withBasePadding(safe, 20)]}>
        <View style={styles.card} testID="android-update-prompt">
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} bounces={false}>
            <Text style={styles.title}>{view.title}</Text>
            <View style={styles.versions} testID="android-update-versions">
              {view.versions.current ? (
                <>
                  <View style={styles.versionCol}>
                    <Text style={styles.versionCaption}>当前版本</Text>
                    <Text style={styles.versionOld} testID="android-update-current">{view.versions.current}</Text>
                  </View>
                  <Text style={styles.arrow}>→</Text>
                </>
              ) : null}
              <View style={styles.versionCol}>
                <Text style={styles.versionCaption}>新版本</Text>
                <Text style={styles.versionNew} testID="android-update-next">{view.versions.next}</Text>
              </View>
            </View>
            <Text style={styles.meta} testID="android-update-meta">{view.meta}</Text>

            <Text style={styles.sectionLabel}>更新内容</Text>
            <ScrollView style={styles.notesScroll} contentContainerStyle={styles.notesContent} testID="android-update-notes" nestedScrollEnabled>
              <Text style={styles.notes} selectable>{latestReleaseNotes(update.notes)}</Text>
            </ScrollView>

            {update.kind === 'downloading' ? (
              <View style={styles.progressBlock} testID="android-update-progress">
                <View style={styles.progressRow}>
                  <ActivityIndicator color={colors.accent} size="small" />
                  <Text style={styles.progressText} testID="android-update-progress-line">{view.progressLine}</Text>
                </View>
                <View style={styles.bar}><View style={[styles.barFill, { width: `${update.percent ?? 0}%` }]} /></View>
              </View>
            ) : null}

            {update.kind === 'download-error' ? (
              <View testID="android-update-error">
                <Text style={styles.error} testID="android-update-error-title">{view.errorTitle}</Text>
                {view.errorDetail ? <Text style={styles.errorLine}>{view.errorDetail}</Text> : null}
              </View>
            ) : null}

            {view.showOpenSettings ? (
              <Text style={styles.hintBlock} testID="android-update-install-hint">{INSTALL_PERMISSION_HINT}</Text>
            ) : null}

            {view.primary ? (
              <Pressable testID={`android-update-${view.primary.action}`} style={styles.button} onPress={onPrimary}>
                <Text style={styles.buttonText}>{view.primary.label}</Text>
              </Pressable>
            ) : null}
            {view.showOpenSettings ? (
              <Pressable testID="android-update-open-settings" style={styles.secondary} onPress={() => { void openUnknownSourcesSettings(); }}>
                <Text style={styles.secondaryText}>去设置允许安装</Text>
              </Pressable>
            ) : null}

            <Pressable testID="android-update-browser" style={styles.browserButton} onPress={() => { void openApkInBrowser(); }}>
              <Text style={styles.browserText} numberOfLines={1}>在浏览器中下载</Text>
            </Pressable>

            {view.showLater ? (
              <Pressable testID="android-update-later" style={styles.later} onPress={dismissAndroidUpdate}>
                <Text style={styles.laterText}>稍后</Text>
              </Pressable>
            ) : null}
            <Text style={styles.hint}>
              下载后先校验 sha256,再交给安卓系统安装器,不会静默安装。
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: '#0009', alignItems: 'center', justifyContent: 'center', padding: 20 },
    card: { width: '100%', maxWidth: 440, maxHeight: '92%', borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
    body: { flexGrow: 0 },
    bodyContent: { padding: 20 },
    title: { color: colors.text, fontSize: 18, fontWeight: '600' },
    versions: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md, marginTop: spacing.md },
    versionCol: { gap: 2 },
    versionCaption: { color: colors.textMuted, fontSize: 11 },
    versionOld: { color: colors.textSecondary, fontSize: 17, lineHeight: 26, fontWeight: '500' },
    versionNew: { color: colors.accent, fontSize: 20, lineHeight: 26, fontWeight: '600' },
    // 两列数值同一行高(26)→ 标题行、数值行、箭头各自同一条中线。
    arrow: { color: colors.textMuted, fontSize: 17, lineHeight: 26 },
    meta: { color: colors.textSecondary, fontSize: 12, marginTop: spacing.xs },
    sectionLabel: { color: colors.textMuted, fontSize: 12, marginTop: spacing.md, marginBottom: spacing.xs },
    notesScroll: { maxHeight: 150, borderRadius: 10, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
    notesContent: { padding: spacing.md },
    notes: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
    progressBlock: { marginTop: spacing.md },
    progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    progressText: { color: colors.textSecondary, fontSize: 13, flexShrink: 1 },
    bar: { height: 6, borderRadius: 3, backgroundColor: colors.border, marginTop: spacing.sm, overflow: 'hidden' },
    barFill: { height: 6, backgroundColor: colors.accent },
    error: { color: colors.failed, fontSize: 13, lineHeight: 19, marginTop: spacing.md },
    errorLine: { color: colors.failed, fontSize: 12, lineHeight: 18 },
    hintBlock: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: spacing.sm },
    // 主按钮 / 次按钮 / 在浏览器中下载 / 稍后 同宽(撑满卡片内容宽)、同一条中线。
    button: { marginTop: spacing.lg, height: 44, backgroundColor: colors.accent, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
    secondary: { marginTop: spacing.sm, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.accent },
    secondaryText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
    browserButton: { marginTop: spacing.sm, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
    browserText: { color: colors.accent, fontSize: 13 },
    later: { marginTop: spacing.sm, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    laterText: { color: colors.textSecondary, fontSize: 14 },
    hint: { color: colors.textMuted, fontSize: 10, lineHeight: 15, marginTop: spacing.xs },
  });

// 模块级 StyleSheet 必须随主题重建(theme-restyle-coverage.test.ts)。
let styles = makeStyles();
onThemeChange(() => {
  styles = makeStyles();
});
