// Soft-keyboard visibility + when a KeyboardAvoidingView may apply its padding.
//
// Why this exists (Vincent, 0.2.102, foldable landscape): after the keyboard was
// dismissed the chat kept a keyboard-height empty band under the composer.
// React Native's KeyboardAvoidingView on Android subscribes `keyboardDidHide` to
// the SAME handler as `keyboardDidShow` (`_onKeyboardChange`, not `_onKeyboardHide`),
// so the hide event is treated as "keyboard now at screenY=<visible area height>"
// and the padding is recomputed from `frame.y + frame.height - screenY + offset`
// instead of being reset to 0. That formula mixes parent-relative layout with
// window coordinates; whenever it comes out > 0 the padding sticks until the
// keyboard is shown again (a keyboard-height band if the visible frame read at
// hide time still excludes the IME — plausible on device, not provable on web).
// iOS resets on `keyboardWillHide`, so it is not affected.
//
// Fix: on Android the KAV is only `enabled` while we have seen `keyboardDidShow`
// without a later `keyboardDidHide`. A disabled KAV renders `paddingBottom: 0`
// no matter what stale value it computed, and re-enabling re-syncs its state.
//
// Pure (no react-native import) so the ck test can drive it with a fake emitter.
import { useEffect, useState } from 'react';

export type KeyboardSubscription = { remove(): void };
export type KeyboardLike = {
  addListener(event: string, cb: (...args: any[]) => void): KeyboardSubscription;
  isVisible?: () => boolean;
};

/** Which events report the keyboard appearing / disappearing on this platform.
 *  Android never emits keyboardWill*; web has no soft-keyboard events at all. */
export function keyboardVisibilityEvents(os: string): { show: string; hide: string } | null {
  if (os === 'ios') return { show: 'keyboardWillShow', hide: 'keyboardWillHide' };
  if (os === 'android') return { show: 'keyboardDidShow', hide: 'keyboardDidHide' };
  return null;
}

/** Subscribe to show/hide; returns the unsubscribe function. */
export function subscribeKeyboardVisibility(
  keyboard: KeyboardLike,
  os: string,
  onChange: (visible: boolean) => void,
): () => void {
  const events = keyboardVisibilityEvents(os);
  if (!events) return () => {};
  const show = keyboard.addListener(events.show, () => onChange(true));
  const hide = keyboard.addListener(events.hide, () => onChange(false));
  return () => { show.remove(); hide.remove(); };
}

/** Whether a KeyboardAvoidingView may apply its padding right now.
 *  Android: only while the keyboard is up (see header — RN never resets it on hide).
 *  Elsewhere: unchanged (`base`). */
export function keyboardAvoidEnabled(os: string, keyboardVisible: boolean, base = true): boolean {
  if (!base) return false;
  if (os === 'android') return keyboardVisible;
  return true;
}

export function useKeyboardVisible(keyboard: KeyboardLike, os: string): boolean {
  const [visible, setVisible] = useState(() => {
    try { return keyboardVisibilityEvents(os) ? !!keyboard.isVisible?.() : false; } catch { return false; }
  });
  useEffect(() => subscribeKeyboardVisibility(keyboard, os, setVisible), [keyboard, os]);
  return visible;
}
