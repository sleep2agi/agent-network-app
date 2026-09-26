// 更紧凑 list ↔ nav rail alignment (list-rail-align.ts) and the per-density row geometry
// (agent-row-model.ts agentRowGeometry). ck style: self-executing, exit 1 on any failure.
import { AGENT_ROW_DENSER, agentRowGeometry } from './agent-row-model';
import { __resetListFirstRowTop, alignedRailLayout, denserRowPitch, listFirstRowTop, onListFirstRowTopChange, publishListFirstRowTop } from './list-rail-align';
import { __resetUiScale, ds, setUiScalePrefs, uiScale, type DensityPref } from './ui-scale';
import { spacing } from './theme';

let pass = 0;
const failures: string[] = [];
const ck = (name: string, ok: boolean, extra = '') => {
  if (ok) pass++; else failures.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`);
};
const J = JSON.stringify;

// ── 1. 紧凑 / 标准 / 宽松 render exactly what they did before 更紧凑 got its own table ──
// (the old AgentsScreen styles: ds(68, 44) / ds(44) / ds(12) / ds(16) / ds(8) / ds(12) / ds(3) /
// ds(20) / spacing.md / spacing.xs — compared against the live ds() and spacing here)
for (const d of ['compact', 'standard', 'comfortable'] as DensityPref[]) {
  __resetUiScale();
  setUiScalePrefs({ density: d });
  const g = agentRowGeometry(uiScale().listDense, uiScale().densityFactor);
  const old = { height: ds(68, 44), avatar: ds(44), dot: ds(12), padX: ds(16), padY: ds(8), gap: ds(12), bodyGap: ds(3), lineMin: ds(20), groupPadTop: spacing.md, groupPadBottom: spacing.xs, separatorOverlap: false };
  ck(`${d}: geometry unchanged from the ds()/spacing formulas`, J(g) === J(old), J(g));
}
ck('标准 numbers: 68 row / 44 avatar / 16 pad / 12 gap', J(agentRowGeometry(false, 1)) === J({ height: 68, avatar: 44, dot: 12, padX: 16, padY: 8, gap: 12, bodyGap: 3, lineMin: 20, groupPadTop: 12, groupPadBottom: 4, separatorOverlap: false }));
ck('紧凑 numbers: 58 row / 37 avatar', agentRowGeometry(false, 0.85).height === 58 && agentRowGeometry(false, 0.85).avatar === 37);

// ── 2. 更紧凑: the rail's scale family ──
__resetUiScale();
setUiScalePrefs({ density: 'denser' });
const gd = agentRowGeometry(uiScale().listDense, uiScale().densityFactor);
ck('更紧凑 uses its own table (not 0.75 × 标准)', uiScale().listDense && gd.avatar === AGENT_ROW_DENSER.avatar && gd.avatar !== ds(44), J(gd));
ck('更紧凑 avatar 26–28 dp (rail-icon scale)', gd.avatar >= 26 && gd.avatar <= 28, String(gd.avatar));
ck('更紧凑 row min = 44 dp touch target, tight padding (4 / 12)', gd.height === 44 && gd.padY === 4 && gd.padX === 12);
ck('更紧凑 separator overlaps (pitch == row height)', gd.separatorOverlap === true);

// ── 3. one pitch, shared by list rows and rail items ──
ck('pitch at OS 1.0 = 44: two lines (18 + 16) + 2 + 2 × 4 fill the touch target exactly', denserRowPitch(1) === 44);
ck('pitch at OS 1.15 = 49.1 (what the harness measured for a row)', denserRowPitch(1.15) === 49.1, String(denserRowPitch(1.15)));
ck('pitch never below 44 (small OS font 0.85)', denserRowPitch(0.85) === 44);
ck('pitch follows 特大 (1.3 → 54.2)', denserRowPitch(1.3) === 54.2, String(denserRowPitch(1.3)));
ck('garbage multiplier reads as 1', denserRowPitch(Number.NaN) === 44 && denserRowPitch(-1) === 44);

// ── 4. rail layout ──
const a = alignedRailLayout(66, 44, 39);
ck('rail starts at the first row: padding = firstRowTop − brand block (66 − 39 = 27)', a?.tabsPaddingTop === 27 && a?.aligned === true, J(a));
ck('rail items are one pitch tall with no gap', a?.itemHeight === 44 && a?.gap === 0);
const b = alignedRailLayout(68, denserRowPitch(1.15), 39)!;
ck('rail item n top == list row n top for n = 0..2 (OS 1.15)', [0, 1, 2].every(n => Math.abs((39 + b.tabsPaddingTop + n * (b.itemHeight + b.gap)) - (68 + n * denserRowPitch(1.15))) < 0.01), J(b));
const c = alignedRailLayout(20, 44, 39)!;
ck('brand taller than the list head: rail stays under the brand, reported as not aligned', c.tabsPaddingTop === 0 && c.aligned === false, J(c));
ck('nothing laid out yet → null (ordinary rail)', alignedRailLayout(null, 44, 39) === null && alignedRailLayout(Number.NaN, 44, 39) === null && alignedRailLayout(60, 0, 39) === null);

// ── 5. the store: publish / dedupe / listeners ──
__resetListFirstRowTop();
let fired = 0;
const off = onListFirstRowTopChange(() => { fired++; });
ck('empty store → null', listFirstRowTop() === null);
publishListFirstRowTop(66);
ck('publish → value + one notification', listFirstRowTop() === 66 && fired === 1);
publishListFirstRowTop(66.3);
ck('jitter < 0.5 dp is not a change', listFirstRowTop() === 66 && fired === 1);
publishListFirstRowTop(68);
ck('a real change notifies', listFirstRowTop() === 68 && fired === 2);
publishListFirstRowTop(Number.NaN); publishListFirstRowTop(-5);
ck('invalid values are ignored', listFirstRowTop() === 68 && fired === 2);
off();
__resetListFirstRowTop();
__resetUiScale();

console.log(`\nlist-rail-align: ${pass}/${pass + failures.length} passed`);
if (failures.length) { for (const f of failures) console.error('FAIL:', f); process.exit(1); }
