// app#237 —— 桌面端聊天输入区(desktopComposer)高度可上下拖拽,带边界与持久化。
//
// 纯函数 + localStorage 存取,不依赖 React,便于 ck 测试。ChatScreen 只负责:
//   1. onLayout 拿到根容器高度 rootHeight;
//   2. 分隔条 PanResponder:按下记 startHeight,移动时 height = composerHeightFromDrag(...)
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
