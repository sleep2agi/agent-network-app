// 浮起的面 + 按钮 —— theme.ts 里 ELEVATION / CONTROL_HEIGHT 的平台落地(theme.ts 保持纯数据,
// 不 import react-native,测试直接读它)。
//
// 用法:在 makeStyles() 里展开,放在该面自己的 backgroundColor / border 之后:
//   menu: { borderRadius: radius.control, backgroundColor: colors.card, ...elevated('floating') }
// makeStyles 随主题重建(onThemeChange),所以这里按**当前**主题取值即可。
import { Platform } from 'react-native';
import { colors, CONTROL_HEIGHT, CONTROL_PAD_X, ELEVATION, radius, themeMode, type ElevationLevel } from './theme';

const isDesktopShell = (): boolean =>
  Platform.OS === 'web'
  && !!(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  && !/Android|iPhone|iPad/i.test(String((globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent ?? ''));

/**
 * 浅色:淡阴影,边框透明(宽度保留 1 —— 深浅两套尺寸一致,切主题内容不挪)。
 * 深色:阴影看不见,换成亮一档的面 + 细边。
 * 原生 Android 只认 elevation;iOS 认 shadow*;web 用 boxShadow(RNW 对 shadow* 会告警)。
 * edge:贴着窗口边的面只在露出来的那一边画边 —— 底部面板 'top',右侧抽屉 'left'。
 */
export function elevated(level: ElevationLevel = 'floating', edge: 'all' | 'top' | 'left' = 'all'): Record<string, unknown> {
  const e = ELEVATION[level];
  const c = colors.floatingBorder;
  const border = edge === 'top' ? { borderTopWidth: 1, borderTopColor: c }
    : edge === 'left' ? { borderLeftWidth: 1, borderLeftColor: c }
    : { borderWidth: 1, borderColor: c };
  if (themeMode() === 'dark') return { ...border, ...(level === 'floating' ? { backgroundColor: colors.floatingBg } : null) };
  if (Platform.OS === 'web') return { ...border, boxShadow: e.web };
  return { ...border, shadowColor: '#101828', shadowOpacity: e.opacity, shadowRadius: e.blur, shadowOffset: { width: 0, height: e.y }, elevation: e.android };
}

/** 按钮高度:手机 40、桌面壳 36(与 #424 输入栏控件同高)。 */
export const controlHeight = (): number => (isDesktopShell() ? CONTROL_HEIGHT.desktop : CONTROL_HEIGHT.phone);

/**
 * 全 app 两种按钮。primary = 强调色实底 + onAccent 字;secondary = tonal 浅底 + 强调色字。
 * 只管外形(高、圆角、内边距、底色);外边距由调用处给。
 */
export function buttonStyle(kind: 'primary' | 'secondary'): Record<string, unknown> {
  return {
    height: controlHeight(),
    paddingHorizontal: CONTROL_PAD_X,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: kind === 'primary' ? colors.accent : colors.tonalBg,
  };
}

export const buttonTextStyle = (kind: 'primary' | 'secondary'): Record<string, unknown> => ({
  color: kind === 'primary' ? colors.onAccent : colors.accent,
  fontSize: 14,
  fontWeight: '600',
});
