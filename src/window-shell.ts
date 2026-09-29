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

// ── 每个窗口只能有一套窗口控件(Vincent 2026-09-29「怎么有两个×」)──────────────────────────
// Windows 上「原生标题栏关掉、改画 WinTitleBar」只对 tauri.conf.json 里那个主窗成立:
// lib.rs 的 setup 在启动那一刻对当时已存在的窗口 set_decorations(false),而那时只有主窗。
// 运行时由前端 WebviewWindow 构造开的设置窗 / 分离聊天窗 / 工作区窗 / 看图窗都是
// decorations: true(原生标题栏自带 – □ ×);0.2.145 以前 App 在这些窗里照样挂 WinTitleBar,
// 设置窗于是叠出两排 – □ ×。规则:只有主窗画自绘标题栏,其余窗口一律交给系统标题栏。
// 新开一种窗口时,在 src/window-chrome.test.ts 的清单里登记它的 decorations。

/** 唯一一个 decorations=false(Windows)、自己画标题栏的窗口:tauri.conf.json 的默认窗口。 */
export const CUSTOM_TITLE_BAR_WINDOW_LABEL = 'main';

/** 当前 webview 所在窗口的 label(Tauri v2 在页面加载前注入)。不在壳里或拿不到时为 null。 */
export const currentWindowLabel = (): string | null => {
  const internals = (globalThis as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: unknown } } } }).__TAURI_INTERNALS__;
  const label = internals?.metadata?.currentWindow?.label;
  return typeof label === 'string' && label ? label : null;
};

/**
 * 这个窗口要不要画自绘标题栏 / 窗口控件。只有主窗要;拿不到 label(真壳里不会发生)按主窗处理,
 * 免得主窗丢掉唯一的关闭按钮。
 */
export const windowDrawsOwnTitleBar = (label: string | null = currentWindowLabel()): boolean =>
  label === null || label === CUSTOM_TITLE_BAR_WINDOW_LABEL;
