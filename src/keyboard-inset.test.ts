// #547 — the iOS keyboard covered the chat composer (Chinese 9-key + candidate bar).
// ck-style: models the phone layout in window coordinates and asserts, for several keyboard heights
// (incl. a height change while the keyboard is up), that the composer's bottom edge lands on the
// keyboard's top edge within ±2 px. The old formula (RN KAV, offset 0, nested under the nav shell) is
// evaluated on the same layouts and must be RED — that is the witness.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const { keyboardInsetEvents, keyboardOverlap, rnKavPadding, subscribeKeyboardInset } = await import('./keyboard-inset');

let ck = 0;
const check = (cond: boolean, msg: string) => { assert.ok(cond, msg); ck++; };

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

// ── the phone layout (App.tsx): SafeAreaView(insets) > navShell > navContent > chat KAV ──
// iOS RN SafeAreaView pads the window by the safe-area insets; the chat KAV is the first child of navContent,
// so its onLayout frame is { y: 0, height: window - top - bottom } while it really starts at window y = top.
type Device = { name: string; h: number; top: number; bottom: number };
const DEVICES: Device[] = [
  { name: 'iPhone 14 portrait (screenshot)', h: 844, top: 47, bottom: 34 },
  { name: 'iPhone 16 Pro portrait', h: 874, top: 62, bottom: 34 },
  { name: 'iPhone SE portrait (no home indicator)', h: 667, top: 20, bottom: 0 },
  { name: 'iPhone 14 landscape', h: 390, top: 0, bottom: 21 },
];
// Keyboard heights incl. the home-indicator strip, as iOS reports them in endCoordinates.height.
// 9-key with candidates (screenshot), English QWERTY with predictive bar, emoji keyboard, and a mid-way change.
const PORTRAIT_HEIGHTS = [380, 336, 291, 346];
const LANDSCAPE_HEIGHTS = [200, 172, 230];

const kbFrame = (d: Device, height: number) => ({ screenY: d.h - height, height });
const kavFrame = (d: Device) => ({ y: 0, height: d.h - d.top - d.bottom });   // what onLayout reports (parent-relative)
const kavBottomInWindow = (d: Device) => d.top + kavFrame(d).height;        // what measureInWindow reports

/** Composer bottom in window coordinates = the screen's bottom edge minus the bottom padding. */
const composerBottom = (d: Device, padding: number) => kavBottomInWindow(d) - padding;
const NEAR = 2;

let oldRed = 0;
for (const d of DEVICES) {
  const heights = d.h < 500 ? LANDSCAPE_HEIGHTS : PORTRAIT_HEIGHTS;
  for (const height of heights) {
    const kb = kbFrame(d, height);
    const fixed = composerBottom(d, keyboardOverlap(kavBottomInWindow(d), kb));
    check(Math.abs(fixed - kb.screenY) <= NEAR, `${d.name} kb ${height}: composer bottom ${fixed} == keyboard top ${kb.screenY}`);
    // old: RN KAV, keyboardVerticalOffset 0 on iOS, frame parent-relative under the nav shell
    const old = composerBottom(d, rnKavPadding(kavFrame(d).y, kavFrame(d).height, kb.screenY, 0));
    if (Math.abs(old - kb.screenY) > NEAR) oldRed++;
    if (d.top > NEAR) check(old - kb.screenY === d.top, `${d.name} kb ${height}: old code leaves the composer ${d.top}pt (= top inset) under the keyboard (got ${old - kb.screenY})`);
    // why it used to work: before #381 the KAV was the SafeAreaView's direct child, frame.y == top inset
    const pre381 = composerBottom(d, rnKavPadding(d.top, kavFrame(d).height, kb.screenY, 0));
    check(Math.abs(pre381 - kb.screenY) <= NEAR, `${d.name} kb ${height}: pre-#381 nesting was correct`);
  }
}
check(oldRed >= 10, `witness: the old formula is red on ${oldRed} device×height cases`);

// ── keyboardOverlap edge cases ──
check(keyboardOverlap(810, null) === 0, 'no frame → 0');
check(keyboardOverlap(810, { screenY: 844, height: 336 }) === 0, 'keyboard off-screen (willChangeFrame on hide) → 0');
check(keyboardOverlap(810, { screenY: 500, height: 0 }) === 0, 'zero-height frame → 0');
check(keyboardOverlap(Number.NaN, { screenY: 500, height: 344 }) === 0, 'unmeasurable view → 0, never NaN');
check(keyboardOverlap(810.4, { screenY: 464, height: 380 }) === 346, 'rounded to whole points');
check(keyboardOverlap(810, { screenY: 464, height: 380 }, 844) === 346, 'docked keyboard (bottom == window bottom) counts');
check(keyboardOverlap(1300, { screenY: 700, height: 260 }, 1366) === 0, 'iPad floating / undocked keyboard (not at the bottom edge) → 0');
check(keyboardOverlap(810, { screenY: 464, height: 380 }, 0) === 346, 'unknown window height → no docking filter');

