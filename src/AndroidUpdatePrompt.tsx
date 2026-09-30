import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { Ionicons } from './icons';
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
import { parseReleaseNotes } from './release-notes';
import { androidPromptView } from './update-prompt-model';
import { routePrefs } from './update-route-prefs';
import { colors, onThemeChange, spacing, themeMode, radius } from './theme';
import { APP_VERSION } from './version';
import { useModalSafePadding } from './safe-area-runtime';
import { buttonStyle, buttonTextStyle } from './elevation';
import { heroBackground, heroTopColor, ReleaseNoteGroups, tint, UpdateBrandMark } from './update-screen-parts';

/**
 * 安卓「新版本」页。只在用户点了「软件更新」之后出现(安卓不做启动时自动检查)。
 *
 * owner 2026-09-30「更新的窗口太丑了,这是每次都要发社交媒体的……最好是能够全屏去看」:
 * 原来是一个小卡片,说明限高 150 截断在半行、露着英文标题和「- 」横杠,「在浏览器中下载」
 * 在下载进行时还占一整个大按钮,sha256 的技术说明直接给用户看。现在是全屏页(微信式):
 *   顶栏 ✕(= 稍后)· 头部 品牌图标 + 新版本号 + 大小 · 正文 解析后的完整说明(整页滚动)·
 *   底部固定 一个主按钮(下载中变成带 % 和 MB 的进度条)+ 一行小字链接「在浏览器中下载」。
 * 下载来源(镜像优先、GitHub 兜底、记住上次成功的)全在 android-updater.ts 里静默处理,这里不出现任何来源。
 * 文案全部来自 update-prompt-model.ts / release-notes.ts(有测试),这里只摆放。
 */
