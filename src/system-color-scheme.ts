// 平台接线:把 system-color-scheme-core 接到真实的 RN Appearance / 浏览器 matchMedia,
// 再喂给 theme.ts 的 setSystemColorScheme。App 在首帧前调一次 installSystemThemeFollower()。
import { Appearance, Platform } from 'react-native';
import { readScheme, subscribeScheme, type SchemeEnv } from './system-color-scheme-core';
import { setSystemColorScheme } from './theme';

const env = (): SchemeEnv => ({
  os: Platform.OS,
  matchMedia: typeof (globalThis as any).matchMedia === 'function'
    ? (q: string) => (globalThis as any).matchMedia(q)
    : null,
  appearance: Appearance,
});

let installed = false;

/**
 * 同步读一次系统配色(首帧就用对),并订阅之后的变化(app 开着时系统切换立刻跟上)。
 * 幂等:主窗口、托盘面板、分离聊天窗各自一个 JS 上下文,各装一次;同一上下文重复调用无副作用。
 * 订阅跟 app 同寿命,不退订。
 */
export function installSystemThemeFollower(): void {
  if (installed) return;
  installed = true;
  const e = env();
  setSystemColorScheme(readScheme(e));
  subscribeScheme(e, s => setSystemColorScheme(s));
}
