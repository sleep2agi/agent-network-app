// 「项目文件夹」右侧文件树(Vincent 09-25「这个右边是不是可以挂一个文件树啊」)的纯状态。
//
// 像 IDE 的资源管理器:目录**按需**列 —— 展开一个目录只对那一个路径发一次 list_node_files,
// 永远不遍历整个项目(大仓几万个文件,节点那边一次只回一层)。列过的目录按节点缓存,
// 「刷新」整棵作废、只重取当前展开着且看得见的那些。
// 打开文件时它的各级祖先目录自动展开:缓存里有的直接用,缺的按从根到叶的顺序补取。
//
// 纯逻辑,不 import react-native;渲染在 NodeFilesTree.tsx,单测在 node-files-tree.test.ts。
// 状态都是不可变更新(返回新对象),React 那边直接 setState(next)。

import { entryAction, parentPath, type EntryAction, type NodeFileEntry, type NodeFilesListing } from './node-files';
import { NODE_PAGE_CONTENT_MAX_WIDTH } from './node-page-model';

export interface FilesTreeState {
  /** 已列过的目录:相对路径('' = 工作目录根)→ 节点回来的那一层。 */
  readonly listings: Readonly<Record<string, NodeFilesListing>>;
  /** 展开着的目录。根('')永远算展开,不存在这里。 */
  readonly expanded: readonly string[];
  /** 正在列的目录(每个目录自己转圈)。 */
  readonly loading: readonly string[];
  /** 列失败的目录 → 给人看的一句话。 */
  readonly errors: Readonly<Record<string, string>>;
}

export const emptyTree = (): FilesTreeState => ({ listings: {}, expanded: [], loading: [], errors: {} });

const without = (xs: readonly string[], x: string): string[] => xs.filter(v => v !== x);
const withOne = (xs: readonly string[], x: string): string[] => (xs.includes(x) ? [...xs] : [...xs, x]);
const omit = <T,>(r: Readonly<Record<string, T>>, k: string): Record<string, T> => {
  if (!(k in r)) return { ...r };
  const { [k]: _drop, ...rest } = r;
  return rest;
};

export const isExpanded = (s: FilesTreeState, dir: string): boolean => dir === '' || s.expanded.includes(dir);
export const isLoading = (s: FilesTreeState, dir: string): boolean => s.loading.includes(dir);
export const hasListing = (s: FilesTreeState, dir: string): boolean => Object.prototype.hasOwnProperty.call(s.listings, dir);

/** 这一行是不是能展开的目录(真目录,或指向工作目录内的目录链接;凭据 / 依赖目录不算)。 */
export const isExpandableEntry = (dir: string, e: NodeFileEntry): boolean => entryAction(dir, e).kind === 'descend';

/**
 * 展开一个目录。返回新状态和「要不要去列它」:缓存里有、或已经在列,都不再发请求。
 * 失败过的目录再次展开 = 重试(清掉错误、重新列)。
 */
export function expandDir(s: FilesTreeState, dir: string): { state: FilesTreeState; fetch: boolean } {
  const expanded = dir === '' ? [...s.expanded] : withOne(s.expanded, dir);
  const fetch = !hasListing(s, dir) && !isLoading(s, dir);
  return {
    state: { ...s, expanded, loading: fetch ? withOne(s.loading, dir) : [...s.loading], errors: fetch ? omit(s.errors, dir) : { ...s.errors } },
    fetch,
  };
}

/** 收起一个目录:只收它自己,子目录的展开状态保留(再展开时原样回来,和 IDE 一样)。根不收。 */
export function collapseDir(s: FilesTreeState, dir: string): FilesTreeState {
  if (dir === '') return s;
  return { ...s, expanded: without(s.expanded, dir) };
}

export function toggleDir(s: FilesTreeState, dir: string): { state: FilesTreeState; fetch: boolean } {
  if (dir !== '' && isExpanded(s, dir)) return { state: collapseDir(s, dir), fetch: false };
  return expandDir(s, dir);
}

