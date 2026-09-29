// 规则文件「左右」分栏编辑的纯模型(2026-09-28,Vincent 在 2048×807 的桌面窗口里:
// 「可以不可以 一左一右 编辑」—— 编辑模式只有中间一条,两边大片空白)。
// 左 = 源码编辑框,右 = 用阅读模式同一个 MarkdownMessage 渲染的实时预览,中间一条可拖的分隔条。
// 纯逻辑,不 import react-native:模式、分隔条、源码行 → 预览位置的映射都在这里,有自执行测试。
import { chooseAppLayout, type LayoutInput } from './wide-layout';
import { DOUBLE_TAP_MS, isTap, type RulesViewMode } from './node-rules-view';

// ── 模式:阅读 / 编辑 / 左右 ────────────────────────────────────────────────────

/**
 * 「左右」只在宽布局给:桌面工作区 / 安卓双栏(展开的折叠屏、平板) —— 就是 App.tsx 用的同一个
 * chooseAppLayout。手机和合上的折叠屏是 'phone',不给(两栏各 190 dp 什么都看不清)。
 */
export const rulesWideLayout = (input: LayoutInput): boolean => chooseAppLayout(input) !== 'phone';

/**
 * 编辑区自己的宽度也得够:宽布局下节点页的规则卡片可能被列表挤窄(安卓双栏 700 dp 时右栏只有 380)。
 * 两栏各至少 25%,640 ⇒ 每栏最少 160、默认 320 —— 刚够一列手机宽的正文。
 */
export const RULES_SPLIT_MIN_WIDTH = 640;

/** 能不能用「左右」。bodyWidth 还没量到(0)按够宽算 —— 否则桌面上第一帧先闪一下两个 tab。 */
export function rulesSplitAvailable(wide: boolean, bodyWidth: number): boolean {
  if (!wide) return false;
  return !(bodyWidth > 0) || bodyWidth >= RULES_SPLIT_MIN_WIDTH;
}

/** 工具条上给哪几个 tab。 */
export function rulesModeTabs(splitAvailable: boolean): RulesViewMode[] {
  return splitAvailable ? ['read', 'edit', 'split'] : ['read', 'edit'];
}

export const RULES_MODE_LABEL: Record<RulesViewMode, string> = { read: '阅读', edit: '编辑', split: '左右' };

/** 存下来的模式:认不出就当没存过。 */
export function parseStoredRulesMode(raw: string | null | undefined): RulesViewMode | null {
  return raw === 'read' || raw === 'edit' || raw === 'split' ? raw : null;
}

/**
 * 打开规则文件时的模式:用户选过就用他上次选的;没选过 —— 宽布局默认「左右」,窄处默认「阅读」
 * (读得多、改得少,手机上先给能读的样子,见 RULES_DEFAULT_MODE)。
 */
export function initialRulesMode(stored: RulesViewMode | null, wide: boolean): RulesViewMode {
  if (stored) return stored;
  return wide ? 'split' : 'read';
}

/**
 * 实际画哪种:选的是「左右」但此刻不可用(窗口缩窄、折叠屏合上)⇒ 画「编辑」—— 用户要的是改源码,
 * 只是放不下预览。存下来的偏好不动,窗口再拉宽就回到左右。
 */
export function effectiveRulesMode(chosen: RulesViewMode, splitAvailable: boolean): RulesViewMode {
  return chosen === 'split' && !splitAvailable ? 'edit' : chosen;
}

/** 查找(RulesFind)只认阅读 / 编辑两种:「左右」里查的是左边的源码。 */
export const findModeFor = (mode: RulesViewMode): 'read' | 'edit' => (mode === 'read' ? 'read' : 'edit');

// ── 分隔条 ──────────────────────────────────────────────────────────────────────

/** 左栏(源码)占两栏总宽的比例。 */
export const SPLIT_RATIO_DEFAULT = 0.5;
/** 每栏至少 25%。 */
export const SPLIT_RATIO_MIN = 0.25;
export const SPLIT_RATIO_MAX = 0.75;
/** 分隔条的鼠标/手指热区宽(px)。看得见的只有 1px 线;热区跨在线的两边。 */
export const SPLIT_DIVIDER_HIT = 12;
/** 键盘 / 读屏每步挪多少。 */
export const SPLIT_RATIO_STEP = 0.05;

export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return SPLIT_RATIO_DEFAULT;
  return Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, ratio));
}

/** 拖动:按下时比例 startRatio,手指横移 dx,两栏总宽 width。 */
export function splitRatioFromDrag(startRatio: number, dx: number, width: number): number {
  if (!(width > 0)) return clampSplitRatio(startRatio);
  return clampSplitRatio(startRatio + (Number.isFinite(dx) ? dx : 0) / width);
}

/** 存下来的比例:不是 (0,1) 里的数 ⇒ 没存过;存过的也按 25%–75% 夹一下。 */
export function parseStoredSplitRatio(raw: string | null | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n >= 1) return null;
  return clampSplitRatio(n);
}

