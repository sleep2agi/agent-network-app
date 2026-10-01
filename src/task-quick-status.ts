// 手机上不打开详情就改状态 / 优先级(微信 / iOS 列表的左滑):任务列表行和看板卡片左滑露出「进行中」「完成」
// (当前就在的那个不出)+「更多」;长按菜单多「改状态…」「改优先级…」两个选择器。
// 纯逻辑,不 import react-native。写入走列表就地编辑同一条路(editCell → cellRequest):状态只发 {column},优先级只发 {priority}。
import type { ReqColumn, Requirement } from './requirements-model';
import { canEditTaskField } from './task-access';

export type SwipeAction = 'doing' | 'done' | 'more';

/** 一个滑出按钮的宽度;行高再矮按钮也至少 44 高(按钮跟行一样高,行本身 ≥ 44)。 */
export const SWIPE_ACTION_W = 72;
/** 拖过这么多才算「横着滑」,也是松手后保持打开的最小距离。 */
export const SWIPE_SLOP = 10;

/**
 * 左滑露出哪几个按钮。改不了状态的卡(只读、hub 没放开 column)一个都没有 —— 行就不能滑。
 * 参与人的卡(viewer_can.edit_fields 含 column)能滑:状态是放开的那一项。
 */
export function swipeActions(item: Pick<Requirement, 'column' | 'readOnly' | 'editFields'>): SwipeAction[] {
  if (!canEditTaskField(item, 'column')) return [];
  return [...(['doing', 'done'] as const).filter(c => c !== item.column), 'more'];
}

/** 松手时停在哪:拖过一半的按钮宽就整排打开,否则收回。dx < 0 是往左。 */
export function swipeSettle(dx: number, wasOpen: boolean, actionsWidth: number): number {
  const at = Math.max(-actionsWidth, Math.min(0, (wasOpen ? -actionsWidth : 0) + dx));
  return at <= -actionsWidth / 2 ? -actionsWidth : 0;
}

/** 拖动中跟手的位置(不超出按钮宽,不往右拉出空白)。 */
export function swipeFollow(dx: number, wasOpen: boolean, actionsWidth: number): number {
  return Math.max(-actionsWidth, Math.min(0, (wasOpen ? -actionsWidth : 0) + dx));
}

/**
 * 长按菜单里两个选择器怎么画:状态跟着 column 放开(参与人能改);优先级只有整卡可改才行(参与人改不了)。
 * hidden 的情况不存在 —— 状态和优先级每个 Hub 都有。
 */
export function quickMenuAccess(item: Pick<Requirement, 'readOnly' | 'editFields'>): { status: 'on' | 'locked'; priority: 'on' | 'locked' } {
  return { status: canEditTaskField(item, 'column') ? 'on' : 'locked', priority: item.readOnly ? 'locked' : 'on' };
}

/** 撤销提示保留多久。 */
export const UNDO_MS = 5000;

/** 一次快捷改状态之后留着的撤销信息:撤销 = 把 column 改回 from(同样只发 {column})。 */
export interface QuickUndo { id: string; name: string; from: ReqColumn; to: ReqColumn; at: number }