/** 节点回来一层:放进缓存,清掉这个目录的转圈和错误。 */
export function mergeListing(s: FilesTreeState, dir: string, listing: NodeFilesListing): FilesTreeState {
  return { ...s, listings: { ...s.listings, [dir]: listing }, loading: without(s.loading, dir), errors: omit(s.errors, dir) };
}

export function markLoading(s: FilesTreeState, dir: string): FilesTreeState {
  return { ...s, loading: withOne(s.loading, dir), errors: omit(s.errors, dir) };
}

export function markError(s: FilesTreeState, dir: string, message: string): FilesTreeState {
  return { ...s, loading: without(s.loading, dir), errors: { ...s.errors, [dir]: message } };
}

/** 'a/b/c.ts' → ['', 'a', 'a/b'](从根到直接父目录,不含自己)。 */
export function ancestorDirs(path: string): string[] {
  const out = [''];
  if (!path) return [];
  let acc = '';
  const segs = path.split('/').filter(Boolean);
  for (const seg of segs.slice(0, -1)) {
    acc = acc ? `${acc}/${seg}` : seg;
    out.push(acc);
  }
  return out;
}

/**
 * 让某个文件(或目录)在树里看得见:它的各级祖先全部展开。
 * 返回要补列的祖先,**从根到叶**排好 —— 调用方按顺序一层层取(父目录先回来,子目录那一行才画得出来)。
 * 缓存里已有的、正在列的都不再取。
 */
export function revealPath(s: FilesTreeState, path: string): { state: FilesTreeState; fetch: string[] } {
  let state = s;
  const fetch: string[] = [];
  for (const dir of ancestorDirs(path)) {
    const r = expandDir(state, dir);
    state = r.state;
    if (r.fetch) fetch.push(dir);
  }
  return { state, fetch };
}

/**
 * 「刷新」:缓存整个作废(节点那边可能加了 / 删了文件),展开状态保留。
 * 返回要重取的目录:根 + 所有**看得见**的展开目录(祖先都展开着的),从浅到深。
 * 被收起的祖先下面那些展开记录不重取 —— 等真的展开到它时再按需列。
 */
export function invalidateTree(s: FilesTreeState): { state: FilesTreeState; fetch: string[] } {
  const visible = ['', ...s.expanded.filter(d => ancestorDirs(d).every(a => isExpanded(s, a)))]
    .sort((a, b) => depthOf(a) - depthOf(b) || a.localeCompare(b));
  return { state: { listings: {}, expanded: [...s.expanded], loading: visible, errors: {} }, fetch: visible };
}

const depthOf = (p: string): number => (p === '' ? 0 : p.split('/').length);

export type TreeRow =
  | { kind: 'entry'; path: string; name: string; depth: number; entry: NodeFileEntry; action: EntryAction; dirLike: boolean; expanded: boolean; loading: boolean }
  | { kind: 'loading'; path: string; depth: number }
  | { kind: 'error'; path: string; depth: number; message: string }
  | { kind: 'empty'; path: string; depth: number }
  | { kind: 'truncated'; path: string; depth: number; shown: number; total: number };

/**
 * 把树摊平成一行行(渲染和键盘导航都用这个)。只走展开着的目录,且只用缓存 —— 这里不发请求。
 * 占位行(loading / error / empty / truncated)的 path 用 `目录路径 + '\0' + 种类`,不会和真条目撞。
 */
export function visibleRows(s: FilesTreeState): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (dir: string, depth: number) => {
    const l = s.listings[dir];
    if (!l) {
      if (s.errors[dir] !== undefined) rows.push({ kind: 'error', path: `${dir}\0error`, depth, message: s.errors[dir] });
      else if (isLoading(s, dir)) rows.push({ kind: 'loading', path: `${dir}\0loading`, depth });
      return;
    }
    if (l.entries.length === 0) rows.push({ kind: 'empty', path: `${dir}\0empty`, depth });
    for (const e of l.entries) {
      const action = entryAction(dir, e);
      const path = dir ? `${dir}/${e.name}` : e.name;
      const dirLike = action.kind === 'descend';
      const expanded = dirLike && isExpanded(s, path);
      rows.push({ kind: 'entry', path, name: e.name, depth, entry: e, action, dirLike, expanded, loading: dirLike && isLoading(s, path) });
      if (expanded) walk(path, depth + 1);
    }
    if (l.truncated) rows.push({ kind: 'truncated', path: `${dir}\0truncated`, depth, shown: l.entries.length, total: l.total });
  };
  walk('', 0);
  return rows;
}

