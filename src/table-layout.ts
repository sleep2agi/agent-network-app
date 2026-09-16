// 2026-09-16 Vincent(安卓截图):手机端表格每列定宽 150px,三列以上就把气泡撑出屏幕、右边被裁。
// 原生端不能嵌套横向滚动(inverted FlatList 会把它撑成整屏高气泡,见 MarkdownMessage 的 WideBlock 注释),
// 所以窄屏只能换布局:≥3 列 → 每行一张卡、逐格「表头: 值」;≤2 列 → 网格但列宽随气泡自适应。web/桌面不变。
export type TableLayout = 'grid-scroll' | 'grid-flex' | 'stacked';

export const tableLayoutFor = (columns: number, native: boolean): TableLayout => {
  if (!native) return 'grid-scroll';
  return columns >= 3 ? 'stacked' : 'grid-flex';
};

/** 把一张表转成卡片:每个数据行 → [{ label: 表头, value }] ,缺格补空串,多出的格用列号当表头。 */
export const stackedRows = (rows: string[][]): Array<Array<{ label: string; value: string }>> => {
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows.slice(1).map((row) => {
    const width = Math.max(header.length, row.length);
    return Array.from({ length: width }, (_, i) => ({ label: (header[i] ?? `#${i + 1}`).trim(), value: (row[i] ?? '').trim() }));
  });
};
