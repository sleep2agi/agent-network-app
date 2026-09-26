// 字体大小 / 界面密度 model (src/ui-scale.ts). ck style: self-executing, exit 1 on any failure.
import {
  DEFAULT_FONT_SIZE,
  DENSITY_OPTIONS,
  DENSE_FONT_CAP,
  FONT_MULTIPLIER_MAX,
  OS_FONT_SCALE_MAX,
  RN_DEFAULT_FONT_SIZE,
  __resetUiScale,
  defaultDensity,
  densityFactor,
  ds,
  fontMultiplier,
  fs,
  LIST_TEXT_DENSER,
  LIST_TEXT_REGULAR,
  listText,
  listTextFor,
  onUiScaleChange,
  parseStoredUiScale,
  parseUiScaleSim,
  scaleTextStyle,
  scaledSpacing,
  serializeUiScale,
  setOsFontScale,
  setUiScaleLayoutWide,
  setUiScaleLegacySim,
  setUiScalePrefs,
  uiScale,
  uiScaleKey,
  uiScaleSummary,
} from './ui-scale';
import { SPACING_BASE, onThemeChange, spacing } from './theme';
import { mobileRailItem, mobileRailWidth, contentWidthBesideRail, MOBILE_RAIL_WIDTH } from './nav-chrome';

