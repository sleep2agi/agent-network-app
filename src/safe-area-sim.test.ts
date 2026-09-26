// safe-area-sim.ts (web sweep simulation) + the main-window half of modal-safe-area.ts.
// ck style: self-executing, exit 1 on any failure.
import { parseSafeAreaSim } from './safe-area-sim';
import { mainWindowTopPadding, modalSafePadding, withBasePadding } from './modal-safe-area';

let pass = 0;
const failures: string[] = [];
const ck = (name: string, ok: boolean, extra = '') => {
  if (ok) pass++; else failures.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`);
};
const J = JSON.stringify;

// ── simulation parser ──
ck('sim: top,right,bottom,left', J(parseSafeAreaSim('?safeAreaSim=32,0,24,40')) === J({ top: 32, right: 0, bottom: 24, left: 40 }));
ck('sim: absent → null (devices and normal web never simulate)', parseSafeAreaSim('?osFontScale=1.3') === null && parseSafeAreaSim('') === null && parseSafeAreaSim(undefined) === null);
ck('sim: wrong arity → null', parseSafeAreaSim('?safeAreaSim=32,0,24') === null);
ck('sim: junk / negative / absurd → null', parseSafeAreaSim('?safeAreaSim=a,0,0,0') === null && parseSafeAreaSim('?safeAreaSim=-1,0,0,0') === null && parseSafeAreaSim('?safeAreaSim=999,0,0,0') === null);

// ── rule 1: the main window pads the status bar once, at the root ──
ck('main: android pads the safe-area top', mainWindowTopPadding('android', { top: 32 }, 24) === 32);
ck('main: android falls back to StatusBar.currentHeight when the context reads 0', mainWindowTopPadding('android', { top: 0 }, 38) === 38);
ck('main: ios 0 (the root SafeAreaView pads it — a second pad here would double it)', mainWindowTopPadding('ios', { top: 47 }, null) === 0);
ck('main: web / desktop 0 (title strips own the top)', mainWindowTopPadding('web', { top: 32 }, 32) === 0);
ck('main == fullscreen modal top on android (one table, same number)', mainWindowTopPadding('android', { top: 30 }, 33) === modalSafePadding('android', 'fullScreen', { top: 30 }, 33).paddingTop);

// ── dialogs: inset + own margin, never inset instead of margin ──
const p = modalSafePadding('android', 'fullScreen', { top: 32, right: 0, bottom: 24, left: 40 }, 32);
ck('base: adds per edge', J(withBasePadding(p, 24)) === J({ paddingTop: 56, paddingRight: 24, paddingBottom: 48, paddingLeft: 64 }));
ck('base: zero inset keeps the margin (web)', J(withBasePadding(modalSafePadding('web', 'fullScreen', { top: 32 }, 32), 20)) === J({ paddingTop: 20, paddingRight: 20, paddingBottom: 20, paddingLeft: 20 }));

console.log(`\n${pass}/${pass + failures.length} passed`);
if (failures.length) { console.error(`FAILED: ${failures.join('; ')}`); process.exit(1); }
