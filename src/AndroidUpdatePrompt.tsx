import { useSyncExternalStore } from 'react';
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
import { colors, onThemeChange, spacing, themeMode } from './theme';

/**
 * 安卓更新弹窗。只在用户点了「软件更新」之后出现(安卓不做启动时自动检查)。
 * 版本号 + 本版说明 → 下载(进度)→ 系统安装器;失败有「在浏览器中下载」兜底。
 */
export default function AndroidUpdatePrompt() {
  const update = useSyncExternalStore(subscribeAndroidUpdates, androidUpdateSnapshot, androidUpdateSnapshot);
  const dismissed = useSyncExternalStore(subscribeAndroidUpdates, androidUpdatePromptDismissed, androidUpdatePromptDismissed);
  // 同 DesktopUpdatePrompt:在 key={theme} 重挂树外面,跟随系统时要自己订阅主题才会重画。
  useSyncExternalStore(onThemeChange, themeMode, themeMode);
  const visible = androidPromptVisible(update, dismissed);
  if (!('apk' in update)) return null;
  const sizeMb = update.apk.size ? ` · ${(update.apk.size / 1024 / 1024).toFixed(1)} MB` : '';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => { if (update.kind !== 'downloading') dismissAndroidUpdate(); }}>
      <View style={styles.backdrop}>
        <View style={styles.card} testID="android-update-prompt">
          <Text style={styles.title}>{update.kind === 'ready' ? '安装新版本' : '发现新版本'}</Text>
          <Text style={styles.version}>v{update.version}{sizeMb}</Text>
          <ScrollView style={styles.notesScroll} contentContainerStyle={styles.notesContent} testID="android-update-notes">
            <Text style={styles.notes} selectable>{latestReleaseNotes(update.notes)}</Text>
          </ScrollView>

          {update.kind === 'downloading' ? (
            <View style={styles.progressBlock} testID="android-update-progress">
              <View style={styles.progressRow}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.notes}>{update.verifying ? '正在校验安装包(sha256)…' : `正在下载…${update.percent == null ? '' : ` ${update.percent}%`}`}</Text>
              </View>
              <View style={styles.bar}><View style={[styles.barFill, { width: `${update.percent ?? 0}%` }]} /></View>
            </View>
          ) : null}

          {update.kind === 'download-error' ? (
            <Text style={styles.error} testID="android-update-error">下载失败：{update.message}。可以重试,或在浏览器中下载后手动安装。</Text>
          ) : null}

          {update.kind === 'ready' && update.installAttempted ? (
            <Text style={styles.hintBlock} testID="android-update-install-hint">{INSTALL_PERMISSION_HINT}</Text>
          ) : null}

          {update.kind === 'available' ? (
            <Pressable testID="android-update-download" style={styles.button} onPress={() => { void downloadAndroidUpdate(); }}>
              <Text style={styles.buttonText}>下载并安装</Text>
            </Pressable>
          ) : null}
          {update.kind === 'download-error' ? (
            <Pressable testID="android-update-retry" style={styles.button} onPress={() => { void downloadAndroidUpdate(); }}>
              <Text style={styles.buttonText}>重试下载</Text>
            </Pressable>
          ) : null}
          {update.kind === 'ready' ? (
            <Pressable testID="android-update-install" style={styles.button} onPress={() => { void installAndroidUpdate(); }}>
              <Text style={styles.buttonText}>{update.installAttempted ? '重新安装' : '安装'}</Text>
            </Pressable>
          ) : null}
          {update.kind === 'ready' && update.installAttempted ? (
            <Pressable testID="android-update-open-settings" style={styles.secondary} onPress={() => { void openUnknownSourcesSettings(); }}>
              <Text style={styles.secondaryText}>去设置允许安装</Text>
            </Pressable>
          ) : null}

          <View style={styles.footer}>
            {update.kind === 'download-error' || update.kind === 'downloading' || (update.kind === 'ready' && update.installAttempted) ? (
              <Pressable testID="android-update-browser" onPress={() => { void openApkInBrowser(); }} hitSlop={8}>
                <Text style={styles.link}>在浏览器中下载</Text>
              </Pressable>
            ) : <View />}
            {update.kind !== 'downloading' ? (
              <Pressable testID="android-update-later" onPress={dismissAndroidUpdate} hitSlop={8}>
                <Text style={styles.later}>稍后</Text>
              </Pressable>
            ) : null}
          </View>
          <Text style={styles.hint}>
            {update.apk.source === 'mirror'
              ? '安装包来自 ModelScope 国内镜像(与 GitHub Releases 逐字节相同),镜像不可用时改从 GitHub 下载;'
              : '安装包来自 GitHub Releases;'}
            下载后先校验 sha256,再交给安卓系统安装器;不会静默安装。
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: '#0009', alignItems: 'center', justifyContent: 'center', padding: 24 },
    card: { width: '100%', maxWidth: 440, maxHeight: '90%', borderRadius: 16, padding: 22, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
    title: { color: colors.text, fontSize: 18, fontWeight: '600' },
    version: { color: colors.accent, fontSize: 14, marginTop: spacing.xs },
    notesScroll: { maxHeight: 200, marginTop: spacing.md, borderRadius: 10, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
    notesContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
    notes: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: spacing.md },
    progressBlock: { marginTop: spacing.sm },
    progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    bar: { height: 6, borderRadius: 3, backgroundColor: colors.border, marginTop: spacing.sm, overflow: 'hidden' },
    barFill: { height: 6, backgroundColor: colors.accent },
    error: { color: colors.failed, fontSize: 13, lineHeight: 19, marginTop: spacing.md },
    hintBlock: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: spacing.md },
    button: { marginTop: spacing.lg, backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
    buttonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
    secondary: { marginTop: spacing.sm, borderRadius: 10, paddingVertical: 11, alignItems: 'center', borderWidth: 1, borderColor: colors.accent },
    secondaryText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
    footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md },
    link: { color: colors.accent, fontSize: 13 },
    later: { color: colors.textSecondary, fontSize: 13 },
    hint: { color: colors.textMuted, fontSize: 10, lineHeight: 15, marginTop: spacing.md },
  });

// 模块级 StyleSheet 必须随主题重建(theme-restyle-coverage.test.ts)。
let styles = makeStyles();
onThemeChange(() => {
  styles = makeStyles();
});
