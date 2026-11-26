// 手机整窗渐变是否生效（决定各屏根容器敢不敢把底色让出来）。
//
// 原生（安卓/iOS）与鸿蒙 ArkWeb 壳：WindowGlowRoot 会铺 MobileWindowGlow，屏内根容器必须透明，光才看得见。
// 普通 web / 桌面：仍走原来的 CSS 渐变（桌面观感不动）；`?glowSim=native` 只是给截图/回归用。
import { Platform } from 'react-native';
import { isHarmonyShell } from './harmony-bridge';

export function mobileGlowActive(): boolean {
  if (Platform.OS !== 'web' || isHarmonyShell()) return true;
  try { return new URLSearchParams((globalThis as any).location?.search ?? '').get('glowSim') === 'native'; } catch { return false; }
}
