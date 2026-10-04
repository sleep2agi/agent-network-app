// Screen-level keyboard inset (iOS) — the react-native half of keyboard-inset.ts (#547).
//
// const kb = useScreenKeyboardInset();
// <KeyboardAvoidingView behavior={kb.handled ? undefined : 'padding'} style={[root, kb.style]} …>
//   {kb.probe}
//   …
//
// `probe` is an absolutely positioned, non-interactive view filling the screen's padding box: its window
// bottom is the screen's bottom edge no matter how deep the screen is nested or how much bottom padding
// we add. On iOS the KAV then renders as a plain View (behavior undefined) and `style` carries the padding.
// Android / desktop / web: `handled` is false, inset 0, the KAV works exactly as before.
//
// Web test hook: `?keyboardSim=1` on the web export runs the iOS path against a fake Keyboard the drive
// controls (window.__anetKeyboardSim.emit('keyboardWillShow', { endCoordinates: { screenY, height } })).
// Never active on a device.
import { useCallback, useMemo, useRef } from 'react';
import { Dimensions, Keyboard, LayoutAnimation, Platform, View } from 'react-native';
import type { KeyboardLike, KeyboardSubscription } from './keyboard-visibility';
import { keyboardInsetEvents, useKeyboardInset, type KeyboardEventLike } from './keyboard-inset';

type Listener = (...args: any[]) => void;
function makeSimKeyboard(): KeyboardLike & { emit(name: string, e?: unknown): number } {
  const map = new Map<string, Set<Listener>>();
  return {
    addListener(name: string, cb: Listener): KeyboardSubscription {
      if (!map.has(name)) map.set(name, new Set());
      map.get(name)!.add(cb);
      return { remove: () => { map.get(name)?.delete(cb); } };
    },
    isVisible: () => false,
    emit(name: string, e?: unknown) {
      const set = map.get(name);
      set?.forEach(cb => cb(e));
      return set?.size ?? 0;
    },
  };
}

const KEYBOARD_SIM = Platform.OS === 'web' && (() => {
  try { return new URLSearchParams(String((globalThis as { location?: { search?: string } }).location?.search ?? '')).get('keyboardSim') === '1'; } catch { return false; }
})() ? makeSimKeyboard() : null;
if (KEYBOARD_SIM) (globalThis as any).__anetKeyboardSim = KEYBOARD_SIM;

const KB: KeyboardLike = KEYBOARD_SIM ?? (Keyboard as unknown as KeyboardLike);
const KB_OS = KEYBOARD_SIM ? 'ios' : Platform.OS;

// Keyboard frames are in screen coordinates; on iPhone the window is the screen. Web sim: the viewport.
const windowHeight = () => (KEYBOARD_SIM ? Number((globalThis as any).innerHeight) || 0 : Dimensions.get('window').height);

const PROBE_STYLE = { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 } as const;

function animateWithKeyboard(e: KeyboardEventLike) {
  if (KEYBOARD_SIM) return; // the drive measures the settled frame; no animation to wait for
  const duration = typeof e?.duration === 'number' && e.duration > 10 ? e.duration : 10;
  const type = (e?.easing && (LayoutAnimation.Types as Record<string, string>)[e.easing]) || 'keyboard';
  LayoutAnimation.configureNext({ duration, update: { duration, type: type as any } });
}

export function useScreenKeyboardInset() {
  const probeRef = useRef<View>(null);
  const measureBottom = useCallback((cb: (bottom: number) => void) => {
    const node = probeRef.current as unknown as { measureInWindow?: (f: (x: number, y: number, w: number, h: number) => void) => void } | null;
    if (!node?.measureInWindow) { cb(Number.NaN); return; }
    node.measureInWindow((_x, y, _w, h) => cb(y + h));
  }, []);
  const handled = keyboardInsetEvents(KB_OS) !== null;
  const inset = useKeyboardInset(KB, KB_OS, measureBottom, animateWithKeyboard, windowHeight);
  const probe = useMemo(() => (handled
    ? <View ref={probeRef} pointerEvents="none" collapsable={false} style={PROBE_STYLE} testID="keyboard-inset-probe" />
    : null), [handled]);
  const style = useMemo(() => (inset > 0 ? { paddingBottom: inset } : null), [inset]);
  return { handled, inset, probe, style };
}