/** 两栏宽(整数 px,左 + 右 === width)。分隔条是盖在交界处的热区,不占宽。 */
export function splitPaneWidths(width: number, ratio: number): { left: number; right: number } {
  const w = Math.max(0, Math.round(Number.isFinite(width) ? width : 0));
  const left = Math.round(w * clampSplitRatio(ratio));
  return { left, right: w - left };
}

export interface SplitDragDeps {
  getRatio: () => number;
  getWidth: () => number;
  /** 拖动中的比例(实时重排两栏)。 */
  setRatio: (ratio: number) => void;
  /** 松手:定下来并存盘。 */
  commit: (ratio: number) => void;
  /** 双击:回到 50/50。 */
  reset: () => void;
  now?: () => number;
  /** web:拖的时候别选中文字;返回撤销函数。 */
  lockSelection?: () => (() => void) | void;
}

/**
 * PanResponder 的回调(组件里 create 一次,空依赖 —— 拖到一半重建会让 dx 从 0 重算)。
 * 双击 = 两次「按下没怎么动就抬起」相隔 ≤ DOUBLE_TAP_MS;web 上的鼠标双击也走这里,
 * 不另挂 dblclick(react-native-web 的 View 不转发它)。
 */
export function splitDividerHandlers(deps: SplitDragDeps) {
  const now = deps.now ?? (() => Date.now());
  let start = SPLIT_RATIO_DEFAULT;
  let last = start;
  let active = false;
  let lastTapAt: number | null = null;
  let unlock: (() => void) | void;
  const release = () => { if (unlock) { unlock(); unlock = undefined; } };
  const claim = (event?: { preventDefault?: () => void }) => { event?.preventDefault?.(); return true; };
  const end = (dx: number | null) => {
    if (!active) return;
    active = false;
    release();
    if (dx != null && isTap({ x: 0, y: 0 }, { x: dx, y: 0 })) {
      const t = now();
      if (lastTapAt != null && t - lastTapAt >= 0 && t - lastTapAt <= DOUBLE_TAP_MS) {
        lastTapAt = null;
        deps.reset();
        return;
      }
      lastTapAt = t;
      deps.commit(start);
      return;
    }
    lastTapAt = null;
    deps.commit(last);
  };
  return {
    onStartShouldSetPanResponder: claim,
    onMoveShouldSetPanResponder: claim,
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: () => {
      start = clampSplitRatio(deps.getRatio());
      last = start;
      active = true;
      release();
      unlock = deps.lockSelection?.();
    },
    onPanResponderMove: (_e: unknown, g: { dx: number }) => {
      if (!active) return;
      last = splitRatioFromDrag(start, g.dx, deps.getWidth());
      deps.setRatio(last);
    },
    onPanResponderRelease: (_e: unknown, g: { dx: number }) => {
      if (!active) return;
      last = splitRatioFromDrag(start, g.dx, deps.getWidth());
      end(g.dx);
    },
    onPanResponderTerminate: () => end(null),
  };
}

// ── 滚动同步:源码行 → 预览位置 ─────────────────────────────────────────────────
// 锚点 = 预览里每个带行号的块(标题、段落、列表项、表格行、代码块…,就是 data-md-line 那些):
// 它在源码编辑框里的 y(src)和在预览里的 y(dst)。滚动位置在锚点之间按比例插值,
// 两端再补 (0,0) 和 (源码最大滚动, 预览最大滚动),所以滚到底预览也到底。

export interface PreviewBlock {
  /** 块在原文里的首行 / 末行(0 起,含)。 */
  readonly start: number;
  readonly end: number;
  /** 块顶部相对预览内容顶部的 y。 */
  readonly top: number;
}

/**
 * 源码第 line 行对应预览里的哪一块:起始行 ≤ line 的最后一块(行在块中间、或落在两块之间的
 * 空行上,都归前面那一块;在第一块之前 ⇒ 第一块)。blocks 任意顺序;空 ⇒ -1。返回的是 blocks 里的下标。
 */
export function previewBlockForLine(blocks: readonly PreviewBlock[], line: number): number {
  let best = -1;
  let first = -1;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (first < 0 || b.start < blocks[first].start) first = i;
    if (b.start <= line && (best < 0 || b.start > blocks[best].start || (b.start === blocks[best].start && b.top > blocks[best].top))) best = i;
  }
  return best >= 0 ? best : first;
}

/**
 * 源码行(可带小数:滚动停在一行中间)→ 预览里的 y。在块内按行比例插值到下一块的顶部;
 * 最后一块之后按最后一块的高度外推不了,就停在它的顶部。空 ⇒ null。
 */
