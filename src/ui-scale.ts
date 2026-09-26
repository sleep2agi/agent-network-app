// 字体大小 + 界面密度(Vincent 2026-09-26,展开的小米折叠屏:「设置里面要支持设置字体大小以及图标大小…
// 现在我感觉那个左边还是偏大的」)。
//
// Pure on purpose (no react-native import): the math, the defaults, the storage format and the
// live state are all checked by ui-scale.test.ts under bun. React wiring lives in
// src/ui-text.tsx (Text / TextInput), src/icons.tsx (Ionicons), AliasAvatar and App.tsx.
//
// Two independent knobs:
//
//  - 字体大小 (font): a multiplier on every fontSize / lineHeight that goes through
//    src/ui-text.tsx. It is COMBINED with the OS font scale here (see fontMultiplier) and the
//    wrapper then renders with allowFontScaling={false}, so the OS never multiplies a second
//    time. Before this module the OS scale was applied by RN, uncapped, on every Text —
//    which is why the foldable showed noticeably larger text than the 1200×850 web harness.
//
//  - 界面密度 (density): a multiplier on spacing tokens (theme.ts `spacing`, mutated in place
//    like `colors`), every Ionicons size (src/icons.tsx), every AliasAvatar, and the explicit
//    `ds(n)` sizes on the list rows / nav rail / chat header / composer / node tabs.
//    Font size is NOT touched by density — the two are separate settings.
//
// Change propagation reuses the theme mechanism: a change re-runs every module-level
// `makeStyles()` through theme.ts's restyle listeners, and App.tsx adds `uiScaleKey()` to the
// keyed remount — exactly how a theme switch already re-renders the tree.

import { SPACING_BASE, restyleAll, spacing } from './theme';

// ── options ──

export type FontSizePref = 'small' | 'standard' | 'large' | 'xlarge';
export type DensityPref = 'compact' | 'standard' | 'comfortable';

export const FONT_SIZE_OPTIONS: readonly { key: FontSizePref; label: string; factor: number }[] = [
  { key: 'small', label: '小', factor: 0.9 },
  { key: 'standard', label: '标准', factor: 1.0 },
  { key: 'large', label: '大', factor: 1.15 },
  { key: 'xlarge', label: '特大', factor: 1.3 },
];

export const DENSITY_OPTIONS: readonly { key: DensityPref; label: string; factor: number }[] = [
  { key: 'compact', label: '紧凑', factor: 0.85 },
  { key: 'standard', label: '标准', factor: 1.0 },
  { key: 'comfortable', label: '宽松', factor: 1.15 },
];

const FONT_FACTOR: Record<FontSizePref, number> = { small: 0.9, standard: 1.0, large: 1.15, xlarge: 1.3 };
const DENSITY_FACTOR: Record<DensityPref, number> = { compact: 0.85, standard: 1.0, comfortable: 1.15 };

export const isFontSizePref = (v: unknown): v is FontSizePref =>
  v === 'small' || v === 'standard' || v === 'large' || v === 'xlarge';
export const isDensityPref = (v: unknown): v is DensityPref =>
  v === 'compact' || v === 'standard' || v === 'comfortable';

// ── defaults ──

/** Font size default is 标准 everywhere; the "left side too big" fix is the OS cap + density. */
export const DEFAULT_FONT_SIZE: FontSizePref = 'standard';

/**
 * Density when the user never chose one. Phone and desktop: 标准 (unchanged look).
 * Android wide two-pane (unfolded foldable / tablet): 紧凑 — the owner's 0.2.112 screenshot
 * on an unfolded foldable had ~68 dp rows with a 44 dp avatar and a big rail, and he still
 * found the left side too big. 紧凑 gives a 37 dp avatar in a 58 dp row (still above the
 * 48 dp touch minimum; with two lines of 标准 text the row is text-bound at ~63 dp), a 62 dp rail with 54×48 dp items. It follows the layout live: fold
 * the phone and it goes back to 标准, unfold and it is 紧凑 again — until the user picks one.
 */
