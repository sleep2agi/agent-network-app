// ck-style (self-executing; run by scripts/run-tests.mjs). WeChat-layout mobile composer row:
//   🎤/⌨ | input or 按住说话 | ＋ ⇄ 「发送」,  ⤢ top-left past 3 lines → fullscreen editor.
// Model (composer-row-layout.ts) first, then the ChatScreen / ComposerRowParts wiring.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const {
  composerRightSlot, composerLineCount, shouldShowExpand, nextFullEditor, slotSwapAnimation,
  EXPAND_AFTER_LINES, COMPOSER_LINE_HEIGHT,
} = await import('./composer-row-layout');

let ck = 0;
const check = (cond: boolean, msg: string) => { assert.ok(cond, msg); ck++; };

// ── right slot: ＋ ⇄ 发送 ──────────────────────────────────────────────────
const slot = (draft: string, attachmentCount = 0, voiceMode = false) => composerRightSlot({ draft, attachmentCount, voiceMode });
check(slot('') === 'plus', 'empty draft → ＋');
check(slot('hi') === 'send', 'text → 发送');
check(slot('', 1) === 'send', 'attachments only → 发送');
check(slot('', 3) === 'send', 'several attachments, no text → 发送');
check(slot('   \n\t ') === 'plus', 'whitespace-only → ＋');
check(slot('  x  ') === 'send', 'text with surrounding whitespace → 发送');
check(slot('', 0, true) === 'plus', 'voice mode, nothing drafted → ＋');
check(slot('left over text', 0, true) === 'plus', 'voice mode with a draft → still ＋ (the bar owns the middle)');
check(slot('', 2, true) === 'plus', 'voice mode with attachments → still ＋');
check(slot(undefined as unknown as string) === 'plus', 'undefined draft does not throw → ＋');

// ── line count / ⤢ threshold ──────────────────────────────────────────────
check(EXPAND_AFTER_LINES === 3, 'threshold: more than 3 lines');
check(composerLineCount('') === 1 && composerLineCount('one line') === 1, 'no layout yet, no newline → 1 line');
check(composerLineCount('a\nb\nc') === 3 && composerLineCount('a\nb\nc\nd') === 4, 'explicit newlines count before any layout event');
{
  const one = 38; // whatever the platform reports for one line (padding in or out doesn't matter)
  const L = COMPOSER_LINE_HEIGHT;
  check(composerLineCount('x', one, one) === 1, 'measured one line');
  check(composerLineCount('x', one + 2 * L, one) === 3, 'measured 3 lines (wrapped, no newline)');
  check(composerLineCount('x', one + 3 * L, one) === 4, 'measured 4 lines');
  check(composerLineCount('x', one + 2.4 * L, one) === 3 && composerLineCount('x', one + 2.6 * L, one) === 4, 'rounds to the nearest line');
  check(composerLineCount('a\nb\nc\nd\ne', one, one) === 5, 'newlines win over a stale (short) measurement');
  check(composerLineCount('x', one - 5, one) === 1, 'height below the one-line baseline never goes under 1');
  check(composerLineCount('x', 200, undefined) === 1 && composerLineCount('x', 0, one) === 1, 'no baseline / zero height → ignore the measurement');
}
check(!shouldShowExpand(3, false), '3 lines → no ⤢');
check(shouldShowExpand(4, false), '4 lines → ⤢');
check(!shouldShowExpand(10, true), 'voice mode never shows ⤢ (there is no input)');
check(!shouldShowExpand(1, false), '1 line → no ⤢');

// ── fullscreen editor state (back handling) ───────────────────────────────
{
  const open = nextFullEditor(false, 'expand');
  check(open.open === true, '⤢ opens the editor');
  const backOpen = nextFullEditor(true, 'back');
  check(backOpen.open === false && backOpen.handled === true, 'back with editor open: closes it and consumes back');
  const backClosed = nextFullEditor(false, 'back');
  check(backClosed.open === false && backClosed.handled === false, 'back with editor closed: not consumed');
  check(nextFullEditor(true, 'collapse').open === false, 'collapse control closes');
  check(nextFullEditor(true, 'sent').open === false, '发送 closes');
  check(nextFullEditor(true, 'conversationChanged').open === false, 'switching conversation closes');
  check(nextFullEditor(true, 'expand').open === true, 'expand while open stays open');
}