// ── events: iOS follows keyboardWillChangeFrame; RN KAV on iOS does not ──
const ios = keyboardInsetEvents('ios')!;
check(ios.change.includes('keyboardWillChangeFrame'), 'iOS listens to keyboardWillChangeFrame (candidate bar / IME switch / emoji)');
check(ios.change.includes('keyboardWillShow') && ios.hide === 'keyboardWillHide', 'iOS show/hide');
check(keyboardInsetEvents('android') === null, 'Android: not handled here (RN KAV + keyboard-visibility gate stay)');
check(keyboardInsetEvents('web') === null && keyboardInsetEvents('windows') === null, 'desktop / web: nothing');
const kav = readFileSync(new URL('../node_modules/react-native/Libraries/Components/Keyboard/KeyboardAvoidingView.js', import.meta.url), 'utf8');
check(!kav.includes("'keyboardWillChangeFrame'"), 'premise: RN KAV (iOS) never listens to keyboardWillChangeFrame — so it cannot follow a height change by itself');
check(/keyboardFrame\.screenY - \(this\.props\.keyboardVerticalOffset \?\? 0\)/.test(kav) && /frame\.y \+ frame\.height - keyboardY/.test(kav), 'premise: RN KAV mixes onLayout (parent-relative) with screenY (window) — rnKavPadding models it');

// ── subscription: a whole session on iPhone 14, the composer tracks every frame ──
{
  const d = DEVICES[0];
  const kb = fakeKeyboard();
  let inset = -1;
  const seen: number[] = [];
  const stop = subscribeKeyboardInset(kb, 'ios', cb => cb(kavBottomInWindow(d)), v => { inset = v; seen.push(v); }, () => d.h);
  check(kb.count() === 3, 'iOS subscribes show + changeFrame + hide');
  const step = (event: string, height: number) => {
    kb.emit(event, { endCoordinates: kbFrame(d, height), duration: 250, easing: 'keyboard' });
    const bottom = composerBottom(d, inset);
    const top = height > 0 ? d.h - height : kavBottomInWindow(d);
    check(Math.abs(bottom - top) <= NEAR, `session ${event} ${height}: composer bottom ${bottom} vs keyboard top ${top}`);
  };
  step('keyboardWillShow', 336);         // English with predictive bar
  step('keyboardWillChangeFrame', 380);  // switch to 9-key: candidate bar appears, keyboard grows mid-way
  step('keyboardWillChangeFrame', 346);  // candidates collapse a bit
  step('keyboardWillShow', 291);         // emoji / plain keyboard (iOS may re-post willShow)
  kb.emit('keyboardWillHide', { endCoordinates: { screenY: d.h, height: 336 } });
  check(inset === 0, 'hide → 0 (composer back on the home-indicator safe area)');
  stop();
  check(kb.count() === 0, 'unsubscribes everything');
  check(seen.length === 5, 'one update per event');
}

// ── a slow measure for an older frame never lands after a newer one / after hide ──
{
  const kb = fakeKeyboard();
  const pending: Array<() => void> = [];
  let inset = 0;
  subscribeKeyboardInset(kb, 'ios', cb => { pending.push(() => cb(810)); }, v => { inset = v; });
  kb.emit('keyboardWillShow', { endCoordinates: { screenY: 508, height: 336 } });
  kb.emit('keyboardWillHide', { endCoordinates: { screenY: 844, height: 336 } });
  check(inset === 0, 'hide applied');
  pending.shift()!();
  check(inset === 0, 'stale measure after hide is dropped');
  kb.emit('keyboardWillShow', { endCoordinates: { screenY: 508, height: 336 } });
  kb.emit('keyboardWillChangeFrame', { endCoordinates: { screenY: 464, height: 380 } });
  pending[1]!(); // the newer one resolves first
  pending[0]!();
  check(inset === 346, 'newest frame wins even when an older measure resolves later');
}

// ── Android / web: no listeners at all (RN KAV path untouched) ──
for (const os of ['android', 'web']) {
  const kb = fakeKeyboard();
  subscribeKeyboardInset(kb, os, cb => cb(810), () => { throw new Error('must not fire'); });
  check(kb.count() === 0, `${os}: no keyboard listeners from keyboard-inset`);
}

// ── wiring: every phone screen that hosts a bottom composer / editor uses it ──
for (const name of ['ChatScreen', 'DmChatScreen', 'NodeDetailScreen']) {
  const src = readFileSync(new URL(`./${name}.tsx`, import.meta.url), 'utf8');
  check(src.includes('useScreenKeyboardInset()'), `${name} measures its iOS keyboard inset`);
  check(src.includes('{iosKeyboard.probe}'), `${name} renders the window-coordinate probe`);
  check(src.includes("behavior={iosKeyboard.handled ? undefined : 'padding'}"), `${name}: RN KAV padding is off where the inset is ours (no double padding)`);
  check(/style=\{\[styles\.root, [^\]]*iosKeyboard\.style/.test(src), `${name} applies the inset to its root`);
}

console.log(`keyboard-inset: ${ck}/${ck} passed`);
