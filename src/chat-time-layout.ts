// Time stamps are never cut (board #683). Owner 2026-10-07, iOS phone, a conversation with an
// agent: the centred time pill read 「09:0」 / 「09:3」 and the author line read
// 「<agent> · 主动汇报 · 09:…」 / 「scheduler → <agent> · 09…」.
//
// Two defects, one class — a time drawn in a box whose width nobody reserved for it:
//
//  1. Author line: name, label and time were ONE <Text numberOfLines={1}>. A single-line Text
//     truncates at its tail, and the time IS the tail — so whatever made the line too narrow
//     (a long alias, 「A → B」, the 「主动汇报」 label, a bigger font, or the line simply being
//     measured a few points short on the device) was always paid for by the time. Fix: the
//     name and the time are separate Texts in a row; the name shrinks (flexShrink 1, minWidth 0,
//     ellipsized), the time does not (flexShrink 0).
//  2. Time pill: a content-sized Text (alignSelf center) whose box is exactly its own measured
//     width — no slack. #312 added flexShrink 0, but nothing was shrinking it: the pill is never
//     narrower than its parent allows, it is narrower than its glyphs. When the device draws the
//     string wider than it was measured, the last glyph wraps to a second line inside a
//     one-line, overflow-hidden box and disappears (「09:0」, no ellipsis — the owner's pill).
//     Fix: the pill's box is a View and the time Text inside it gets a width floor computed from
//     its own string at the font size it is drawn with, plus a margin for a short measurement
//     (timeTextFloor) — a box sized from the content, not a hand-picked width.
//     Why the device measured short is NOT verified (no iOS device here). The leading suspect is
//     a font-scale factor applied on one side of measure / draw only: the screenshot's text runs
//     at ≈ 0.9 × the style sizes, and the pill is ≈ 10–15 % short — the size of one OS text-size
//     step. The floor holds either way; the suspect is for whoever next has the device.
//
// The same floor goes on the author line's time, so neither shape depends on the device
// measuring the time string to the exact point.
//
// Pure (no react-native import): ChatTimeText.tsx uses it, src/chat-time-visible.test.ts runs
// the same fragments through Yoga.

/**
 * Per-glyph advance, in em, at or slightly above what the system UI fonts draw (SF Pro / Roboto /
 * Noto / Segoe: tabular digits ≈ 0.55–0.6 em, the colon ≈ 0.25–0.34 em, CJK = 1 em).
 */
export function glyphAdvanceEm(ch: string): number {
  const c = ch.codePointAt(0) ?? 0;
  if (c >= 0x2e80) return 1; // CJK ideographs / punctuation (昨天, 月, 日), full-width forms
  if (c >= 0x30 && c <= 0x39) return 0.6; // digits
  if (ch === ':' || ch === '.' || ch === ',' || ch === '·' || ch === '-' || ch === '/') return 0.34;
  if (ch === ' ' || ch === '\u00a0' || ch === '\u202f') return 0.3;
  return 0.62; // latin letters (Yesterday, Oct …) and anything else
}

/**
 * How much shorter than the drawn string a native measurement may come out and still not cut a
 * digit. The owner's screenshot (iPhone, 390 pt) puts the pill's content box at ≈ 85–90 % of the
 * 「09:00」 it had to hold; 1 / 0.85 ≈ 1.18 also covers a whole OS-font-scale step at the bottom of
 * the clamp (OS_FONT_SCALE_MIN = 0.85) being applied on one side of measure / draw and not the
 * other. Cost: a 「09:30」 at 11 px gets ≈ 5 px of slack — in the pill split either side of the
 * centred digits, on the author line at its outer end.
 */
export const MEASURE_SHORTFALL_MARGIN = 1.18;

/** Width floor (px / pt) for a one-line time string drawn at `fontSize`. 0 for an empty string. */
export function timeTextFloor(text: string, fontSize: number): number {
  if (!text || !(fontSize > 0)) return 0;
  let em = 0;
  for (const ch of text) em += glyphAdvanceEm(ch);
  return Math.ceil(em * fontSize * MEASURE_SHORTFALL_MARGIN);
}

/** The separator between the name and the time on an author line (no-break spaces: never a wrap point). */
export const META_SEPARATOR = '\u00a0·\u00a0';

/**
 * Layout-only fragments (no colours). Functions so a density change (spacing rewritten in place)
 * is picked up the same way bubble-layout.ts does it.
 */
export const chatTimeLayout = () => ({
  /** Author line: [name (shrinks) | · time (never shrinks)]. Never wider than its column. */
  metaRow: { flexDirection: 'row', alignItems: 'flex-start', maxWidth: '100%' },
  metaName: { flexShrink: 1, minWidth: 0 },
  metaTime: { flexShrink: 0 },
  /** Centred time pill: the background box is a View; the time Text inside carries the floor. */
  pillBox: { alignSelf: 'center', flexShrink: 0, maxWidth: '100%' },
  pillText: { flexShrink: 0, textAlign: 'center' },
} as const);