// ── swap animation ─────────────────────────────────────────────────────────
{
  const on = slotSwapAnimation(false);
  check(on.duration > 0 && on.duration <= 200 && on.fromOpacity < 1 && on.fromScale < 1, 'normal: short crossfade + scale-in (≤200ms)');
  const off = slotSwapAnimation(true);
  check(off.duration === 0 && off.fromOpacity === 1 && off.fromScale === 1, 'reduced motion: no animation at all');
}

// ── wiring ─────────────────────────────────────────────────────────────────
const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
const chat = read('ChatScreen.tsx');
const parts = read('ComposerRowParts.tsx');
const model = read('composer-row-layout.ts');

const rowAt = chat.indexOf('<View style={[styles.inputRow,');
const mobileRow = chat.slice(rowAt, chat.indexOf('{plusMenuOpen ? (', rowAt));
check(rowAt > 0 && mobileRow.length > 200, 'found the mobile input row');
{
  const toggleAt = mobileRow.indexOf('<ComposerModeToggle');
  const middleAt = mobileRow.indexOf('<VoiceHoldBar');
  const inputAt = mobileRow.indexOf('<TextInput');
  const slotAt = mobileRow.indexOf('<ComposerRightSlot');
  check(toggleAt > 0 && middleAt > toggleAt && inputAt > toggleAt, 'order: 🎤/⌨ toggle before the input / hold bar');
  check(slotAt > inputAt && slotAt > middleAt, 'order: right slot after the input / hold bar');
  check(mobileRow.slice(0, inputAt).indexOf("plusEvent('toggle')") === -1, '＋ is no longer left of the input');
  check((mobileRow.match(/plusEvent\('toggle'\)/g) ?? []).length === 1, 'exactly one ＋ in the row (in the right slot)');
  check(mobileRow.includes("onPlus={() => plusEvent('toggle')}") && mobileRow.includes('onSend={() => void submit()}'), 'right slot: ＋ → panel toggle, 发送 → submit');
  check(mobileRow.includes('slot={rightSlot}') && mobileRow.includes('plusOpen={plusMenuOpen}'), 'right slot gets the decided slot and panel state');
  check(mobileRow.includes('sendDisabled={!canSend(draft, attached.length > 0, sending)}'), '发送 disabled while sending / nothing sendable (same canSend as before)');
  check(!/<ComposerRightSlot[\s\S]*?\/>[\s\S]*?voiceMode \? null/.test(mobileRow) && !mobileRow.includes('{voiceMode ? null : ('), 'right slot is always drawn (voice mode shows ＋ there)');
  check(!mobileRow.includes('>↑<'), 'no arrow send button left in the mobile row');
}
check(chat.includes('const rightSlot = composerRightSlot({ draft, attachmentCount: attached.length, voiceMode });'), 'slot decided from draft + attachment count + voice mode');
check(chat.includes('const showExpand = !desktop && shouldShowExpand(inputLines, voiceMode);'), '⤢ only on mobile, from the line count');
check(chat.includes('const inputLines = composerLineCount(draft, inputContentHeight, oneLineHeightRef.current);'), 'line count from draft + measured content height');
check(mobileRow.includes('onContentSizeChange={event => onInputContentSize(event.nativeEvent.contentSize.height)}'), 'input reports its content height');
{
  const leftAt = mobileRow.indexOf('<View style={styles.inputLeftCol}>');
  const expandAt = mobileRow.indexOf("<ComposerExpandButton onPress={() => fullEditorEvent('expand')} />");
  const toggleAt = mobileRow.indexOf('<ComposerModeToggle');
  check(leftAt > 0 && expandAt > leftAt && toggleAt > expandAt, '⤢ sits above the toggle in the left column (top-left of the composer)');
  check(/inputLeftCol: \{ alignSelf: 'stretch', justifyContent: 'space-between'/.test(chat), 'left column stretches to the row height so ⤢ lands at the top');
  check(mobileRow.includes('{voice.available || showExpand ? ('), 'left column drawn when there is a toggle or a ⤢');
}
check(new RegExp(`lineHeight: ${COMPOSER_LINE_HEIGHT},`).test(chat.slice(chat.indexOf('  input: {'), chat.indexOf('  inputWrap:'))), 'mobile input lineHeight matches COMPOSER_LINE_HEIGHT');

// fullscreen editor
{
  const ed = chat.slice(chat.indexOf('<ComposerFullscreenEditor'), chat.indexOf('/>', chat.indexOf('<ComposerFullscreenEditor')));
  check(ed.includes('visible={!desktop && fullEditorOpen}'), 'editor: mobile only');
  check(ed.includes('draft={draft}') && ed.includes('onChangeDraft={setDraft}'), 'editor edits the SAME draft');
  check(ed.includes("onClose={() => fullEditorEvent('back')}"), 'editor close (back / collapse) goes through the state machine');
  check(ed.includes("onSend={() => { fullEditorEvent('sent'); void submit(); }}"), 'editor 发送 submits and closes');
  check(ed.includes('sendDisabled={!canSend(draft, attached.length > 0, sending)}'), 'editor 发送 uses the same canSend');
  check(/useEffect\(\(\) => \{\s*fullEditorEvent\('conversationChanged'\);[\s\S]{0,80}\}, \[alias\]\);/.test(chat), 'switching conversation closes the editor');
  const modal = parts.slice(parts.indexOf('<Modal'), parts.indexOf('>', parts.indexOf('<Modal')) + 1);
  check(modal.includes('onRequestClose={onClose}'), 'editor Modal: onRequestClose={onClose} (Android back / Esc)');
  check(modal.includes('visible={visible}'), 'editor Modal follows the visible prop');
  check(/testID="composer-fullscreen-collapse"[\s\S]{0,80}onPress=\{onClose\}/.test(parts), 'collapse control calls onClose');
  check(/testID="composer-fullscreen-send"[\s\S]{0,200}onPress=\{onSend\}/.test(parts), 'editor has its own 发送');
  check(/value=\{draft\}\s*onChangeText=\{onChangeDraft\}/.test(parts), 'editor input is bound to the draft');
  check(parts.includes('rulesFullscreenPadding(Platform.OS, useSafeAreaInsets(), StatusBar.currentHeight)'), 'editor pads for status bar / cutout like the rules fullscreen');
}

// ComposerRightSlot rendering
{
  check(/slot === 'send' \? \(/.test(parts), 'right slot renders by the decided slot');
  const sendAt = parts.indexOf('testID="composer-send"');
  const sendBtn = parts.slice(sendAt, parts.indexOf('</Pressable>', sendAt));
  check(sendAt > 0 && sendBtn.includes('<Text style={styles.sendPillText}>发送</Text>') && !sendBtn.includes('↑'), '发送 is a labelled button, not an arrow');
  check(/sendPill: \{[\s\S]*?backgroundColor: colors\.accent/.test(parts), '发送 uses the accent colour');
  check(/sendPill: \{[\s\S]*?borderRadius: radius\.sm/.test(parts), '发送 is rounded');
  check(parts.includes("accessibilityLabel={plusOpen ? '收起更多发送方式' : '更多发送方式'}"), '＋ keeps its a11y labels');
  check(parts.includes('slotSwapAnimation(reduceMotion)') && parts.includes('AccessibilityInfo.isReduceMotionEnabled') && parts.includes("'reduceMotionChanged'"), 'swap animation honours reduced motion (initial + live changes)');
  check(parts.includes("animationType={reduceMotion ? 'none' : 'slide'}"), 'editor open animation honours reduced motion');
  check(!/😊|emoji/i.test(parts) && !/emoji/i.test(mobileRow), 'no emoji button (deliberately left out — the system keyboard has one)');
  check(/deliberately left out/.test(model), 'the emoji decision is recorded in the model header');
}

// desktop untouched, entry flags kept
{
  const desktop = chat.slice(chat.indexOf('      {desktop ? (\n        <>'), chat.indexOf('      ) : (\n      <>'));
  check(desktop.length > 200 && !desktop.includes('ComposerRightSlot') && !desktop.includes('ComposerExpandButton'), 'desktop composer untouched (no right slot / ⤢)');
  check(desktop.includes('styles.desktopSend') && desktop.includes('<Ionicons name="add-circle-outline"'), 'desktop keeps its toolbar ＋ and 发送');
  check(mobileRow.includes('{SHOW_BOLT_ENTRY ? ('), '⚡ stays behind SHOW_BOLT_ENTRY');
}

// draft strip: ＋ is 发送 once there is an attachment → a 「继续添加」 tile keeps multi-image drafting (#402) reachable
{
  const strip = chat.slice(chat.indexOf('testID="composer-draft-strip"'), chat.indexOf('{composerNotice ? ('));
  check(/\{!desktop && ATTACH_ENABLED && remainingImageSlots\(attached\) > 0 \? \(\s*<Pressable[\s\S]*?testID="composer-draft-add"\s*onPress=\{\(\) => plusEvent\('toggle'\)\}/.test(strip), 'draft strip 继续添加 tile opens the ＋ panel while slots remain');
}

console.log(`composer row layout: ${ck}/${ck} checks passed`);