/** 可以被键盘停留的行(占位行跳过)。 */
const focusable = (rows: readonly TreeRow[]) => rows.filter((r): r is Extract<TreeRow, { kind: 'entry' }> => r.kind === 'entry');

/**
 * ↑ / ↓:在可停留的行之间移动。当前焦点不在列表里(比如刚被收起)→ 从当前打开的文件那一行
 * 或第一行开始。到头 / 到尾停住,不绕回。
 */
export function moveFocus(rows: readonly TreeRow[], focused: string | null, delta: 1 | -1, fallback: string | null = null): string | null {
  const f = focusable(rows);
  if (f.length === 0) return null;
  let i = focused === null ? -1 : f.findIndex(r => r.path === focused);
  if (i < 0) {
    const j = fallback === null ? -1 : f.findIndex(r => r.path === fallback);
    return (j >= 0 ? f[j] : delta > 0 ? f[0] : f[f.length - 1]).path;
  }
  i = Math.max(0, Math.min(f.length - 1, i + delta));
  return f[i].path;
}

/**
 * ← / →(和 VS Code 一致):
 *  - → 在收起的目录上 = 展开;在展开的目录上 = 跳到第一个子项;
 *  - ← 在展开的目录上 = 收起;否则跳到父目录那一行。
 */
export type ArrowIntent = { kind: 'expand'; path: string } | { kind: 'collapse'; path: string } | { kind: 'focus'; path: string } | { kind: 'none' };

export function arrowIntent(rows: readonly TreeRow[], focused: string | null, key: 'left' | 'right'): ArrowIntent {
  const row = focusable(rows).find(r => r.path === focused);
  if (!row) return { kind: 'none' };
  if (key === 'right') {
    if (!row.dirLike) return { kind: 'none' };
    if (!row.expanded) return { kind: 'expand', path: row.path };
    const idx = rows.indexOf(row);
    const next = rows[idx + 1];
    return next && next.kind === 'entry' && next.depth === row.depth + 1 ? { kind: 'focus', path: next.path } : { kind: 'none' };
  }
  if (row.dirLike && row.expanded) return { kind: 'collapse', path: row.path };
  const parent = parentPath(row.path);
  return parent === '' ? { kind: 'none' } : { kind: 'focus', path: parent };
}

// ── 按节点缓存 ──
// 离开「项目文件夹」分区再回来(组件卸载重建)不重新列:树的状态按节点存在模块里。
// 只留最近几个节点,不无限长。

export const FILES_TREE_CACHE_NODES = 8;

export class FilesTreeCache {
  private readonly m = new Map<string, FilesTreeState>();
  constructor(private readonly cap = FILES_TREE_CACHE_NODES) {}
  get(key: string): FilesTreeState {
    const s = this.m.get(key);
    if (!s) return emptyTree();
    this.m.delete(key); this.m.set(key, s); // 最近用过的排到最后
    return s;
  }
  set(key: string, s: FilesTreeState): void {
    this.m.delete(key);
    this.m.set(key, s);
    while (this.m.size > this.cap) this.m.delete(this.m.keys().next().value as string);
  }
  has(key: string): boolean { return this.m.has(key); }
  get size(): number { return this.m.size; }
}

/**
 * 模块卸载时(离开分区)还在列的目录:回来时这些请求早没人等了,状态里的「转圈」要清掉,
 * 否则那几行会永远转(展开状态保留,下次渲染发现没有列表会重新取)。
 */
export function dropInFlight(s: FilesTreeState): FilesTreeState {
  return s.loading.length === 0 ? s : { ...s, loading: [] };
}

