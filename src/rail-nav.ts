/**
 * 桌面左侧导航栏(rail)的纯逻辑:图标/表面态/角标文案。
 * 不 import react-native,便于 ck 测试直接跑。
 */
export type RailSurface = 'active' | 'hover' | 'idle';

export interface RailTabLike {
  key: string;
  icon: string;
  iconActive: string;
}

/** 激活态用实心图标,否则用描边图标(与既有 DESKTOP_TABS 的 icon/iconActive 约定一致)。 */
export const railIconFor = (tab: RailTabLike, activeKey: string): string =>
  tab.key === activeKey ? tab.iconActive : tab.icon;

/** 激活优先于悬停/聚焦;悬停与键盘聚焦共用同一层淡色。 */
export const railSurface = (state: { active: boolean; hovered?: boolean; focused?: boolean; pressed?: boolean }): RailSurface => {
  if (state.active) return 'active';
  if (state.hovered || state.focused || state.pressed) return 'hover';
  return 'idle';
};

/** 图标右上角的小圆标:0/负数/非数不显示,超过 99 显示 99+。 */
export const railBadgeText = (count: number | null | undefined): string | null => {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? '99+' : String(Math.floor(count));
};

/** 悬停提示只在桌面/网页壳显示(触屏没有悬停)。 */
export const railTooltipVisible = (hoveredKey: string | null, tabKey: string, desktop: boolean): boolean =>
  desktop && hoveredKey !== null && hoveredKey === tabKey;