export const defaultDensity = (wide: boolean): DensityPref => (wide ? 'compact' : 'standard');

// ── OS font scale composition ──

/**
 * The OS font scale is honoured only within this range. Above +15 % the in-app 字体大小
 * (up to 特大 1.3) is the way to get bigger text; an uncapped OS scale is what blew up the
 * foldable's list (HyperOS 1.3 × a 16 dp name = 21 dp).
 */
export const OS_FONT_SCALE_MIN = 0.85;
export const OS_FONT_SCALE_MAX = 1.15;
/** Hard bounds on the final multiplier, whatever the combination. */
export const FONT_MULTIPLIER_MIN = 0.8;
export const FONT_MULTIPLIER_MAX = 1.5;
/**
 * Dense surfaces (list rows, nav rail labels, badges): the OS scale may not push them past
 * this. The user's own explicit choice is always honoured (特大 1.3 stays 1.3) — the cap only
 * limits what the OS adds on top.
 */
export const DENSE_FONT_CAP = 1.2;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const finiteOr = (n: unknown, d: number) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : d);

/**
 * Effective multiplier for a fontSize: in-app choice × the OS scale (clamped), within the hard
 * bounds; dense text is further capped at max(DENSE_FONT_CAP, user choice).
 */
export function fontMultiplier(pref: FontSizePref, osFontScale: number, dense = false): number {
  const user = FONT_FACTOR[pref] ?? 1;
  const os = clamp(finiteOr(osFontScale, 1), OS_FONT_SCALE_MIN, OS_FONT_SCALE_MAX);
  let m = clamp(user * os, FONT_MULTIPLIER_MIN, FONT_MULTIPLIER_MAX);
  if (dense) m = Math.min(m, Math.max(DENSE_FONT_CAP, user));
  return Math.round(m * 1000) / 1000;
}

export const densityFactor = (pref: DensityPref): number => DENSITY_FACTOR[pref] ?? 1;

// ── persistence (per device, same store as the theme: localStorage on desktop, SecureStore on mobile) ──

export const UI_SCALE_STORAGE_KEY = 'ui_scale_v1';

/** null = never chosen → the default (which for density depends on the layout). */
export interface UiScalePrefs {
  font: FontSizePref | null;
  density: DensityPref | null;
}

export const EMPTY_UI_SCALE_PREFS: UiScalePrefs = { font: null, density: null };

/** Anything unreadable (missing key, old build, garbage, a half-written value) reads as "never chosen". */
export function parseStoredUiScale(raw: string | null | undefined): UiScalePrefs {
  if (!raw) return { ...EMPTY_UI_SCALE_PREFS };
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object') return { ...EMPTY_UI_SCALE_PREFS };
    return { font: isFontSizePref(v.font) ? v.font : null, density: isDensityPref(v.density) ? v.density : null };
  } catch {
    return { ...EMPTY_UI_SCALE_PREFS };
  }
}

export const serializeUiScale = (p: UiScalePrefs): string =>
  JSON.stringify({ font: p.font ?? null, density: p.density ?? null });

// ── web-only simulation hook (screenshots / QA; never used on native) ──
//
// `?osFontScale=1.3` pretends the OS font scale is 1.3 (RN web always reports 1).
// `?uiScaleSim=legacy` reproduces the pre-setting behaviour: the OS scale applied uncapped to
// every Text by RN, no density — the "before" picture on a device with a large system font.

export interface UiScaleSim { osFontScale: number | null; legacy: boolean }

export function parseUiScaleSim(search: string | null | undefined): UiScaleSim {
  const out: UiScaleSim = { osFontScale: null, legacy: false };
  if (!search) return out;
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const n = Number(q.get('osFontScale'));
  if (q.has('osFontScale') && Number.isFinite(n) && n > 0 && n <= 4) out.osFontScale = n;
  out.legacy = q.get('uiScaleSim') === 'legacy';
  return out;
}

// ── live state ──

