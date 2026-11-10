// ck-style (self-executing; run by scripts/run-tests.mjs). Mobile composer footer: model + thinking-level pills.
// Pills sit in the text-box column, the bottom safe area pads the footer (not the input row), unknown variant
// shows the control's name while the accessibility label still says unknown.
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import { composerModelRowInset, composerVariantLabel, composerVariantPillLabel } from './composer-model-label';
import { setLanguagePreference } from './i18n';

let n = 0;
const ck = (name: string, cond: boolean, extra = '') => {
  n += 1;
  assert.ok(cond, `${name}${extra ? ` — ${extra}` : ''}`);
  console.log(`PASS: ${name}`);
};

setLanguagePreference('zh');
ck('unknown variant pill names the control', composerVariantPillLabel(undefined) === '思考档位');
ck('unknown variant pill never shows a level', !['默认', '未知', 'high'].includes(composerVariantPillLabel(undefined)));
ck('a11y value for unknown stays explicit', composerVariantLabel(undefined) === '未知');
ck('explicit default pill', composerVariantPillLabel(null) === '默认');
ck('selected pill', composerVariantPillLabel('high') === 'high');
setLanguagePreference('en');
ck('english unknown pill', composerVariantPillLabel(undefined) === 'Thinking');
setLanguagePreference('zh');

ck('inset with left column lines up with the text box', JSON.stringify(composerModelRowInset(true, 40, 12, 8)) === JSON.stringify({ left: 60, right: 60 }));
ck('inset without left column', JSON.stringify(composerModelRowInset(false, 40, 12, 8)) === JSON.stringify({ left: 12, right: 60 }));

const chat = fs.readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const rowAt = chat.indexOf('testID="composer-model-row"');
const row = chat.slice(chat.lastIndexOf('<View', rowAt), chat.indexOf('{plusMenuOpen ? (', rowAt));
const inputRow = chat.slice(chat.indexOf('<View style={[styles.inputRow,'), chat.indexOf('onLayout={event => setInputRowLocalTop'));
ck('found the mobile model row', rowAt > 0 && row.includes('composer-variant-entry'));
ck('footer carries the bottom safe-area inset', row.includes('paddingBottom: spacing.sm + (plusMenuOpen ? 0 : composerInset)'));
ck('input row no longer carries the inset', !inputRow.includes('composerInset'));
ck('footer is inset to the text-box column', row.includes('paddingLeft: modelRowInset.left') && row.includes('paddingRight: modelRowInset.right'));
ck('long model names truncate to one line', /numberOfLines=\{1\} ellipsizeMode="middle" testID="composer-model"/.test(row));
ck('mobile pill shows the placeholder label', row.includes('{composerVariantPillLabel(footerVariant)}'));
ck('a11y label keeps the explicit unknown', row.includes("t('chat.modelPicker.variantA11y', { value: composerVariantLabel(footerVariant) })"));
ck('behavior unchanged: model pill toggles, variant pill opens', row.includes('onPress={() => setModelSheetOpen(v => !v)}') && row.includes('onPress={() => setModelSheetOpen(true)}'));
const styles = chat.slice(chat.indexOf('  composerModelPill: {'), chat.indexOf('  modelChip: {'));
ck('model pill shrinks, variant pill does not', /composerModelPill: \{[^}]*flexShrink: 1, minWidth: 0/.test(styles) && /composerVariantPill: \{[^}]*flexShrink: 0/.test(styles));

console.log(`${n}/${n} passed`);
process.exit(0);
