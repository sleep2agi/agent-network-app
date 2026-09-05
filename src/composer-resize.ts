// app#237 —— 桌面端聊天输入区(desktopComposer)高度可上下拖拽,带边界与持久化。
//
// 纯函数 + localStorage 存取,不依赖 React,便于 ck 测试。ChatScreen 只负责:
//   1. onLayout 拿到根容器高度 rootHeight;
//   2. 分隔条 PanResponder:handlers 由 composerDragHandlers() 生成,🔴 只创建一次
//      (useMemo 空依赖),按下记 startHeight,移动时 height = composerHeightFromDrag(...)
//      (向上拖 dy<0 → 变高),松手 saveComposerHeight;
//   3. desktopComposer 用固定 height,内部 TextInput 的 maxHeight = inputMaxHeight(height)。
//
// 边界(验收判据 2):最小 = 原来的 minHeight 148(至少一行 + 工具栏),最大 = 根高度减去给
// 消息区保留的 LIST_RESERVE,再不能小于最小值(窗口很矮时退化成"不可调")。
// 持久化(验收判据 3):全局一把 key,与会话无关 —— issue 要求"切换会话后保持"。

export const COMPOSER_HEIGHT_MIN = 148;
export const COMPOSER_HEIGHT_DEFAULT = 148;
/** 消息列表至少保留这么高(px),输入区不能把它挤没。 */
export const COMPOSER_LIST_RESERVE = 200;
/** 输入区里除 TextInput 之外的固定开销:上下 padding(12+12)+ 工具栏 paddingTop 8 + 工具栏按钮 34。 */
export const COMPOSER_CHROME = 66;
/** 分隔条高度(px);同时是鼠标可命中的热区。 */
export const COMPOSER_DIVIDER_HEIGHT = 6;

export const COMPOSER_HEIGHT_KEY = 'chat_composer_height_v1';

export interface ComposerHeightBounds { min: number; max: number }

/** rootHeight 未知(0/NaN)时只有下界,上界取一个宽松的默认值,等 onLayout 到了再收紧。 */
export function composerHeightBounds(rootHeight: number | null | undefined): ComposerHeightBounds {
  const min = COMPOSER_HEIGHT_MIN;
  if (!rootHeight || !Number.isFinite(rootHeight) || rootHeight <= 0) return { min, max: Math.max(min, 480) };
  return { min, max: Math.max(min, Math.floor(rootHeight - COMPOSER_LIST_RESERVE)) };
}

export function clampComposerHeight(height: number, rootHeight: number | null | undefined): number {
  const { min, max } = composerHeightBounds(rootHeight);
  if (!Number.isFinite(height)) return min;
  return Math.min(max, Math.max(min, Math.round(height)));
}

/** 分隔条在输入区上沿:手指/鼠标向上(dy < 0)= 输入区变高。 */
export function composerHeightFromDrag(startHeight: number, dy: number, rootHeight: number | null | undefined): number {
  return clampComposerHeight(startHeight - dy, rootHeight);
}

/** TextInput 的可用高度;至少留一行(21px)。 */
export function inputMaxHeight(composerHeight: number): number {
  return Math.max(21, composerHeight - COMPOSER_CHROME);
}

const storage = (): Storage | null => {
  if (!(globalThis as any).__TAURI_INTERNALS__ || typeof localStorage === 'undefined') return null;
  return localStorage;
};

