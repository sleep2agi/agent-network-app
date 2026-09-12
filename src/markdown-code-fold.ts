/**
 * 安卓端聊天里一条带超长代码块的回复把气泡撑到整屏高、文字却看不见(2026-09-12 社区截图:只剩气泡两侧的
 * 内边距两根竖条)。代码块在 inverted FlatList 里套横向 ScrollView,安卓新架构下嵌套滚动本就不可靠;这里做两件事:
 * 原生端不再嵌套横向 ScrollView(改为换行),超过 FOLD_LINES 行的代码块默认折叠,点一下展开。
 */
export const FOLD_LINES = 40;

export interface CodeFold {
  readonly shown: string;
  readonly hiddenLines: number;
  readonly totalLines: number;
}

export function foldCode(text: string, expanded: boolean, limit = FOLD_LINES): CodeFold {
  const lines = (text ?? '').split('\n');
  const totalLines = lines.length;
  if (expanded || totalLines <= limit) return { shown: text ?? '', hiddenLines: 0, totalLines };
  return { shown: lines.slice(0, limit).join('\n'), hiddenLines: totalLines - limit, totalLines };
}

export function foldLabel(f: CodeFold, expanded: boolean): string | null {
  if (f.totalLines <= FOLD_LINES) return null;
  return expanded ? `收起(共 ${f.totalLines} 行)` : `展开还有 ${f.hiddenLines} 行`;
}
