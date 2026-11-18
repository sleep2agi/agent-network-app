// 聊天右侧边栏(ChatToolRail)停靠时,聊天页要让出的右侧宽度。
// 图标条常驻 CHAT_TOOL_RAIL_WIDTH;面板展开时再加面板宽度。纯函数,便于测试。
export const CHAT_TOOL_RAIL_WIDTH = 44;
/** 聊天区最少留这么宽;窗口太窄时面板不展开占位(只留图标条),避免把聊天挤没。 */
export const CHAT_MIN_WIDTH_WITH_PANEL = 420;

export function chatToolRailReserve(open: boolean, panelWidth: number, outerWidth: number): number {
  if (!open) return CHAT_TOOL_RAIL_WIDTH;
  const withPanel = CHAT_TOOL_RAIL_WIDTH + panelWidth;
  if (outerWidth > 0 && outerWidth - withPanel < CHAT_MIN_WIDTH_WITH_PANEL) return CHAT_TOOL_RAIL_WIDTH;
  return withPanel;
}

/** 桌面输入框工具条的「Enter 发送 · Shift/Ctrl+Enter 换行」提示:聊天区窄于这个宽度就不画(0 = 还没量到,照常画)。 */
export const COMPOSER_HINT_MIN_WIDTH = 640;
export function composerShowsShortcutHint(paneWidth: number): boolean {
  return paneWidth === 0 || paneWidth >= COMPOSER_HINT_MIN_WIDTH;
}