interface State {
  prefs: UiScalePrefs;
  osFontScale: number;
  wide: boolean;
  legacy: boolean;
}

const state: State = { prefs: { ...EMPTY_UI_SCALE_PREFS }, osFontScale: 1, wide: false, legacy: false };
const listeners = new Set<() => void>();

export interface ResolvedUiScale {
  font: FontSizePref;
  density: DensityPref;
  /** true when the value is the default (nothing stored) — the settings UI says 「默认」. */
  fontIsDefault: boolean;
  densityIsDefault: boolean;
  fontMultiplier: number;
  denseFontMultiplier: number;
  densityFactor: number;
  /** The raw OS font scale that went in (before clamping) — the settings hint shows it. */
  osFontScale: number;
}

export function resolveUiScale(s: Pick<State, 'prefs' | 'osFontScale' | 'wide' | 'legacy'>): ResolvedUiScale {
  const font = s.prefs.font ?? DEFAULT_FONT_SIZE;
  const density = s.prefs.density ?? defaultDensity(s.wide);
  if (s.legacy) {
    // Pre-setting behaviour: RN multiplied every Text by the raw OS scale; nothing else scaled.
    const os = finiteOr(s.osFontScale, 1);
    return { font, density: 'standard', fontIsDefault: true, densityIsDefault: true, fontMultiplier: os, denseFontMultiplier: os, densityFactor: 1, osFontScale: os };
  }
  return {
    font,
    density,
    fontIsDefault: s.prefs.font == null,
    densityIsDefault: s.prefs.density == null,
    fontMultiplier: fontMultiplier(font, s.osFontScale),
    denseFontMultiplier: fontMultiplier(font, s.osFontScale, true),
    densityFactor: densityFactor(density),
    osFontScale: finiteOr(s.osFontScale, 1),
  };
}

let resolved: ResolvedUiScale = resolveUiScale(state);

export const uiScale = (): ResolvedUiScale => resolved;
export const uiScalePrefs = (): UiScalePrefs => ({ ...state.prefs });

/** Stable string for App's keyed remount; changes exactly when something rendered would change. */
export const uiScaleKey = (): string => `f${resolved.fontMultiplier}/${resolved.denseFontMultiplier}-d${resolved.densityFactor}`;

/** Scaled spacing tokens for a density factor (rounded to whole dp; never below 1 for a non-zero base). */
export function scaledSpacing(factor: number): Record<keyof typeof SPACING_BASE, number> {
  const out = {} as Record<keyof typeof SPACING_BASE, number>;
  for (const k of Object.keys(SPACING_BASE) as (keyof typeof SPACING_BASE)[]) {
    out[k] = Math.max(1, Math.round(SPACING_BASE[k] * factor));
  }
  return out;
}

const apply = (): void => {
  const before = uiScaleKey();
  resolved = resolveUiScale(state);
  if (uiScaleKey() === before) return;
  // In place, like `colors`: every module holds the same `spacing` reference.
  Object.assign(spacing, scaledSpacing(resolved.densityFactor));
  // Rebuild module-level StyleSheets (same listeners a theme switch runs), then tell React.
  restyleAll();
  listeners.forEach(l => l());
};

export function setUiScalePrefs(p: Partial<UiScalePrefs>): void {
  state.prefs = {
    font: p.font === undefined ? state.prefs.font : isFontSizePref(p.font) ? p.font : null,
    density: p.density === undefined ? state.prefs.density : isDensityPref(p.density) ? p.density : null,
  };
  apply();
  prefListeners.forEach(l => l());
}

/** OS font scale (useWindowDimensions().fontScale / PixelRatio.getFontScale()). */
export function setOsFontScale(scale: number): void {
  state.osFontScale = finiteOr(scale, 1);
  apply();
}

/** Whether the Android wide two-pane layout is active (drives the density default). */
export function setUiScaleLayoutWide(wide: boolean): void {
  state.wide = !!wide;
  apply();
}

export function setUiScaleLegacySim(legacy: boolean): void {
  state.legacy = !!legacy;
  apply();
}

