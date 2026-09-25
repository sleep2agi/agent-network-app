// Two-pane divider drag (0.2.106) — run: bun src/pane-divider.test.ts
//
// Drives the PanResponder handler set directly (no React). Pins: finger-sized strip; the
// grip shows on press; the panes re-lay out once, on release; clamps; values read at
// press time (the handlers are created once); interruption; web selection lock.

import {
  DIVIDER_A11Y_STEP, DIVIDER_HIT_OVER_LIST, DIVIDER_HIT_WIDTH, dividerDragHandlers, dividerHitLeft, dividerStep,
} from './pane-divider';
import { AGENT_ROW_PAD_X } from './agent-row-model';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n} ${extra}`); };

// ── the strip ──
ck('touch strip is 24–32 dp wide', DIVIDER_HIT_WIDTH >= 24 && DIVIDER_HIT_WIDTH <= 32, String(DIVIDER_HIT_WIDTH));
ck('strip straddles the line (some over each pane)', DIVIDER_HIT_OVER_LIST > 0 && DIVIDER_HIT_OVER_LIST < DIVIDER_HIT_WIDTH);
ck('strip over the list ≤ row side padding (never covers row content)', DIVIDER_HIT_OVER_LIST <= AGENT_ROW_PAD_X);
ck('strip left edge follows the list width', dividerHitLeft(320) === 320 - DIVIDER_HIT_OVER_LIST && dividerHitLeft(400) === 400 - DIVIDER_HIT_OVER_LIST);

// ── a harness around one handler set ──
function harness(initial = 320, area = 1128) {
  const log: string[] = [];
  const st = { width: initial, area, preview: null as number | null, commits: [] as number[], locked: 0, unlocked: 0 };
  const h = dividerDragHandlers({
    getWidth: () => st.width,
    getArea: () => st.area,
    setPreview: w => { st.preview = w; log.push(`preview:${w}`); },
    commit: w => { st.commits.push(w); st.width = w; log.push(`commit:${w}`); },
    lockSelection: () => { st.locked++; return () => { st.unlocked++; }; },
  });
  return { h, st, log };
}

{
  const { h, st, log } = harness();
  let prevented = 0;
  const ev = { preventDefault: () => { prevented++; } };
  ck('claims the responder on press and on move', h.onStartShouldSetPanResponder(ev) === true && h.onMoveShouldSetPanResponder(ev) === true);
  ck('press preventDefaults (web: no text selection starts)', prevented === 2);
  ck('refuses to hand the gesture to the list ScrollView mid-drag', h.onPanResponderTerminationRequest() === false);
  ck('blocks the native responder', h.onShouldBlockNativeResponder() === true);
  h.onPanResponderGrant(ev);
  ck('grip shows on press, before any move (preview = current width)', st.preview === 320);
  ck('selection locked for the drag', st.locked === 1 && st.unlocked === 0);
  h.onPanResponderMove(ev, { dx: 30 });
  h.onPanResponderMove(ev, { dx: 55 });
  ck('moves update only the preview — no commit while dragging', st.preview === 375 && st.commits.length === 0);
  h.onPanResponderMove(ev, { dx: 999 });
  ck('preview clamps to 420', st.preview === 420);
  h.onPanResponderMove(ev, { dx: -999 });
  ck('preview clamps to 260', st.preview === 260);
  h.onPanResponderRelease(ev, { dx: -20 });
  ck('release commits exactly once, at start + dx', st.commits.length === 1 && st.commits[0] === 300, JSON.stringify(st.commits));
  ck('release hides the grip and unlocks selection', st.preview === null && st.unlocked === 1);
  ck('order: preview… then clear preview, then commit', log.slice(-2).join(',') === 'preview:null,commit:300', log.join(','));
  h.onPanResponderRelease(ev, { dx: 50 });
  h.onPanResponderTerminate();
  ck('a stray release / terminate after the drag commits nothing more', st.commits.length === 1);
}

{
  // Created once, used many times: the start width must be read at press, not at creation.
  const { h, st } = harness(320);
  st.width = 380;               // e.g. restored from storage after the PanResponder was created
  h.onPanResponderGrant();
  h.onPanResponderMove(undefined, { dx: 10 });
  ck('start width is read at press time (380 + 10)', st.preview === 390);
  st.area = 700;                // window resized mid-drag (fold): max becomes 700 − 320 = 380
  h.onPanResponderMove(undefined, { dx: 10 });
  ck('area is re-read on each move', st.preview === 380);
}

{
  // Interrupted (system gesture / call): the divider stays where the finger left it, not at the start.
  const { h, st } = harness(320);
  h.onPanResponderGrant();
  h.onPanResponderMove(undefined, { dx: 25 });
  h.onPanResponderTerminate();
  ck('interrupted drag commits where the divider was last shown (345, not the start 320)', st.commits.length === 1 && st.commits[0] === 345 && st.preview === null && st.unlocked === 1, JSON.stringify(st.commits));
}

{
  // A saved width wider than this area allows: the drag starts from what is on screen.
  const { h, st } = harness(420, 628);   // 700-wide window beside the rail → max 308
  h.onPanResponderGrant();
  ck('drag starts from the clamped on-screen width, not the saved one', st.preview === 308);
  h.onPanResponderRelease(undefined, { dx: 0 });
  ck('a tap without movement commits the on-screen width', st.commits[0] === 308);
}

{
  const { h, st } = harness();
  h.onPanResponderMove(undefined, { dx: 40 });
  h.onPanResponderRelease(undefined, { dx: 40 });
  ck('move / release without a grant do nothing', st.preview === null && st.commits.length === 0);
}

{
  // No lockSelection on native.
  const h = dividerDragHandlers({ getWidth: () => 320, getArea: () => 1128, setPreview: () => {}, commit: () => {} });
  let threw = false;
  try { h.onPanResponderGrant(); h.onPanResponderMove(undefined, { dx: 5 }); h.onPanResponderRelease(undefined, { dx: 5 }); } catch { threw = true; }
  ck('works without a selection lock (native)', !threw);
}

// ── TalkBack / keyboard steps ──
ck('increment widens by one step', dividerStep(320, 1128, 'increment') === 320 + DIVIDER_A11Y_STEP);
ck('decrement narrows by one step', dividerStep(320, 1128, 'decrement') === 320 - DIVIDER_A11Y_STEP);
ck('steps clamp', dividerStep(420, 1128, 'increment') === 420 && dividerStep(260, 1128, 'decrement') === 260);

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
