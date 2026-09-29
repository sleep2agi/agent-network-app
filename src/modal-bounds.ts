// 弹窗规则(DialogFrame.tsx)里锚点弹层的那一半:从锚点往下展开的菜单,高度不能超过「锚点到窗口底」。
// 纯函数,不 import react-native。

/**
 * 锚点弹层(筛选菜单等)的 maxHeight:最多 cap,且不超过从弹层顶到窗口底(减底部安全区与 8px 边)。
 * 弹层里会长的列表是能收缩的 ScrollView,底部按钮行因此总在窗口里。下限 120 —— 锚点贴着窗口底时
 * 至少还放得下按钮行加两三行选项。
 */
export function menuMaxHeight(anchorY: number, windowHeight: number, safeTop: number, safeBottom: number, cap = 360): number {
  const top = Math.max(anchorY, safeTop + 8);
  return Math.max(120, Math.min(cap, windowHeight - safeBottom - 8 - top));
}
