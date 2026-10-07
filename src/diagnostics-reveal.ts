// 看板 #695 —— 「连接复用」开关从 设置 → 关于 拿掉(普通用户不需要看到它),但出问题时不用发版就能
// 退回插件的后路还要在:连点「版本」行 5 下,关于页底下出现「诊断」一组,里面是同一个开关。
//   - 默认开着(app-fetch.ts pooledHttpEnabled:没存过 = 开);
//   - 以前关过的人**不重置**:存的还是 anet.pooledHttp.off=1,这里只换入口,不碰存储;
//   - 揭开只在本次打开设置页内有效(不落盘),关掉设置再进来又藏起来。
// 纯逻辑,不 import react-native。
import type { SettingsPlatform } from './settings-model';

export const DIAGNOSTICS_TAPS = 5;
/** 两下之间隔太久就重新数(防止平时偶尔点到版本行,累计起来误开)。 */
export const DIAGNOSTICS_TAP_GAP_MS = 2000;

export type VersionTaps = { readonly count: number; readonly lastAt: number; readonly revealed: boolean };
export const VERSION_TAPS_INITIAL: VersionTaps = { count: 0, lastAt: 0, revealed: false };

/** 点一下「版本」行。已揭开就保持揭开。 */
export function tapVersion(prev: VersionTaps, now: number): VersionTaps {
  if (prev.revealed) return prev;
  const count = prev.count > 0 && now - prev.lastAt <= DIAGNOSTICS_TAP_GAP_MS ? prev.count + 1 : 1;
  return { count, lastAt: now, revealed: count >= DIAGNOSTICS_TAPS };
}

/** 「诊断」组里的「连接复用」:揭开了、且在桌面壳里(只有 Tauri 走 pooled_fetch;手机 / 网页没有这条路)。 */
export function showPooledHttpDiagnostics(revealed: boolean, platform: SettingsPlatform | undefined): boolean {
  return revealed && platform === 'desktop';
}