export default function AndroidUpdatePrompt({ currentVersion = APP_VERSION }: { currentVersion?: string } = {}) {
  const update = useSyncExternalStore(subscribeAndroidUpdates, androidUpdateSnapshot, androidUpdateSnapshot);
  const dismissed = useSyncExternalStore(subscribeAndroidUpdates, androidUpdatePromptDismissed, androidUpdatePromptDismissed);
  // 同 DesktopUpdatePrompt:在 key={theme} 重挂树外面,跟随系统时要自己订阅主题才会重画。
  useSyncExternalStore(onThemeChange, themeMode, themeMode);
  const visible = androidPromptVisible(update, dismissed);
  const view = androidPromptView(update, { currentVersion });
  const notes = 'notes' in update ? update.notes : '';
  const version = 'version' in update ? update.version : undefined;
  const groups = useMemo(() => parseReleaseNotes(notes, { currentVersion, targetVersion: version }), [notes, currentVersion, version]);
  // 启动时读一次「上次成功来源」;顺带静默删掉 0.2.121 遗留的「下载线路」偏好。
  useEffect(() => { void routePrefs.hydrate().catch(() => undefined); }, []);
  const safe = useModalSafePadding('fullScreen');
  if (!view || !('apk' in update)) return null;
  const onPrimary = () => {
    if (!view.primary) return;
    if (view.primary.action === 'install') void installAndroidUpdate();
    else void downloadAndroidUpdate();
  };
  const progress = view.progress;
  const meta = [view.versions.current ? `当前 ${view.versions.current}` : '', view.meta].filter(Boolean).join('  ·  ');

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => { if (update.kind !== 'downloading') dismissAndroidUpdate(); }}>
      <View style={[styles.page, { paddingLeft: safe.paddingLeft, paddingRight: safe.paddingRight }]} testID="android-update-prompt">
        <View style={[styles.topBar, { backgroundColor: heroTopColor(colors.groupedBg), paddingTop: safe.paddingTop }]} testID="android-update-topbar">
          {view.showLater ? (
            <Pressable testID="android-update-later" style={styles.close} onPress={dismissAndroidUpdate} accessibilityRole="button" accessibilityLabel="稍后" hitSlop={8}>
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          ) : <View style={styles.close} />}
        </View>
        <ScrollView style={[styles.scroll, styles.noFocusRing]} contentContainerStyle={styles.scrollContent} testID="android-update-notes">
          <View style={[styles.hero, heroBackground(colors.groupedBg)]} testID="android-update-hero">
            <UpdateBrandMark size={76} />
            <Text style={styles.kicker}>{view.title}</Text>
            <Text style={styles.version} testID="android-update-next">{view.versions.next}</Text>
            {meta ? <Text style={styles.meta} testID="android-update-meta">{meta}</Text> : null}
          </View>
          <View style={styles.notes}>
            <ReleaseNoteGroups groups={groups} surface={colors.groupedRow} testID="android-update-note-groups" />
          </View>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: safe.paddingBottom + spacing.md }]} testID="android-update-footer">
          {update.kind === 'download-error' ? (
            <View style={styles.errorBox} testID="android-update-error">
              <Ionicons name="alert-circle" size={16} color={colors.failed} />
              <View style={styles.errorBody}>
                <Text style={styles.error} testID="android-update-error-title">{view.errorTitle}</Text>
                {view.errorDetail ? <Text style={styles.errorLine}>{view.errorDetail}</Text> : null}
              </View>
            </View>
          ) : null}
          {view.showOpenSettings ? (
            <Text style={styles.hintBlock} testID="android-update-install-hint">{INSTALL_PERMISSION_HINT}</Text>
          ) : null}

          {progress ? (
            <View style={styles.progress} testID="android-update-progress" accessibilityRole="progressbar" accessibilityLabel={view.progressLine}>
              {progress.percent != null ? <View style={[styles.progressFill, { width: `${progress.percent}%` }]} /> : null}
              <View style={styles.progressLabel}>
                {progress.verifying || progress.percent == null ? <ActivityIndicator color={colors.accent} size="small" /> : null}
                <Text style={styles.progressText} numberOfLines={1} testID="android-update-progress-line">
                  {progress.verifying ? '正在校验安装包…' : `正在下载 ${progress.percent != null ? `${progress.percent}%` : ''}`.trim()}
                </Text>
                {!progress.verifying && progress.bytes ? <Text style={styles.progressBytes} numberOfLines={1}>{progress.bytes}</Text> : null}
              </View>
            </View>
          ) : view.primary ? (
            <Pressable testID={`android-update-${view.primary.action}`} style={styles.button} onPress={onPrimary}>
              <Text style={styles.buttonText}>{view.primary.label}</Text>
            </Pressable>
          ) : null}
          {view.showOpenSettings ? (
            <Pressable testID="android-update-open-settings" style={styles.secondary} onPress={() => { void openUnknownSourcesSettings(); }}>
              <Text style={styles.secondaryText}>去设置允许安装</Text>
            </Pressable>
          ) : null}

          <View style={styles.links}>
            <Pressable testID="android-update-browser" onPress={() => { void openApkInBrowser(); }} hitSlop={8}>
              <Text style={styles.link} numberOfLines={1}>在浏览器中下载</Text>
            </Pressable>
            <Text style={styles.linkSep}>·</Text>
            <View style={styles.trust} testID="android-update-trust">
              <Ionicons name="shield-checkmark-outline" size={12} color={colors.textMuted} />
              <Text style={styles.trustText} numberOfLines={1}>安全校验</Text>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = () =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.groupedBg },
    // 顶栏和头部同一片渐变,✕ 左上角(微信全屏页)。
    topBar: { paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center' },
    // web 夹具里 Modal 打开会把焦点给 ✕,浏览器画一圈方框 —— 截图里像个坏掉的按钮;原生没有这圈。
    close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) },
    scroll: { flex: 1 },
    noFocusRing: (Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) as object,
    scrollContent: { paddingBottom: spacing.lg },
    hero: { alignItems: 'center', paddingTop: spacing.sm, paddingBottom: 28, paddingHorizontal: 16 },
    kicker: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: spacing.lg },
    version: { color: colors.text, fontSize: 34, lineHeight: 42, fontWeight: '600', letterSpacing: 0.5 },
    meta: { color: colors.textMuted, fontSize: 13, lineHeight: 18, marginTop: spacing.xs },
    notes: { paddingHorizontal: 16 },
    footer: { paddingHorizontal: 16, paddingTop: spacing.md, backgroundColor: colors.groupedRow, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    errorBox: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', padding: spacing.md, marginBottom: spacing.md, borderRadius: radius.control, backgroundColor: tint(colors.failed, 0.1) },
    errorBody: { flex: 1 },
    error: { color: colors.failed, fontSize: 14, lineHeight: 20, fontWeight: '600' },
    errorLine: { color: colors.failed, fontSize: 12, lineHeight: 18, marginTop: 2 },
    hintBlock: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginBottom: spacing.md },
    // 主按钮和进度条同一个位置、同一个尺寸:点下去按钮原地变成进度条,不跳。
    button: { ...buttonStyle('primary'), height: 48, borderRadius: radius.control },
    buttonText: { ...buttonTextStyle('primary'), fontSize: 16 },
    progress: { height: 48, borderRadius: radius.control, backgroundColor: colors.tonalBg, overflow: 'hidden', justifyContent: 'center' },
    progressFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: tint(colors.accent, themeMode() === 'dark' ? 0.34 : 0.22) },
    progressLabel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
    progressText: { color: colors.accent, fontSize: 16, fontWeight: '600' },
    progressBytes: { color: colors.textSecondary, fontSize: 13 },
    secondary: { ...buttonStyle('secondary'), height: 44, marginTop: spacing.sm },
    secondaryText: { ...buttonTextStyle('secondary') },
    links: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.md },
    link: { color: colors.accent, fontSize: 13, lineHeight: 18 },
    linkSep: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
    trust: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    trustText: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  });

// 模块级 StyleSheet 必须随主题重建(theme-restyle-coverage.test.ts)。
let styles = makeStyles();
onThemeChange(() => {
  styles = makeStyles();
});
