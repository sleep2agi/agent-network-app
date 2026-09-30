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

// ── 分离聊天窗:页头就是标题栏(Vincent 2026-09-30「上面那个还是挺多余的」)────────────────
// Windows 上分离聊天窗原来是原生标题栏「<agent> · admin · Agent Network」,紧下面页头又是一遍
// 名字 + 在线状态。照微信的独立聊天窗:不要原生标题栏,页头那一行(头像/名字/状态/⋯)就是标题栏 ——
//   · Windows:decorations=false(阴影 + 边缘缩放由 Tauri 的 undecorated_resizing 负责,
//     shadow 要开着),右上角画 – □ ×(46×32,关闭悬停红底);页头右侧让出这三颗按钮的宽度。
//   · macOS:保持 decorations=true + Overlay 标题栏(红黄绿灯是系统的),不再画 28px 空带,
//     红黄绿灯挪进页头那一行垂直居中,页头左侧让出它们的宽度。
//   · 两边页头都标 data-tauri-drag-region="deep":空白处拖动、双击最大化,里面的按钮照常可点
//     (Tauri drag.js 遇到 role=button / tabindex 的元素就不拖)。
// 窗口标题(openChatWindow 的 title)照旧以 agent 名开头 —— 任务栏、Alt-Tab、调度中心靠它。
// 只动分离聊天窗;主窗、设置窗、工作区窗、任务窗、看图窗不变。

/** 分离聊天窗的 label 前缀(desktop-chat-menu.ts chatWindowLabel)。 */
export const CHAT_POPOUT_LABEL_PREFIX = 'chat-';

export const isChatPopoutLabel = (label: string | null): boolean =>
  typeof label === 'string' && label.startsWith(CHAT_POPOUT_LABEL_PREFIX);

/** 分离聊天窗创建时的 decorations:Windows 关掉原生标题栏,其余(macOS 要红黄绿灯)开着。 */
export const chatPopoutDecorations = (platform: ShellPlatform | null): boolean => platform !== 'windows';

/** Windows 窗口控件:三颗 46×32。 */
export const WINDOW_CONTROL_WIDTH = 46;
export const POPOUT_WINDOW_CONTROLS_WIDTH = WINDOW_CONTROL_WIDTH * 3;

/** macOS 红黄绿灯在分离聊天窗里的位置(左 16 = 页头左内边距;y 让三颗灯和头像行垂直居中)。 */
export const POPOUT_TRAFFIC_LIGHT_X = 16;
export const POPOUT_TRAFFIC_LIGHT_Y = 22;
/** 页头左侧让给红黄绿灯的宽度:16 + 三颗灯约 52 + 12 间距。 */
export const POPOUT_TRAFFIC_LIGHT_INSET = 80;

/** 这个窗口的页头要不要兼当标题栏;要的话按哪个系统画。只在 Tauri 壳里的分离聊天窗成立。 */
export type PopoutChrome = 'windows' | 'mac' | null;
export const popoutChatChrome = (platformOS: string = 'web', label: string | null = currentWindowLabel()): PopoutChrome => {
  if (!isChatPopoutLabel(label)) return null;
  const platform = tauriShellPlatform(platformOS);
  if (platform === 'windows') return 'windows';
  if (platform === 'mac') return 'mac';
  return null;
};

/** 页头右侧 – □ × 和 ⋯ 之间留的空。 */
export const POPOUT_CONTROLS_GAP = 8;

/**
 * 兼当标题栏的页头左右内边距(整值,已含页头原本的内边距 `base`):
 * macOS 左边让红黄绿灯,Windows 右边让 – □ ×。不是分离聊天窗(chrome=null)就原样返回 base。
 */
export const popoutHeaderPadding = (chrome: PopoutChrome, base: number): { left: number; right: number } => ({
  left: chrome === 'mac' ? Math.max(base, POPOUT_TRAFFIC_LIGHT_INSET) : base,
  right: chrome === 'windows' ? POPOUT_WINDOW_CONTROLS_WIDTH + POPOUT_CONTROLS_GAP : base,
});

/**
 * 兼当标题栏的页头要挂的属性:整行拖动(deep = 子元素空白处也算,按钮除外)+ 让位内边距。
 * 不是分离聊天窗返回空对象,调用方照常渲染 —— 主窗 / 手机上的同一个页头一个字节都不变。
 */
export const popoutHeaderChrome = (chrome: PopoutChrome, base: number): { dataSet?: { tauriDragRegion: 'deep' }; style?: { paddingLeft: number; paddingRight: number } } => {
  if (!chrome) return {};
  const pad = popoutHeaderPadding(chrome, base);
  return { dataSet: { tauriDragRegion: 'deep' }, style: { paddingLeft: pad.left, paddingRight: pad.right } };
};
