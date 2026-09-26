import { useSyncExternalStore } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './ui-text';
import { androidPromptVisible, INSTALL_PERMISSION_HINT } from './android-update-core';
import {
  androidPreferredRoute,
  androidUpdatePromptDismissed,
  androidUpdateSnapshot,
  chooseAndroidUpdateRoute,
  dismissAndroidUpdate,
  downloadAndroidUpdate,
  installAndroidUpdate,
  openApkInBrowser,
  openUnknownSourcesSettings,
  subscribeAndroidUpdates,
} from './android-updater';
import { latestReleaseNotes } from './desktop-updater';
import { androidPromptView } from './update-prompt-model';
import { UPDATE_ROUTES, ROUTE_SHORT, type UpdateRoute } from './update-route';
import { colors, onThemeChange, spacing, themeMode } from './theme';
import { APP_VERSION } from './version';

/** 分段按钮第二行:线路是什么。 */
const ROUTE_SUB: Record<UpdateRoute, string> = { mirror: '国内 · ModelScope · 推荐', github: 'GitHub' };

/**
 * 安卓更新弹窗。只在用户点了「软件更新」之后出现(安卓不做启动时自动检查)。
 * 当前版本 → 新版本 + 本版说明 → 选下载线路(线路一 ModelScope 默认 / 线路二 GitHub,另一条自动兜底)
 * → 下载(线路、大小、进度)→ sha256 → 系统安装器;「在浏览器中下载」两条线路各一个带版本号的直链。
 * 文案全部来自 update-prompt-model.ts(有测试),这里只摆放。
 */
export default function AndroidUpdatePrompt({ currentVersion = APP_VERSION }: { currentVersion?: string } = {}) {
  const update = useSyncExternalStore(subscribeAndroidUpdates, androidUpdateSnapshot, androidUpdateSnapshot);
  const dismissed = useSyncExternalStore(subscribeAndroidUpdates, androidUpdatePromptDismissed, androidUpdatePromptDismissed);
  const route = useSyncExternalStore(subscribeAndroidUpdates, androidPreferredRoute, androidPreferredRoute);
  // 同 DesktopUpdatePrompt:在 key={theme} 重挂树外面,跟随系统时要自己订阅主题才会重画。
  useSyncExternalStore(onThemeChange, themeMode, themeMode);
  const visible = androidPromptVisible(update, dismissed);
  const view = androidPromptView(update, { currentVersion, route });
  if (!view || !('apk' in update)) return null;
  const onPrimary = () => {
    if (!view.primary) return;
    if (view.primary.action === 'install') void installAndroidUpdate();
    else void downloadAndroidUpdate();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => { if (update.kind !== 'downloading') dismissAndroidUpdate(); }}>
      <View style={styles.backdrop}>
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

            <Text style={styles.sectionLabel}>下载线路</Text>
            <View style={styles.segmented} accessibilityRole="radiogroup" accessibilityLabel="下载线路" testID="android-update-routes">
              {UPDATE_ROUTES.map(r => {
                const selected = (update.kind === 'downloading' && update.route ? update.route : route) === r;
                return (
                  <Pressable
                    key={r}
                    testID={`android-update-route-${r}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, checked: selected, disabled: !view.routePickerEnabled }}
                    disabled={!view.routePickerEnabled}
                    onPress={() => chooseAndroidUpdateRoute(r)}
                    style={({ pressed }) => [styles.segment, selected && styles.segmentSelected, pressed && !selected && { opacity: 0.6 }, !view.routePickerEnabled && !selected && { opacity: 0.45 }]}
                  >
                    <Text style={[styles.segmentText, selected && styles.segmentTextSelected]} numberOfLines={1}>{ROUTE_SHORT[r]}</Text>
                    <Text style={[styles.segmentSub, selected && styles.segmentSubSelected]} numberOfLines={1}>{ROUTE_SUB[r]}</Text>
                  </Pressable>
                );
              })}
            </View>

            {view.fallbackNotice ? <Text style={styles.warn} testID="android-update-fallback">{view.fallbackNotice}</Text> : null}

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
                <Text style={styles.error}>{view.errorTitle}</Text>
                {view.attemptLines.map(line => <Text key={line} style={styles.errorLine}>{line}</Text>)}
                <Text style={styles.hintBlock}>可以换一条线路重试,或在浏览器中下载后手动安装。</Text>
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

            <Text style={styles.sectionLabel}>在浏览器中下载</Text>
            <View style={styles.browserRow} testID="android-update-browser">
              {UPDATE_ROUTES.map(r => (
                <Pressable key={r} testID={`android-update-browser-${r}`} style={styles.browserButton} onPress={() => { void openApkInBrowser(r); }}>
                  <Text style={styles.browserText} numberOfLines={1}>{ROUTE_SHORT[r]} · {r === 'mirror' ? 'ModelScope' : 'GitHub'}</Text>
                </Pressable>
              ))}
            </View>

            {view.showLater ? (
              <Pressable testID="android-update-later" style={styles.later} onPress={dismissAndroidUpdate}>
                <Text style={styles.laterText}>稍后</Text>
              </Pressable>
            ) : null}
            <Text style={styles.hint}>
              两条线路的安装包逐字节相同;选中的线路失败会自动改用另一条。下载后先校验 sha256,再交给安卓系统安装器,不会静默安装。
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
    segmented: { flexDirection: 'row', padding: 2, borderRadius: 10, backgroundColor: colors.subtleFill, borderWidth: 1, borderColor: colors.border },
    segment: { flex: 1, flexBasis: 0, alignItems: 'center', justifyContent: 'center', paddingVertical: 7, paddingHorizontal: 6, borderRadius: 8, borderWidth: 1, borderColor: 'transparent' },
    segmentSelected: { backgroundColor: colors.card, borderColor: colors.accent },
    segmentText: { color: colors.textSecondary, fontSize: 14, fontWeight: '500' },
    segmentTextSelected: { color: colors.accent, fontWeight: '600' },
    segmentSub: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
    segmentSubSelected: { color: colors.textSecondary },
    warn: { color: colors.accent, fontSize: 12, lineHeight: 18, marginTop: spacing.sm },
    progressBlock: { marginTop: spacing.md },
    progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    progressText: { color: colors.textSecondary, fontSize: 13, flexShrink: 1 },
    bar: { height: 6, borderRadius: 3, backgroundColor: colors.border, marginTop: spacing.sm, overflow: 'hidden' },
    barFill: { height: 6, backgroundColor: colors.accent },
    error: { color: colors.failed, fontSize: 13, lineHeight: 19, marginTop: spacing.md },
    errorLine: { color: colors.failed, fontSize: 12, lineHeight: 18 },
    hintBlock: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: spacing.sm },
    // 主按钮 / 次按钮 / 稍后 同宽(撑满卡片内容宽)、同一条中线;浏览器两个按钮 flex:1 等宽、同一行。
    button: { marginTop: spacing.lg, height: 44, backgroundColor: colors.accent, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
    secondary: { marginTop: spacing.sm, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.accent },
    secondaryText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
    browserRow: { flexDirection: 'row', gap: spacing.sm },
    browserButton: { flex: 1, flexBasis: 0, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, paddingHorizontal: 6 },
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
