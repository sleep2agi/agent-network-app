// 全局样式表 —— 从 App.tsx 抽出(#App 节点列表单)。
//
// 🔴 为什么单独成文件而不是让 AgentsScreen 自己复制一份:
// `styles` 是 **let 变量**,`onThemeChange` 时整体重新赋值(见文件末尾)。
// 复制一份到别的模块 = 那一份永远停留在首次主题上,切主题后样式不跟着变,
// 而且"图能显示、只是颜色不对",单看那个屏幕根本看不出来。
// 这里 `export let styles` 依赖 ES module 的 live binding:重新赋值后
// 所有 import 方拿到的都是新对象。改动这里前先确认这一点仍成立。

import { Platform, StatusBar, StyleSheet } from 'react-native';
import { colors, onThemeChange, spacing } from './theme';

const makeStyles = () =>
  StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    // RN's SafeAreaView is iOS-only; Android edge-to-edge draws content
    // under the status bar (Vincent tg 729: clock overlapped the chat
    // header). Pad the root by the real status-bar height instead.
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  errorTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  errorHint: { color: colors.textMuted, fontSize: 13 },
  retryBtn: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.md,
  },
  retryBtnText: { color: colors.bg, fontSize: 15, fontWeight: '700' },
  loginWrap: { flex: 1, justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  brand: { color: colors.text, fontSize: 28, fontWeight: '700', textAlign: 'center' },
  brandSub: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  input: {
    backgroundColor: colors.inputBg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    color: colors.text,
    fontSize: 15,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: spacing.md + 2,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonText: { color: colors.bg, fontSize: 16, fontWeight: '700' },
  error: { color: colors.failed, fontSize: 13 },
  version: { color: colors.textMuted, fontSize: 11, textAlign: 'center', marginTop: spacing.md },
  listHeader: { color: colors.textMuted, fontSize: 12 },
  listHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  // #338 — `+` button in agents list header
  addBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.bg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  sectionHeader: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  sectionCount: { color: colors.textMuted, fontSize: 11 },
  logout: { color: colors.textMuted, fontSize: 12 },
  search: {
    backgroundColor: colors.inputBg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: 14,
    marginBottom: spacing.md,
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, gap: 2 },
  tabLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '500' },
  tabActive: { color: colors.accent, fontWeight: '600' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.lg,
    marginBottom: spacing.sm,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  // 下线的灰色调，别都亮着 (Vincent tg 753)
  cardOffline: { opacity: 0.45 },
  avatarWrap: { position: 'relative' },
  statusDot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 11,
    height: 11,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.card, // 描边环:让圆点从头像上"浮"出来(微信式)
  },
  statusDotOffline: { opacity: 0.5 },
  alias: { color: colors.text, fontSize: 15, fontWeight: '600' },
  task: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  status: { color: colors.textMuted, fontSize: 11 },
});

export let styles = makeStyles();
onThemeChange(() => {
  styles = makeStyles();
});