/** 展开着、没缓存、也不在列、也没失败的目录 —— 组件挂上时要补取的(缓存被卸载时打断过)。 */
export function missingExpanded(s: FilesTreeState): string[] {
  return ['', ...s.expanded]
    .filter(d => ancestorDirs(d).every(a => isExpanded(s, a)))
    .filter(d => !hasListing(s, d) && !isLoading(s, d) && s.errors[d] === undefined)
    .sort((a, b) => depthOf(a) - depthOf(b) || a.localeCompare(b));
}

// ── 布局 ──

/** 右侧文件树默认宽度(Vincent 截图里代码区右边那一栏的宽度量级)。 */
export const FILES_TREE_DEFAULT_WIDTH = 280;
/** 拖拽改宽的上下限:窄到 220 仍放得下「图标 + 20 来个等宽字符」,宽过 420 就在挤代码区了。 */
export const FILES_TREE_MIN_WIDTH = 220;
export const FILES_TREE_MAX_WIDTH = 420;
/** 树和查看器之间的空隙。 */
export const FILES_TREE_GAP = 12;

/**
 * 查看器至少要多宽,树才并排挂在右边。
 * 为什么是 520:代码视图是 12px 等宽(一个字符约 7.2px),520 扣掉行号栏和内边距还能放约 64 列 ——
 * 大多数源码行放得下,更长的行本来就横向滚。实测 1440 宽的桌面窗口走「服务器设置 → 节点」进节点页,
 * 左边有服务器侧栏 + 分区栏,内容列只剩 818px:阈值要让这个最常见的笔记本尺寸也挂得出树
 * (818 ≥ 520 + 12 + 280 = 812);再窄(1000 宽窗口内容列约 380px)挂上树代码区就只剩一小条,
 * 那时树收成「目录」按钮、点开是抽屉。
 */
export const FILES_VIEWER_MIN_WIDTH = 520;

/** 内容列(未封顶前)至少这么宽才并排挂树:查看器 620 + 空隙 + 树的默认宽。 */
export const FILES_TREE_DOCK_MIN_CONTENT_WIDTH = FILES_VIEWER_MIN_WIDTH + FILES_TREE_GAP + FILES_TREE_DEFAULT_WIDTH;

export type FilesTreeMode = 'docked' | 'drawer' | 'none';

/**
 * 树怎么出现:
 *  - phone(手机单栏,节点页是顶部分段标签那种窄布局)→ 'none',手机布局不变;
 *  - 内容列够宽 → 'docked'(并排挂在右边,始终可见);
 *  - 否则(桌面窄窗、安卓双栏的右栏)→ 'drawer'(工具条上一个「目录」按钮,点开是抽屉)。
 * contentWidth 是内容列**封顶之前**能拿到的宽度(右栏宽减左右内边距)。
 */
export function filesTreeMode(args: { contentWidth: number; phone: boolean }): FilesTreeMode {
  if (args.phone) return 'none';
  // 没量到(0 / NaN)时比较恒为 false ⇒ 抽屉,不会先并排挂出来再收回去。
  return args.contentWidth >= FILES_TREE_DOCK_MIN_CONTENT_WIDTH ? 'docked' : 'drawer';
}

export const clampTreeWidth = (w: number): number =>
  !Number.isFinite(w) ? FILES_TREE_DEFAULT_WIDTH : Math.round(Math.max(FILES_TREE_MIN_WIDTH, Math.min(FILES_TREE_MAX_WIDTH, w)));

/**
 * 节点页内容列的封顶宽度。树并排挂出来时,「项目文件夹」这一区放宽到「原来的 1080 + 树」:
 * 树吃的是截图里右边那条空栏,而不是从查看器里再抠 290px 出来。其它分区不变。
 */
export function nodePageColumnMaxWidth(section: string, mode: FilesTreeMode): number {
  return section === 'files' && mode === 'docked' ? NODE_PAGE_CONTENT_MAX_WIDTH + FILES_TREE_GAP + FILES_TREE_MAX_WIDTH : NODE_PAGE_CONTENT_MAX_WIDTH;
}