export function onUiScaleChange(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

// Settings rows need to refresh when a *preference* changes even if nothing rendered changes
// (e.g. choosing 紧凑 while 紧凑 is already the wide default: 「默认」 label goes away).
const prefListeners = new Set<() => void>();
export function onUiScalePrefsChange(l: () => void): () => void {
  prefListeners.add(l);
  return () => { prefListeners.delete(l); };
}
export const uiScalePrefsKey = (): string => `${state.prefs.font ?? '-'}|${state.prefs.density ?? '-'}|${uiScaleKey()}`;

/** Settings copy: 「标准（默认）」/「紧凑（宽屏默认）」/「大」. */
export function uiScaleSummary(r: ResolvedUiScale, wide: boolean): { font: string; density: string; osNote: string | null } {
  const fontLabel = FONT_SIZE_OPTIONS.find(o => o.key === r.font)?.label ?? r.font;
  const densityLabel = DENSITY_OPTIONS.find(o => o.key === r.density)?.label ?? r.density;
  const os = r.osFontScale;
  const osNote = Math.abs(os - 1) < 0.005
    ? null
    : os > OS_FONT_SCALE_MAX
      ? `系统字体 ×${os.toFixed(2)}，只计入 ×${OS_FONT_SCALE_MAX.toFixed(2)}；更大请选「大」「特大」`
      : `已叠加系统字体 ×${os.toFixed(2)}`;
  return {
    font: r.fontIsDefault ? `${fontLabel}（默认）` : fontLabel,
    density: r.densityIsDefault ? `${densityLabel}（${wide ? '宽屏默认' : '默认'}）` : densityLabel,
    osNote,
  };
}

export const uiScaleLayoutWide = (): boolean => state.wide;

// ── Text style scaling (used by src/ui-text.tsx; pure so it is unit-tested here) ──

/** The subset of a flattened RN text style this touches. */
export type TextStyleLike = { fontSize?: number; lineHeight?: number; [k: string]: unknown };

/** RN's default fontSize for a Text with none set (both native platforms and react-native-web). */
export const RN_DEFAULT_FONT_SIZE = 14;

/**
 * Pure: scale fontSize / lineHeight of a (flattened) style by `m`. A top-level text with no
 * fontSize gets the RN default × m; a nested one inherits (returns the style unchanged).
 */
export function scaleTextStyle(style: TextStyleLike | undefined, m: number, nested: boolean): TextStyleLike | undefined {
  if (m === 1) return style;
  const out: TextStyleLike = { ...(style ?? {}) };
  if (typeof out.fontSize === 'number') out.fontSize = Math.round(out.fontSize * m * 10) / 10;
  else if (!nested) out.fontSize = Math.round(RN_DEFAULT_FONT_SIZE * m * 10) / 10;
  if (typeof out.lineHeight === 'number') out.lineHeight = Math.round(out.lineHeight * m * 10) / 10;
  return out;
}

// ── helpers used by styles ──

/**
 * Font helper for sizes that are NOT a Text's fontSize (e.g. a box that must fit one line of
 * text). Text / TextInput from src/ui-text.tsx already scale their own fontSize/lineHeight —
 * never write `fontSize: fs(n)` (it would scale twice; ui-scale-wiring.test.ts rejects it).
 */
export const fs = (n: number, dense = false): number =>
  Math.round(n * (dense ? resolved.denseFontMultiplier : resolved.fontMultiplier) * 2) / 2;

/** Density helper: icon sizes, avatars, row heights, paddings, rail. `floor` keeps touch targets usable. */
export const ds = (n: number, floor = 0): number => Math.max(floor, Math.round(n * resolved.densityFactor));

/** Test-only reset. */
export function __resetUiScale(): void {
  state.prefs = { ...EMPTY_UI_SCALE_PREFS };
  state.osFontScale = 1;
  state.wide = false;
  state.legacy = false;
  resolved = resolveUiScale(state);
  Object.assign(spacing, scaledSpacing(1));
}
