import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const { keyboardVisibilityEvents, subscribeKeyboardVisibility, keyboardAvoidEnabled } = await import('./keyboard-visibility');

let ck = 0;
const check = (cond: boolean, msg: string) => { assert.ok(cond, msg); ck++; };

// ── fake RN Keyboard emitter ──────────────────────────────────────────────
function fakeKeyboard() {
  const listeners = new Map<string, Set<(e?: any) => void>>();
  return {
    addListener(event: string, cb: (e?: any) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(cb);
      return { remove: () => { listeners.get(event)!.delete(cb); } };
    },
    emit(event: string, e?: any) { for (const cb of listeners.get(event) ?? []) cb(e); },
    count() { let n = 0; for (const s of listeners.values()) n += s.size; return n; },
  };
}

// ── events per platform: Android never fires keyboardWill* ─────────────────
check(keyboardVisibilityEvents('android')?.show === 'keyboardDidShow', 'android show = keyboardDidShow');
check(keyboardVisibilityEvents('android')?.hide === 'keyboardDidHide', 'android hide = keyboardDidHide (Will* never fires on Android)');
check(keyboardVisibilityEvents('ios')?.hide === 'keyboardWillHide', 'ios hide = keyboardWillHide');
check(keyboardVisibilityEvents('web') === null, 'web has no soft-keyboard events');

// ── Android: show → hide round-trip, dismissed however (back gesture, tap outside,
//    IME button all end in the same keyboardDidHide from ReactRootView insets) ──
{
  const kb = fakeKeyboard();
  let visible = false;
  const off = subscribeKeyboardVisibility(kb, 'android', v => { visible = v; });
  kb.emit('keyboardWillShow'); kb.emit('keyboardWillHide');
  check(visible === false, 'android ignores Will* events');
  kb.emit('keyboardDidShow', { endCoordinates: { screenY: 500, height: 330 } });
  check(visible === true, 'android didShow → visible');
  kb.emit('keyboardDidHide', { endCoordinates: { screenY: 780, height: 0 } });
  check(visible === false, 'android didHide → hidden (the reset RN KAV never does)');
  kb.emit('keyboardDidShow'); kb.emit('keyboardDidShow');
  kb.emit('keyboardDidHide');
  check(visible === false, 'repeated show then one hide → hidden');
  off();
  check(kb.count() === 0, 'unsubscribe removes both listeners');
  kb.emit('keyboardDidShow');
  check(visible === false, 'no updates after unsubscribe');
}

// ── iOS keeps Will* ─────────────────────────────────────────────────────────
{
  const kb = fakeKeyboard();
  let visible = false;
  subscribeKeyboardVisibility(kb, 'ios', v => { visible = v; });
  kb.emit('keyboardWillShow'); check(visible === true, 'ios willShow → visible');
  kb.emit('keyboardWillHide'); check(visible === false, 'ios willHide → hidden');
}

// ── the gate itself ─────────────────────────────────────────────────────────
check(keyboardAvoidEnabled('android', false) === false, 'android + keyboard hidden → KAV disabled (padding forced to 0)');
check(keyboardAvoidEnabled('android', true) === true, 'android + keyboard up → KAV pads');
check(keyboardAvoidEnabled('android', true, false) === false, 'caller base=false wins (node page outside rules tab)');
check(keyboardAvoidEnabled('ios', false) === true, 'ios unchanged: RN resets on keyboardWillHide itself');
check(keyboardAvoidEnabled('web', false) === true, 'web unchanged');
check(keyboardAvoidEnabled('web', false, false) === false, 'web base=false stays off');

// ── model of RN 0.85 KeyboardAvoidingView (behavior="padding") on Android ──
// _relativeKeyboardHeight = max(frame.y + frame.height - (screenY - offset), 0),
// and keyboardDidHide goes through the SAME path (screenY = visible area height,
// ReactRootView.java) — so "hidden" yields whatever that formula gives, not 0.
// render: paddingBottom = enabled ? bottom : 0.
function kavPadding(os: string, events: Array<{ type: 'show' | 'hide'; screenY: number }>, frame = { y: 0, height: 780 }, offset = 24) {
  const kb = fakeKeyboard();
  let visible = false;
  subscribeKeyboardVisibility(kb, os, v => { visible = v; });
  let bottom = 0;
  for (const e of events) {
    bottom = Math.max(frame.y + frame.height - (e.screenY - offset), 0);
    kb.emit(e.type === 'show' ? 'keyboardDidShow' : 'keyboardDidHide');
  }
  return keyboardAvoidEnabled(os, visible) ? bottom : 0;
}
// Hide event read while the visible frame still excludes the IME (the band Vincent saw):
const stale = [{ type: 'show' as const, screenY: 450 }, { type: 'hide' as const, screenY: 450 }];
check(kavPadding('android', stale) === 0, 'after dismiss the chat has NO bottom band even when RN computed a stale padding');
// Even a correct hide event leaves ~offset px in RN (frame is parent-relative, screenY window-relative):
check(kavPadding('android', [{ type: 'show', screenY: 450 }, { type: 'hide', screenY: 780 }]) === 0, 'offset-sized residual also cleared');
check(kavPadding('android', [{ type: 'show', screenY: 450 }]) === 354, 'keyboard up: still lifted by the computed amount');

// ── premise: RN's Android KAV really wires keyboardDidHide to the change handler ──
// If RN ever fixes this upstream, this check goes red and the gate can be revisited.
const kav = readFileSync(new URL('../node_modules/react-native/Libraries/Components/Keyboard/KeyboardAvoidingView.js', import.meta.url), 'utf8');
check(/addListener\('keyboardDidHide', this\._onKeyboardChange\)/.test(kav), 'RN KAV (Android) treats keyboardDidHide as a keyboard-frame change, not a reset');

// ── wiring: every keyboard-avoiding screen that pads on Android is gated ──
const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
const node = readFileSync(new URL('./NodeDetailScreen.tsx', import.meta.url), 'utf8');
const drawer = readFileSync(new URL('./SideThreadDrawer.tsx', import.meta.url), 'utf8');
for (const [name, src] of [['ChatScreen', chat], ['NodeDetailScreen', node], ['SideThreadDrawer', drawer]] as const) {
  check(src.includes('useKeyboardVisible(Keyboard, Platform.OS)'), `${name} tracks keyboard visibility`);
  check(/enabled=\{keyboardAvoidEnabled\(Platform\.OS, keyboardVisible/.test(src), `${name} gates its KeyboardAvoidingView on it`);
}
check(!/keyboardWillHide/.test(node), 'NodeDetailScreen no longer hand-rolls its own listeners');

console.log(`keyboard-visibility: ${ck} checks passed`);