/** 解析持久化值:非数字 / 非正数 / 非有限一律当没存过。 */
export function parseStoredComposerHeight(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

/** undefined = 不是 Tauri 桌面窗口;null = 桌面但没存过。 */
export function loadComposerHeight(): number | null | undefined {
  const desktop = storage();
  if (!desktop) return undefined;
  return parseStoredComposerHeight(desktop.getItem(COMPOSER_HEIGHT_KEY));
}

export function saveComposerHeight(height: number): boolean {
  const desktop = storage();
  if (!desktop) return false;
  if (!Number.isFinite(height) || height <= 0) return false;
  desktop.setItem(COMPOSER_HEIGHT_KEY, String(Math.round(height)));
  return true;
}

// ---------------------------------------------------------------------------
// 分隔条拖拽 handlers(Vincent 2026-09-05 反馈:向上拖会全选上面的消息、而且拖不动)。
//
// 两个根因,都在 react-native-web 的 responder 系统里(node_modules/react-native-web/src):
//   ① 拖不动:0.2.46 的 PanResponder 是 useMemo(..., [composerHeightRaw]) —— 每次 move 触发
//      setState → 新建 PanResponder → useResponderEvents 用新 config 重新 addNode。新实例的
//      gestureState._accountsForMovesUpTo = 0,下一次 move 的 dy 只算"最近一步"的增量
//      (vendor/react-native/PanResponder/index.js _updateGestureStateOnMove),于是
//      height = start - 一步增量 ≈ start,输入框只抖一下、不跟手。
//      → handlers 只创建一次,所有会变的值通过 getter/ref 读。
//   ② 全选:mousedown 默认动作是开始浏览器文字选区,responder 系统不会替我们 preventDefault,
//      分隔条也没有 userSelect:none,于是鼠标一动就把整个消息列表选中。
//      → onStartShouldSetPanResponder 里 preventDefault;拖拽期间给 document.body 上
//        userSelect:none(lockDocumentSelection),松手/被打断都还原。
// ---------------------------------------------------------------------------

export interface ComposerDragEvent { preventDefault?: () => void }
export interface ComposerDragGesture { dy: number }

export interface ComposerDragDeps {
  /** 当前(未 clamp 的)输入区高度,按下那一刻读,不能在创建 handlers 时捕获。 */
  getHeight: () => number;
  /** 根容器高度(onLayout),同样按下/移动时现读。 */
  getRootHeight: () => number | null | undefined;
  setHeight: (height: number) => void;
  save: (height: number) => unknown;
  /** 拖拽开始时禁用页面选区;返回恢复函数。非 web 平台传 undefined。 */
  lockSelection?: () => (() => void) | void;
}

export interface ComposerDragHandlers {
  onStartShouldSetPanResponder: (event?: ComposerDragEvent) => boolean;
  onMoveShouldSetPanResponder: (event?: ComposerDragEvent) => boolean;
  onPanResponderTerminationRequest: () => boolean;
  onShouldBlockNativeResponder: () => boolean;
  onPanResponderGrant: (event?: ComposerDragEvent) => void;
  onPanResponderMove: (event: ComposerDragEvent | undefined, gesture: ComposerDragGesture) => void;
  onPanResponderRelease: (event: ComposerDragEvent | undefined, gesture: ComposerDragGesture) => void;
  onPanResponderTerminate: () => void;
}

export function composerDragHandlers(deps: ComposerDragDeps): ComposerDragHandlers {
  let startHeight = COMPOSER_HEIGHT_MIN;
  let unlock: (() => void) | void;
  const claim = (event?: ComposerDragEvent) => {
    // 阻止 mousedown 的默认动作 = 不开始浏览器文字选区(也不抢输入框焦点)。
    event?.preventDefault?.();
    return true;
  };
  const finish = () => { if (unlock) { unlock(); unlock = undefined; } };
  return {
    onStartShouldSetPanResponder: claim,
    onMoveShouldSetPanResponder: claim,
    // 拖到消息列表上方时 ScrollView 会来要 responder;不给,否则拖一半被打断。
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: () => {
      startHeight = clampComposerHeight(deps.getHeight(), deps.getRootHeight());
      finish();
      unlock = deps.lockSelection?.();
    },
    onPanResponderMove: (_event, gesture) => {
      deps.setHeight(composerHeightFromDrag(startHeight, gesture.dy, deps.getRootHeight()));
    },
    onPanResponderRelease: (_event, gesture) => {
      const next = composerHeightFromDrag(startHeight, gesture.dy, deps.getRootHeight());
      deps.setHeight(next);
      deps.save(next);
      finish();
    },
    onPanResponderTerminate: () => {
      deps.save(clampComposerHeight(deps.getHeight(), deps.getRootHeight()));
      finish();
    },
  };
}

/** web:拖拽期间整页禁选区(选区是从 mousedown 的元素一路拖出去的,只给分隔条设没用),
 *  并清掉已经存在的选区;返回恢复函数。没有 document(原生端 / 测试)时什么也不做。 */
export function lockDocumentSelection(doc: { body?: { style?: Record<string, string> }; getSelection?: () => { removeAllRanges?: () => void } | null } | undefined = typeof document === 'undefined' ? undefined : (document as any)): (() => void) | void {
  const style = doc?.body?.style;
  if (!style) return;
  const previous = { userSelect: style.userSelect ?? '', webkitUserSelect: style.webkitUserSelect ?? '' };
  style.userSelect = 'none';
  style.webkitUserSelect = 'none';
  try { doc?.getSelection?.()?.removeAllRanges?.(); } catch { /* 选区 API 不可用时忽略 */ }
  return () => {
    style.userSelect = previous.userSelect;
    style.webkitUserSelect = previous.webkitUserSelect;
  };
}
