// 手机整窗渐变是否生效（决定各屏根容器敢不敢把底色让出来）。
//
// 原生（安卓/iOS）：WindowGlowRoot 会铺 MobileWindowGlow，屏内根容器必须透明，光才看得见。
// web：仍走原来的 CSS 渐变（桌面观感不动）；`?glowSim=native` 只是给截图/回归用。
import { Platform } from 'react-native';

export function mobileGlowActive(): boolean {
  if (Platform.OS !== 'web') return true;
  try { return new URLSearchParams((globalThis as any).location?.search ?? '').get('glowSim') === 'native'; } catch { return false; }
}