export function previewYForLine(blocks: readonly PreviewBlock[], line: number): number | null {
  if (!blocks.length || !Number.isFinite(line)) return null;
  const sorted = [...blocks].sort((a, b) => a.start - b.start || a.top - b.top);
  const i = previewBlockForLine(sorted, Math.floor(line));
  const cur = sorted[i];
  if (line < cur.start) return cur.top;
  const next = sorted.slice(i + 1).find((b) => b.start > cur.start && b.top >= cur.top);
  if (!next) return cur.top;
  const f = Math.min(1, Math.max(0, (line - cur.start) / (next.start - cur.start)));
  return cur.top + f * (next.top - cur.top);
}

export interface SyncAnchor {
  /** 源码编辑框里的 y(这一块首行的顶部)。 */
  readonly src: number;
  /** 预览里的 y(这一块的顶部)。 */
  readonly dst: number;
}

/**
 * 锚点整理成单调的一串:按 src 排序,src 或 dst 往回走的扔掉(嵌套块、同一行上的多个元素),
 * 不然插值会让预览倒着跳。
 */
export function monotonicAnchors(anchors: readonly SyncAnchor[]): SyncAnchor[] {
  const out: SyncAnchor[] = [];
  for (const a of [...anchors].filter((x) => Number.isFinite(x.src) && Number.isFinite(x.dst)).sort((x, y) => x.src - y.src || x.dst - y.dst)) {
    const prev = out[out.length - 1];
    if (prev && (a.src <= prev.src || a.dst < prev.dst)) continue;
    out.push(a);
  }
  return out;
}

/**
 * 源码滚到 srcScroll ⇒ 预览该滚到哪。srcMax / dstMax = 两边的最大 scrollTop。
 * 没有锚点 = 纯按比例(原生端量不到编辑框里每行的 y,就走这一支)。
 */
export function syncedScrollTop(anchors: readonly SyncAnchor[], srcScroll: number, srcMax: number, dstMax: number): number {
  const sMax = Math.max(0, srcMax);
  const dMax = Math.max(0, dstMax);
  if (!(sMax > 0) || !(dMax > 0)) return 0;
  const s = Math.min(sMax, Math.max(0, srcScroll));
  const pts = monotonicAnchors([{ src: 0, dst: 0 }, ...anchors.filter((a) => a.src > 0 && a.src < sMax && a.dst < dMax), { src: sMax, dst: dMax }]);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (s <= b.src) {
      const f = b.src === a.src ? 0 : (s - a.src) / (b.src - a.src);
      return Math.round(a.dst + f * (b.dst - a.dst));
    }
  }
  return Math.round(dMax);
}

// ── 实时预览的节流 ──────────────────────────────────────────────────────────────

/** 边打字边渲染预览:停手这么久(ms)才重排一次,48 KB 的文件也不卡键盘。 */
export const SPLIT_PREVIEW_DEBOUNCE_MS = 150;

// ── 本机偏好(存储后端注入:web localStorage / 原生 JSON 文件,接线在 rules-editor-prefs.ts) ──────

export const RULES_MODE_KEY = 'rules_view_mode_v1';
export const RULES_SPLIT_RATIO_KEY = 'rules_split_ratio_v1';
export const RULES_SCROLL_SYNC_KEY = 'rules_scroll_sync_v1';
export const RULES_OUTLINE_OPEN_KEY = 'rules_outline_open_v1';

export interface PrefsBackend {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
}

export interface RulesEditorPrefs {
  /** null = 从没选过(按布局给默认,见 initialRulesMode)。 */
  mode: RulesViewMode | null;
  ratio: number | null;
  scrollSync: boolean | null;
  outlineOpen: boolean | null;
}

const parseFlag = (raw: string | null): boolean | null => (raw === '1' ? true : raw === '0' ? false : null);

export function rulesEditorPrefs(backend: PrefsBackend) {
  return {
    load: async (): Promise<RulesEditorPrefs> => {
      const [mode, ratio, sync, outline] = await Promise.all([RULES_MODE_KEY, RULES_SPLIT_RATIO_KEY, RULES_SCROLL_SYNC_KEY, RULES_OUTLINE_OPEN_KEY].map((k) => backend.get(k).catch(() => null)));
      return { mode: parseStoredRulesMode(mode), ratio: parseStoredSplitRatio(ratio), scrollSync: parseFlag(sync), outlineOpen: parseFlag(outline) };
    },
    saveMode: (mode: RulesViewMode) => backend.set(RULES_MODE_KEY, mode),
    /** 坏值(NaN、越界到 0/1 之外)不写盘。 */
    saveRatio: (ratio: number) => (parseStoredSplitRatio(String(ratio)) === null ? Promise.resolve() : backend.set(RULES_SPLIT_RATIO_KEY, clampSplitRatio(ratio).toFixed(4))),
    saveScrollSync: (on: boolean) => backend.set(RULES_SCROLL_SYNC_KEY, on ? '1' : '0'),
    saveOutlineOpen: (open: boolean) => backend.set(RULES_OUTLINE_OPEN_KEY, open ? '1' : '0'),
  };
}
