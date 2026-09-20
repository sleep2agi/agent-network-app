// 桌面壳的「哪个平台」判定，一处说了算。
//
// 0.2.70 给 macOS 去掉了原生标题栏(titleBarStyle=Overlay + hiddenTitle)，留一条 28px 空带
// 给红黄绿灯；0.2.81(Vincent 2026-09-20:「这个地方在 Windows 上也很难看」)给 Windows
// 也换成自绘标题栏。两边需要的是同一个问题的答案——「我现在是不是跑在 Tauri 壳里、什么系统」
// ——所以判定放这里，mac-shell.ts 保留旧导出转发过来，两份实现不并存。
//
// 纯逻辑、不 import react-native：测试可以直接引。

export const MAC_TITLE_STRIP_HEIGHT = 28;

/** Windows 自绘标题栏高度。32px 是 Win10/11 原生标题栏的视觉高度，控件按钮 46×32。 */
export const WINDOWS_TITLE_BAR_HEIGHT = 32;

export type ShellPlatform = 'mac' | 'windows' | 'other';

/** Tauri 桌面壳里跑着吗。网页/移动端为 false。 */
export const isTauriShell = (): boolean =>
  !!(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

/**
 * 壳所在的操作系统。不在 Tauri 壳里(网页、iOS、Android)一律 null。
 *
 * platformOS 是 react-native 的 Platform.OS：桌面壳走的是 web 渲染，所以只有 'web'
 * 才可能是桌面壳；调用方传进来，本模块因此不依赖 react-native。
 */
export const tauriShellPlatform = (platformOS: string = 'web'): ShellPlatform | null => {
  if (platformOS !== 'web') return null;
  if (!isTauriShell()) return null;
  const g = globalThis as { navigator?: { platform?: string; userAgent?: string } };
  const hint = `${g.navigator?.platform ?? ''} ${g.navigator?.userAgent ?? ''}`;
  if (/Mac/i.test(hint)) return 'mac';
  if (/Win/i.test(hint)) return 'windows';
  return 'other';
};

export const isMacTauriShell = (platformOS: string = 'web'): boolean =>
  tauriShellPlatform(platformOS) === 'mac';

export const isWindowsTauriShell = (platformOS: string = 'web'): boolean =>
  tauriShellPlatform(platformOS) === 'windows';
