// Android two-pane: the divider between the agent list and the chat can be dragged
// (Vincent 0.2.104「左边这个 agent 的列表是不是占的区间也太大了」, then「可以做成左右调动的」).
//
// Pure: no React / react-native import, so the ck tests drive these handlers directly.
// TwoPaneDivider.tsx feeds them to PanResponder.create() once (empty deps) — the same rule
// as composer-resize.ts: re-creating the PanResponder mid-drag resets gestureState and the
// divider stops following the finger.
//
// Behaviour, like Android's own split-screen divider: while the finger is down only the
// divider moves (a local preview width); the panes re-lay out once, on release. Re-laying
// out the whole app (list + open chat) on every move event would stutter on a long chat.

import { listWidthFromDrag, twoPaneListWidth } from './wide-layout';

/** Touch target of the divider (dp). The visible line stays 1 px; this is the finger strip. */
export const DIVIDER_HIT_WIDTH = 28;
/**
 * How the strip straddles the 1 px line: this much of it lies over the list, the rest over
 * the chat. List rows keep ≥ 16 dp of right padding, so the strip covers only padding there;
 * the chat side gets the smaller share because its content starts closer to the edge.
 */
export const DIVIDER_HIT_OVER_LIST = 16;
/** Keyboard / accessibility step (TalkBack increment / decrement). */
export const DIVIDER_A11Y_STEP = 20;

/** Left edge of the finger strip, for a list pane `listWidth` dp wide. */
export const dividerHitLeft = (listWidth: number): number => listWidth - DIVIDER_HIT_OVER_LIST;

export interface DividerDragEvent { preventDefault?: () => void }
export interface DividerDragGesture { dx: number }

export interface DividerDragDeps {
  /** Current committed list width — read at press time, never captured at creation. */
  getWidth: () => number;
  /** Width of the area the two panes split (beside the rail), read on every move. */
  getArea: () => number;
  /** Live preview while dragging (null = not dragging). */
  setPreview: (width: number | null) => void;
  /** Final width on release: re-lays out the panes and persists it. */
  commit: (width: number) => void;
  /** web: stop the drag from starting a text selection; returns the undo. */
  lockSelection?: () => (() => void) | void;
}

export interface DividerDragHandlers {
  onStartShouldSetPanResponder: (event?: DividerDragEvent) => boolean;
  onMoveShouldSetPanResponder: (event?: DividerDragEvent) => boolean;
  onPanResponderTerminationRequest: () => boolean;
  onShouldBlockNativeResponder: () => boolean;
  onPanResponderGrant: (event?: DividerDragEvent) => void;
  onPanResponderMove: (event: DividerDragEvent | undefined, gesture: DividerDragGesture) => void;
  onPanResponderRelease: (event: DividerDragEvent | undefined, gesture: DividerDragGesture) => void;
  onPanResponderTerminate: () => void;
}

export function dividerDragHandlers(deps: DividerDragDeps): DividerDragHandlers {
  let start = 0;
  let last = 0;
  let active = false;
  let unlock: (() => void) | void;
  const claim = (event?: DividerDragEvent) => {
    // web: no text selection / focus steal on mousedown. A press that lands on the strip
    // belongs to the divider — the strip is not inside the list or the chat, so this never
    // competes with their vertical scroll or any horizontal gesture inside them.
    event?.preventDefault?.();
    return true;
  };
  const release = () => { if (unlock) { unlock(); unlock = undefined; } };
  const end = (width: number) => {
    if (!active) return;
    active = false;
    deps.setPreview(null);
    deps.commit(width);
    release();
  };
  return {
    onStartShouldSetPanResponder: claim,
    onMoveShouldSetPanResponder: claim,
    // The list's ScrollView asks for the responder when the finger crosses it; refusing keeps
    // a drag that wanders over the list from being cut off half way.
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: () => {
      start = twoPaneListWidth(deps.getArea(), deps.getWidth());
      last = start;
      active = true;
      release();
      unlock = deps.lockSelection?.();
      deps.setPreview(start); // shows the grip immediately, before the first move
    },
    onPanResponderMove: (_event, gesture) => {
      if (!active) return;
      last = listWidthFromDrag(start, gesture.dx, deps.getArea());
      deps.setPreview(last);
    },
    onPanResponderRelease: (_event, gesture) => {
      if (!active) return;
      end(listWidthFromDrag(start, gesture.dx, deps.getArea()));
    },
    // Interrupted (system gesture, incoming call…): keep where the divider was last shown.
    onPanResponderTerminate: () => end(last),
  };
}

/** TalkBack / keyboard: increment widens the list by one step, decrement narrows it. */
export function dividerStep(width: number, areaWidth: number, action: 'increment' | 'decrement'): number {
  return twoPaneListWidth(areaWidth, width + (action === 'increment' ? DIVIDER_A11Y_STEP : -DIVIDER_A11Y_STEP));
}
