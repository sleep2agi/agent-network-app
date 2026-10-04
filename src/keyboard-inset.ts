// How far a full-screen view (chat / DM / rules editor) must pad its bottom so the
// soft keyboard sits right under its last row — iOS (#547).
//
// Vincent 10-04 13:31 (iPhone, Chinese 9-key with its candidate bar): 「输入法把这个输入框给遮挡起来」.
//
// Root cause: RN's KeyboardAvoidingView pads by `frame.y + frame.height - (screenY - keyboardVerticalOffset)`,
// where `frame` comes from onLayout = PARENT-relative, while `screenY` is in WINDOW coordinates. It is only
// right when the KAV's parent starts at window y = keyboardVerticalOffset. On iOS we passed 0. That held while
// the chat was a direct child of the root SafeAreaView (frame.y == the safe-area top padding). Since #381
// (2026-09-26, nav shell for the rail / foldable layout) the chat sits inside navShell > navContent, so
// frame.y == 0 while the view really starts at window y == the top safe-area inset (47 pt on iPhone 14, 59 on
// 15/16 Pro …). The padding came out exactly one top inset too small, and the composer stayed that far under
// the keyboard. Android was unaffected: it passes StatusBar.currentHeight, which is the same top padding.
//
// Second gap: on iOS RN's KAV only listens to keyboardWillShow / keyboardWillHide, not
// keyboardWillChangeFrame, so a keyboard height change while it is up (IME switch, candidate bar,
// emoji keyboard) is followed only if iOS happens to re-post willShow.
//
// Fix (iOS): measure the view's real bottom in window coordinates (measureInWindow, so the nesting no
// longer matters) on every keyboardWillShow / keyboardWillChangeFrame, pad by the overlap, reset on
// keyboardWillHide. Android keeps RN's KAV with its existing offset + visibility gate (keyboard-visibility.ts):
// it is correct there, RN re-emits keyboardDidShow when the IME height changes, and it is device-proven.
//
// Pure (no react-native import) so the ck test drives it with a fake emitter.
import { useEffect, useRef, useState } from 'react';
import type { KeyboardLike } from './keyboard-visibility';

export type KeyboardFrame = { screenY?: number; height?: number };
export type KeyboardEventLike = { endCoordinates?: KeyboardFrame; duration?: number; easing?: string } | null | undefined;

/** Events that move the keyboard on the platforms this module handles; null = not handled here. */
export function keyboardInsetEvents(os: string): { change: string[]; hide: string } | null {
  if (os === 'ios') return { change: ['keyboardWillShow', 'keyboardWillChangeFrame'], hide: 'keyboardWillHide' };
  return null;
}

/** Overlap between a view whose bottom edge is at `viewBottomInWindow` and the keyboard's end frame.
 *  With `windowHeight`, a keyboard that is not docked to the bottom edge (iPad floating / split) counts as 0. */
export function keyboardOverlap(viewBottomInWindow: number, frame: KeyboardFrame | null | undefined, windowHeight?: number): number {
  if (!frame || !(typeof frame.screenY === 'number') || !Number.isFinite(frame.screenY)) return 0;
  if (typeof frame.height === 'number' && frame.height <= 0) return 0;
  if (typeof windowHeight === 'number' && windowHeight > 0 && typeof frame.height === 'number' && frame.screenY + frame.height < windowHeight - 1) return 0;
  if (!Number.isFinite(viewBottomInWindow)) return 0;
  return Math.max(0, Math.round(viewBottomInWindow - frame.screenY));
}

/** RN 0.85 KeyboardAvoidingView (behavior="padding"), verbatim: what the old code padded by. */
export function rnKavPadding(frameY: number, frameHeight: number, screenY: number, keyboardVerticalOffset: number): number {
  return Math.max(frameY + frameHeight - (screenY - keyboardVerticalOffset), 0);
}

/** measure(cb) must call cb with the view's bottom edge in window coordinates (y + height of measureInWindow). */
export type MeasureBottom = (cb: (bottom: number) => void) => void;

export function subscribeKeyboardInset(
  keyboard: KeyboardLike,
  os: string,
  measureBottom: MeasureBottom,
  onInset: (inset: number, event: KeyboardEventLike) => void,
  windowHeight?: () => number,
): () => void {
  const events = keyboardInsetEvents(os);
  if (!events) return () => {};
  // Sequence guard: a slow measure for an older frame must not land after a newer one (or after hide).
  let seq = 0;
  const onChange = (e: KeyboardEventLike) => {
    const mine = ++seq;
    const frame = e?.endCoordinates;
    measureBottom(bottom => { if (mine === seq) onInset(keyboardOverlap(bottom, frame, windowHeight?.()), e); });
  };
  const subs = events.change.map(name => keyboard.addListener(name, onChange));
  subs.push(keyboard.addListener(events.hide, (e: KeyboardEventLike) => { ++seq; onInset(0, e); }));
  return () => { for (const s of subs) s.remove(); };
}

/** Bottom padding that keeps the view's last row on top of the keyboard (0 where RN's KAV still does it).
 *  `beforeChange` runs right before the value changes (the screen uses it to animate with the keyboard). */
export function useKeyboardInset(
  keyboard: KeyboardLike,
  os: string,
  measureBottom: MeasureBottom,
  beforeChange?: (event: KeyboardEventLike) => void,
  windowHeight?: () => number,
): number {
  const [inset, setInset] = useState(0);
  const current = useRef(0);
  const before = useRef(beforeChange);
  before.current = beforeChange;
  const winH = useRef(windowHeight);
  winH.current = windowHeight;
  useEffect(() => subscribeKeyboardInset(keyboard, os, measureBottom, (next, e) => {
    if (next === current.current) return;
    current.current = next;
    before.current?.(e);
    setInset(next);
  }, () => winH.current?.() ?? 0), [keyboard, os, measureBottom]);
  return inset;
}