let pass = 0;
const failures: string[] = [];
const ck = (name: string, ok: boolean, extra = '') => {
  if (ok) pass++; else failures.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`);
};
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

// ── 1. font multiplier: in-app choice × OS scale ──
ck('标准 at OS 1.0 = 1', fontMultiplier('standard', 1) === 1);
ck('小 = 0.9 / 大 = 1.15 / 特大 = 1.3 at OS 1.0',
  near(fontMultiplier('small', 1), 0.9) && near(fontMultiplier('large', 1), 1.15) && near(fontMultiplier('xlarge', 1), 1.3));
ck('OS scale multiplies (标准 × 1.1 = 1.1)', near(fontMultiplier('standard', 1.1), 1.1));
ck('OS scale above 1.15 is capped (标准 × 1.3 → 1.15)', near(fontMultiplier('standard', 1.3), OS_FONT_SCALE_MAX), String(fontMultiplier('standard', 1.3)));
ck('OS cap still applies on top of 大 (1.15 × 1.3 → 1.15 × 1.15)', Math.abs(fontMultiplier('large', 1.3) - 1.15 * 1.15) < 0.001, String(fontMultiplier('large', 1.3)));
ck('total never exceeds FONT_MULTIPLIER_MAX (特大 × 2.0)', fontMultiplier('xlarge', 2) <= FONT_MULTIPLIER_MAX, String(fontMultiplier('xlarge', 2)));
ck('small OS scale honoured down to 0.85', near(fontMultiplier('standard', 0.85), 0.85) && near(fontMultiplier('standard', 0.5), 0.85));
ck('garbage OS scale reads as 1', fontMultiplier('standard', Number.NaN) === 1 && fontMultiplier('standard', -3) === 1 && fontMultiplier('standard', 0) === 1);
ck('dense: OS cannot push past DENSE_FONT_CAP (大 × 1.3 → 1.2)', near(fontMultiplier('large', 1.3, true), DENSE_FONT_CAP), String(fontMultiplier('large', 1.3, true)));
ck('dense: the user\'s own 特大 is still honoured (1.3, not 1.2)', near(fontMultiplier('xlarge', 1.0, true), 1.3));
ck('dense: 特大 × OS 1.3 → 1.3 (OS extra dropped, choice kept)', near(fontMultiplier('xlarge', 1.3, true), 1.3), String(fontMultiplier('xlarge', 1.3, true)));
ck('dense == normal when nothing is capped', fontMultiplier('standard', 1.1, true) === fontMultiplier('standard', 1.1));

// ── 2. density ──
ck('density factors 0.75 / 0.85 / 1 / 1.15', densityFactor('denser') === 0.75 && densityFactor('compact') === 0.85 && densityFactor('standard') === 1 && densityFactor('comfortable') === 1.15);
ck('default density: phone/desktop 标准, Android wide 更紧凑', defaultDensity(false) === 'standard' && defaultDensity(true) === 'denser');
ck('4 density options in order 更紧凑 / 紧凑 / 标准 / 宽松', DENSITY_OPTIONS.map(o => o.label).join('/') === '更紧凑/紧凑/标准/宽松' && DENSITY_OPTIONS.every(o => o.factor === densityFactor(o.key)));
ck('list text: 紧凑 / 标准 / 宽松 keep 16 / 14 / 12 / 11 / rail 11', (['compact', 'standard', 'comfortable'] as const).every(d => listTextFor(d, 'name').fontSize === 16 && listTextFor(d, 'preview').fontSize === 14 && listTextFor(d, 'meta').fontSize === 12 && listTextFor(d, 'count').fontSize === 11 && listTextFor(d, 'railLabel').fontSize === 11 && listTextFor(d, 'name').lineHeight === undefined));
ck('list text: 更紧凑 = name 14/18, preview 12/16', JSON.stringify(listTextFor('denser', 'name')) === '{"fontSize":14,"lineHeight":18}' && JSON.stringify(listTextFor('denser', 'preview')) === '{"fontSize":12,"lineHeight":16}');
ck('list text: 更紧凑 time / group header = the rail label size (10)', listTextFor('denser', 'meta').fontSize === listTextFor('denser', 'railLabel').fontSize && listTextFor('denser', 'count').fontSize === listTextFor('denser', 'railLabel').fontSize && listTextFor('denser', 'railLabel').fontSize === 10);
ck('list text: returned styles are copies (callers cannot mutate the table)', (() => { const x = listTextFor('denser', 'name'); x.fontSize = 99; return LIST_TEXT_DENSER.name.fontSize === 14 && LIST_TEXT_REGULAR.name.fontSize === 16; })());
ck('scaled spacing at 0.75 (4,8,12,16,24 → 3,6,9,12,18)', JSON.stringify(scaledSpacing(0.75)) === JSON.stringify({ xs: 3, sm: 6, md: 9, lg: 12, xl: 18 }), JSON.stringify(scaledSpacing(0.75)));
ck('rail: 更紧凑 56 / 48×48 (touch floor)', mobileRailWidth(0.75) === 56 && mobileRailItem(0.75).width === 48 && mobileRailItem(0.75).height === 48, JSON.stringify([mobileRailWidth(0.75), mobileRailItem(0.75)]));
ck('default font: 标准', DEFAULT_FONT_SIZE === 'standard');
ck('scaled spacing at 1 is the base', JSON.stringify(scaledSpacing(1)) === JSON.stringify(SPACING_BASE));
ck('scaled spacing at 0.85 rounds (4,8,12,16,24 → 3,7,10,14,20)', JSON.stringify(scaledSpacing(0.85)) === JSON.stringify({ xs: 3, sm: 7, md: 10, lg: 14, xl: 20 }), JSON.stringify(scaledSpacing(0.85)));
ck('rail: 标准 72 / 64×56', mobileRailWidth(1) === 72 && mobileRailItem(1).width === 64 && mobileRailItem(1).height === 56 && mobileRailWidth(1) === MOBILE_RAIL_WIDTH);
ck('rail: 紧凑 62 / 54×48 (touch floor 48)', mobileRailWidth(0.85) === 62 && mobileRailItem(0.85).width === 54 && mobileRailItem(0.85).height === 48, JSON.stringify([mobileRailWidth(0.85), mobileRailItem(0.85)]));
ck('rail: item never below 48 even at an absurd density', mobileRailItem(0.3).width === 48 && mobileRailItem(0.3).height === 48);
ck('rail: 宽松 83 / 74×64', mobileRailWidth(1.15) === 83 && mobileRailItem(1.15).width === 74 && mobileRailItem(1.15).height === 64);
ck('content beside rail uses the given rail width', contentWidthBesideRail(1200, 0, 0, 62) === 1138 && contentWidthBesideRail(1200) === 1200 - 72);

// ── 3. persistence + migration ──
ck('nothing stored (every install before this setting) → never chosen', JSON.stringify(parseStoredUiScale(null)) === '{"font":null,"density":null}');
ck('empty string → never chosen', parseStoredUiScale('').font === null);
ck('garbage JSON → never chosen', parseStoredUiScale('{not json').density === null);
ck('更紧凑 persists and reads back', parseStoredUiScale(serializeUiScale({ font: null, density: 'denser' })).density === 'denser');
ck('unknown values → never chosen per field', JSON.stringify(parseStoredUiScale('{"font":"huge","density":"compact"}')) === '{"font":null,"density":"compact"}');
ck('non-object JSON → never chosen', parseStoredUiScale('42').font === null && parseStoredUiScale('null').font === null);
const round = parseStoredUiScale(serializeUiScale({ font: 'large', density: 'comfortable' }));
ck('round-trip', round.font === 'large' && round.density === 'comfortable');
ck('reset serialises to nulls (reads back as defaults)', JSON.stringify(parseStoredUiScale(serializeUiScale({ font: null, density: null }))) === '{"font":null,"density":null}');

// ── 4. text style scaling (what src/ui-text.tsx applies) ──
ck('m=1 returns the same object (no allocation on the default path)', (() => { const s = { fontSize: 12 }; return scaleTextStyle(s, 1, false) === s; })());
ck('fontSize and lineHeight scale together', JSON.stringify(scaleTextStyle({ fontSize: 14, lineHeight: 20, color: 'x' }, 1.15, false)) === JSON.stringify({ fontSize: 16.1, lineHeight: 23, color: 'x' }));
ck('top-level text with no fontSize gets RN default × m', scaleTextStyle({ color: 'x' }, 1.3, false)?.fontSize === Math.round(RN_DEFAULT_FONT_SIZE * 1.3 * 10) / 10);
ck('nested text with no fontSize inherits (no second scale)', scaleTextStyle({ color: 'x' }, 1.3, true)?.fontSize === undefined);
ck('nested text with its own fontSize scales once', scaleTextStyle({ fontSize: 10 }, 1.3, true)?.fontSize === 13);
ck('undefined style at top level still gets a size', scaleTextStyle(undefined, 0.9, false)?.fontSize === 12.6);

// ── 5. web simulation parser ──
ck('sim: osFontScale parsed', parseUiScaleSim('?osFontScale=1.3').osFontScale === 1.3);
ck('sim: legacy flag', parseUiScaleSim('?uiScaleSim=legacy&osFontScale=1.3').legacy === true);
ck('sim: absent/garbage ignored', parseUiScaleSim('').osFontScale === null && parseUiScaleSim('?osFontScale=abc').osFontScale === null && parseUiScaleSim('?osFontScale=99').osFontScale === null);

// ── 6. live state: defaults follow the layout, spacing mutates in place, restyle + listeners fire ──
__resetUiScale();
let restyles = 0; let changes = 0;
const offTheme = onThemeChange(() => { restyles++; });
const offScale = onUiScaleChange(() => { changes++; });
const spacingRef = spacing;
ck('fresh state: 标准 / 标准, key stable', uiScale().font === 'standard' && uiScale().density === 'standard' && uiScale().fontIsDefault && uiScale().densityIsDefault);
const k0 = uiScaleKey();
setUiScaleLayoutWide(true);
ck('wide with nothing stored → 更紧凑 default', uiScale().density === 'denser' && uiScale().densityIsDefault);
ck('spacing mutated in place (same object, md 12 → 9)', spacing === spacingRef && spacing.md === 9, String(spacing.md));
ck('ds() follows (44 → 33, row 68 → 51)', ds(44) === 33 && ds(68) === 51);
ck('ds() floor keeps touch targets (48 → max(36, 44))', ds(48, 44) === 44);
ck('live list text at the 更紧凑 default: 14 / 12 / 10', listText('name').fontSize === 14 && listText('preview').fontSize === 12 && listText('meta').fontSize === 10 && uiScale().listDense);
ck('restyle + change listeners fired once', restyles === 1 && changes === 1, `${restyles}/${changes}`);
ck('key changed', uiScaleKey() !== k0);
setUiScaleLayoutWide(true);
ck('same input again → no restyle, no change', restyles === 1 && changes === 1);
setUiScaleLayoutWide(false);
ck('fold back to phone with nothing stored → 标准 again', uiScale().density === 'standard' && spacing.md === 12 && listText('name').fontSize === 16 && !uiScale().listDense);
setUiScalePrefs({ density: 'compact' });
setUiScaleLayoutWide(true); setUiScaleLayoutWide(false);
ck('an explicit choice survives fold/unfold', uiScale().density === 'compact' && !uiScale().densityIsDefault);
ck('紧凑 keeps the list text size (only 更紧凑 changes it)', listText('name').fontSize === 16 && listText('meta').fontSize === 12 && ds(44) === 37 && !uiScale().listDense);
setUiScalePrefs({ font: 'xlarge' });
ck('font choice: multiplier 1.3, fs(10) = 13', uiScale().fontMultiplier === 1.3 && fs(10) === 13);
setUiScalePrefs({ font: null, density: null });
ck('reset → defaults again', uiScale().fontIsDefault && uiScale().densityIsDefault && uiScale().fontMultiplier === 1);
setOsFontScale(1.3);
ck('OS 1.3 at defaults → 1.15 / dense 1.15', uiScale().fontMultiplier === 1.15 && uiScale().denseFontMultiplier === 1.15);
setUiScaleLegacySim(true);
ck('legacy sim: raw OS scale, uncapped, no density', uiScale().fontMultiplier === 1.3 && uiScale().densityFactor === 1);
setUiScaleLegacySim(false);
const sum = uiScaleSummary(uiScale(), true);
ck('summary says 宽屏默认 on wide with nothing stored', sum.density === '标准（默认）' || sum.density.includes('默认'), sum.density);
setUiScaleLayoutWide(true);
ck('summary: 更紧凑（宽屏默认）', uiScaleSummary(uiScale(), true).density === '更紧凑（宽屏默认）', uiScaleSummary(uiScale(), true).density);
ck('summary: OS note explains the cap', (uiScaleSummary(uiScale(), true).osNote ?? '').includes('只计入 ×1.15'));
setOsFontScale(1);
ck('summary: no OS note at 1.0', uiScaleSummary(uiScale(), true).osNote === null);
offTheme(); offScale();
__resetUiScale();

console.log(`\nui-scale: ${pass}/${pass + failures.length} passed`);
if (failures.length) { for (const f of failures) console.error('FAIL:', f); process.exit(1); }
