// 聊天右侧边栏(ChatToolRail)停靠时,聊天页要让出的右侧宽度。
// 图标条常驻 CHAT_TOOL_RAIL_WIDTH;面板展开时再加面板宽度。纯函数,便于测试。
import { WINDOWS_TITLE_BAR_HEIGHT, type PopoutChrome } from './window-shell';

export const CHAT_TOOL_RAIL_WIDTH = 44;

/**
 * Windows 分离聊天窗右上角浮着 – □ ×（PopoutWindowControls，高度 WINDOWS_TITLE_BAR_HEIGHT = 32px）。
 * 右侧图标条与展开面板必须从 32px 下方开始，避免关闭按钮 × 直接叠在首个「任务」图标上，
 * 也避免工具条左边框把 □ 和 × 从中间切开（admin 2026-11-24 截图）。
 */
export function chatToolRailTopInset(chrome: PopoutChrome): number {
  return chrome === 'windows' ? WINDOWS_TITLE_BAR_HEIGHT : 0;
}

/**
 * Windows 分离聊天窗中，页头需让出右上角 – □ ×（146px）且外层已让出右侧工具条（44px），
 * 原页头右上角 ⋯ 会悬在距右边缘 190px 的半空显得突兀（admin 2026-11-25 截图）。
 * 当右侧工具条可见时，将 ⋯ 移到工具条顶部（× 正下方），页头保持整洁拖动区。
 */
export function chatMoreInToolRail(chrome: PopoutChrome, showToolRail: boolean): boolean {
  return chrome === 'windows' && showToolRail;
}
/** 聊天区最少留这么宽;窗口太窄时面板不展开占位(只留图标条),避免把聊天挤没。
 *  2026-11-19 admin「右下角你觉得丑吗」:420 太保守,1000 宽左右的窗口面板就浮起来盖住输入框和发送。
 *  改成 340,并让面板自己收窄到 PANEL_MIN_WIDTH 再放弃停靠。 */
export const CHAT_MIN_WIDTH_WITH_PANEL = 340;
export const PANEL_MIN_WIDTH = 260;

/** 停靠时面板的实际宽度:优先用户拖出来的宽度,放不下就收窄;收到 PANEL_MIN_WIDTH 还放不下就返回 null(改为浮层)。 */
export function dockedPanelWidth(desired: number, outerWidth: number): number | null {
  if (outerWidth <= 0) return desired;
  const room = outerWidth - CHAT_TOOL_RAIL_WIDTH - CHAT_MIN_WIDTH_WITH_PANEL;
  const w = Math.min(desired, room);
  return w >= PANEL_MIN_WIDTH ? w : null;
}

export function chatToolRailReserve(open: boolean, panelWidth: number, outerWidth: number): number {
  if (!open) return CHAT_TOOL_RAIL_WIDTH;
  const w = dockedPanelWidth(panelWidth, outerWidth);
  return w === null ? CHAT_TOOL_RAIL_WIDTH : CHAT_TOOL_RAIL_WIDTH + w;
}

/** 桌面输入框工具条的「Enter 发送 · Shift/Ctrl+Enter 换行」提示:聊天区窄于这个宽度就不画(0 = 还没量到,照常画)。 */
export const COMPOSER_HINT_MIN_WIDTH = 640;
export function composerShowsShortcutHint(paneWidth: number): boolean {
  return paneWidth === 0 || paneWidth >= COMPOSER_HINT_MIN_WIDTH;
}
