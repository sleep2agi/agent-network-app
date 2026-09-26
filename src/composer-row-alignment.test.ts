// ck-style (self-executing; run by scripts/run-tests.mjs). Mobile composer row: one height, one
// centre line (owner 2026-09-26 on the unfolded foldable: 「这个对齐你是在搞笑的吗」 — the
// 「按住 说话」 bar was 44dp while the ⌨ / ＋ circles were ds(36), bottom-aligned, so the bar's
// centre sat above the buttons'). The pixel-level check is tests/test-composer-alignment/measure.mjs.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const {
  composerControlSize, composerInputPadY, composerRowAlign,
  COMPOSER_CONTROL_BASE, COMPOSER_CONTROL_MIN, COMPOSER_INPUT_BORDER, COMPOSER_LINE_HEIGHT,
} = await import('./composer-row-layout');
const { DENSITY_OPTIONS, FONT_SIZE_OPTIONS } = await import('./ui-scale');

let ck = 0;
const check = (cond: boolean, msg: string) => { assert.ok(cond, msg); ck++; };

// ── model ──
check(composerControlSize(1) === COMPOSER_CONTROL_BASE, 'standard density → base height');
check(composerControlSize(0.75) === COMPOSER_CONTROL_MIN, '更紧凑 (0.75) floors at the minimum, not 30');
check(composerControlSize(Number.NaN) === COMPOSER_CONTROL_BASE, 'garbage factor → base');
for (const d of DENSITY_OPTIONS) {
  const c = composerControlSize(d.factor);
  check(c >= COMPOSER_CONTROL_MIN, `${d.key}: control ≥ min`);
  for (const f of FONT_SIZE_OPTIONS) {
    const line = COMPOSER_LINE_HEIGHT * f.factor;
    const pad = composerInputPadY(c, line);
    const oneLine = 2 * COMPOSER_INPUT_BORDER + 2 * pad + line;
    // With minHeight = control, a one-line input is exactly the control height whenever it fits.
    if (line + 2 * COMPOSER_INPUT_BORDER <= c) check(oneLine <= c && c - oneLine < 1 + 1e-9, `${d.key}/${f.key}: one-line input == control (${oneLine} vs ${c})`);
    else check(pad === 0, `${d.key}/${f.key}: line taller than control → pad 0`);
  }
}
check(composerRowAlign(1, false) === 'center', 'one line → centred');
check(composerRowAlign(1, true) === 'center', 'voice mode → centred');
check(composerRowAlign(5, true) === 'center', 'voice mode ignores stale input line count');
check(composerRowAlign(2, false) === 'flex-end', 'multi-line → buttons at the bottom (WeChat)');

// ── wiring: every row control uses the same height, the row alignment comes from the model ──
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const chat = read('./ChatScreen.tsx');
const parts = read('./ComposerRowParts.tsx');
const voice = read('./VoiceInputUI.tsx');
const H = 'composerControlSize(uiScale().densityFactor)';
check(/toggle: \{ width: composerControlSize\(uiScale\(\)\.densityFactor\), height: composerControlSize\(uiScale\(\)\.densityFactor\)/.test(voice), 'toggle (⌨/🎤) = control height');
check(/holdBar: \{[^}]*height: composerControlSize\(uiScale\(\)\.densityFactor\),/.test(voice), 'hold bar = control height');
check(!/holdBar: \{[^}]*minHeight/.test(voice), 'hold bar has no taller minHeight');
check(/holdBar: \{[^}]*alignSelf: 'stretch',/.test(voice) && !/holdBar: \{[^}]*flex: 1,/.test(voice), 'hold bar: stretch across the column wrap, no vertical flex:1 (collapsed on web)');
check(/plusBtn: \{\s*width: composerControlSize\(uiScale\(\)\.densityFactor\),\s*height: composerControlSize\(uiScale\(\)\.densityFactor\),/.test(parts), '＋ = control height');
check(/sendPill: \{[^}]*height: composerControlSize\(uiScale\(\)\.densityFactor\),/.test(parts), '发送 = control height');
check(chat.includes(`minHeight: ${H},`) && chat.includes(`paddingVertical: composerInputPadY(${H}, COMPOSER_LINE_HEIGHT * uiScale().fontMultiplier),`), 'input: one line = control height');
check(chat.includes('<View style={[styles.inputRow, { alignItems: composerRowAlign(inputLines, voiceMode),'), 'row alignItems from composerRowAlign');
{
  const row = chat.slice(chat.indexOf('  inputRow: {'), chat.indexOf('  composerDivider: {'));
  check(row.includes("alignItems: 'center',") && row.includes('padding: spacing.md,') && row.includes('gap: spacing.sm,'), 'row: symmetric padding + one gap');
  check(!/padding(Left|Right|Horizontal)|margin/.test(row), 'row: no one-sided padding / margins');
}

console.log(`composer row alignment: ${ck}/${ck} checks passed`);
