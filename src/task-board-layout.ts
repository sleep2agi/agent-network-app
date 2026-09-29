// 手机看板的宽度模型(纯函数,不 import react-native —— task-board-layout.test.ts 直接引)。
//
// Owner 2026-09-29 安卓真机(0.2.143):任务 → 看板只剩左边三条约 10px 的竖条。web 导出量出来 330 一列一屏,
// 真机却塌成 0 —— 原来的列样式是 `s.column`(flex: 1, flexBasis: 0)再叠 `{ flexGrow: 0, flexShrink: 0,
// flexBasis: 'auto', width }`。react-native-web 把 flex 展开成三个 CSS 属性,后面的覆盖前面的,宽度生效;
// 原生 Yoga 的 `flex` 是独立字段,flexBasis 为 auto 且 flex > 0 时基准取 0,width 被忽略,列只剩边框 4px。
// (yoga-layout 实测:列 [4,4,4]、内容容器 32 —— 连横向滚动范围也没了。)
//
// 所以手机看板里:页宽、列宽全用这里算出的数值,横向 ScrollView 里的页/列不写 flex / flexBasis / 百分比宽。
/** 内容区窄于这个宽度:看板改成横向一列一屏,详情改成推入页。 */
export const NARROW = 700;
/** 手机上一列的最窄宽度(dp)—— 再窄卡片上的负责人名字、期限胶囊就挤不下了。 */
export const MIN_PHONE_COLUMN = 240;
/** 容器宽和窗口宽都拿不到时的兜底(常见手机竖屏宽)。 */
export const FALLBACK_WIDTH = 390;

export type BoardLayout =
  | { mode: 'paged'; width: number; pageWidth: number; columnWidth: number; gutter: number }
  | { mode: 'columns'; width: number };

const usable = (n: number | undefined | null): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * 看板实际可用的宽:board 容器 onLayout 量到的宽;第一帧(原生上 onLayout 之前是 0)或量不到时
 * 退到窗口宽(useWindowDimensions,旋转 / 折叠屏展开会变),再不行用 390。
 */
export function boardWidth(containerWidth: number | undefined | null, windowWidth: number | undefined | null): number {
  if (usable(containerWidth)) return containerWidth;
  if (usable(windowWidth)) return windowWidth;
  return FALLBACK_WIDTH;
}

/**
 * 手机(< NARROW):一列一屏的分页 —— pageWidth = 整个宽,columnWidth = pageWidth − 两侧 gutter,
 * 且不小于 MIN_PHONE_COLUMN(超窄屏宁可露出一点边也不挤卡片)。折叠屏 / 平板 / 桌面:三列等分。
 */
export function boardLayout(containerWidth: number | undefined | null, windowWidth: number | undefined | null, gutter: number): BoardLayout {
  const width = boardWidth(containerWidth, windowWidth);
  if (width >= NARROW) return { mode: 'columns', width };
  const pageWidth = Math.max(MIN_PHONE_COLUMN, Math.round(width));
  const columnWidth = Math.max(MIN_PHONE_COLUMN, pageWidth - gutter * 2);
  // 列被夹到最窄时两侧留白跟着缩,保证 列宽 + 两侧留白 == 页宽(否则 snap 一页和一列对不齐)。
  return { mode: 'paged', width, pageWidth, columnWidth, gutter: (pageWidth - columnWidth) / 2 };
}

/** 横向滚动偏移 → 当前第几页(四舍五入,夹在 [0, count-1])。 */
export function pageAt(offsetX: number, pageWidth: number, count: number): number {
  if (!usable(pageWidth) || count <= 0) return 0;
  const i = Math.round((Number.isFinite(offsetX) ? offsetX : 0) / pageWidth);
  return Math.min(count - 1, Math.max(0, i));
}
