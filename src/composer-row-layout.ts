// Mobile chat composer row — WeChat layout (owner 0.2.115:「这加号是不是放在右边比较好」,
// two WeChat screenshots: empty = 🔊 | input | 😊 | ⊕; typed = 🔊 | input | 😊 | 「发送」, plus a
// ⤢ expand button top-left once the input is multi-line).
//
//   [🎤/⌨] [ input  or  按住 说话 ] [＋ ⇄ 发送]
//   [ ⤢ ]  ← top-left of the row, only when the input is taller than 3 lines
//
// The right slot is ONE place that shows either ＋ (opens the #386 panel) or a labelled
// 「发送」 button — never both, never an arrow. Voice mode follows the same rule: after
// hold-to-talk the recognized text sits in a draft card above the bar (the keyboard is NOT
// opened), so the slot turns into 「发送」 and sends it straight from voice mode.
//
// The 😊 button from the screenshots is deliberately left out: the system keyboard
// already has an emoji key, and a second emoji panel would fight the ＋ panel for the
// keyboard's slot.
//
// Desktop keeps its own toolbar composer; nothing here is used there.
//
// Pure (no react-native import) so the ck test can drive it.

export type ComposerRightSlot = 'plus' | 'send';

export interface RightSlotInput {
  draft: string;
  /** Pending draft attachments (images/files in the #402 strip). */
  attachmentCount: number;
  /** Hold-to-talk mode (#418): the bar replaces the input. */
  voiceMode: boolean;
}

/** Which button sits in the right slot. Text that is only whitespace does not count. */
export function composerRightSlot({ draft, attachmentCount }: RightSlotInput): ComposerRightSlot {
  // voiceMode no longer short-circuits to ＋: the voice draft card shows the text, and 发送
  // must be reachable without opening the keyboard (owner:「别直接把输入法弹出来」).
  if ((draft || '').trim().length > 0) return 'send';
  if (attachmentCount > 0) return 'send';
  return 'plus';
}

// ── one height for the whole row ─────────────────────────────────────────
// Owner 2026-09-26 (unfolded foldable, 更紧凑): 「这个对齐你是在搞笑的吗」 — the 「按住 说话」 bar
// was 44dp (floored) while the ⌨ / ＋ circles were ds(36) = 27dp, and the row was
// alignItems:'flex-end', so the bar's centre sat ~8.5dp above the buttons' centre line. The fix is
// structural: every control in the row (toggle, ＋, 发送, the hold bar, the single-line input) takes
// THIS height, and a single-line row is centred.
/** Row control height at density 1 (dp). */
export const COMPOSER_CONTROL_BASE = 40;
/** Never smaller than this, whatever the density (touch target; ＋/⌨ also carry hitSlop). */
export const COMPOSER_CONTROL_MIN = 36;
/** Border width of the text input (ChatScreen styles.input.borderWidth). */
export const COMPOSER_INPUT_BORDER = 1;

/** Height of every control in the composer row. Same rounding as ui-scale ds(base, min). */
export function composerControlSize(densityFactor: number): number {
  const f = Number.isFinite(densityFactor) && densityFactor > 0 ? densityFactor : 1;
  return Math.max(COMPOSER_CONTROL_MIN, Math.round(COMPOSER_CONTROL_BASE * f));
}

/**
 * Vertical padding that makes a ONE-line input exactly `control` tall:
 * border + pad + line + pad + border. Floored; the input also gets minHeight=control, so an
 * odd remainder never makes it shorter than the buttons. 0 when the font is so large that one
 * line alone is taller than the control (then the input is taller and the row is bottom-aligned
 * like a multi-line one — see composerRowAlign).
 */
export function composerInputPadY(control: number, lineHeightPx: number, border = COMPOSER_INPUT_BORDER): number {
  return Math.max(0, Math.floor((control - lineHeightPx - 2 * border) / 2));
}

/**
 * Cross-axis alignment of the row. One line (and voice mode): 'center' — toggle, bar/input and
 * right slot share one centre line. Multi-line input: 'flex-end' — the buttons stay at the
 * bottom next to the last line, like WeChat (the input grows upwards).
 */
export function composerRowAlign(lines: number, voiceMode: boolean): 'center' | 'flex-end' {
  return !voiceMode && lines > 1 ? 'flex-end' : 'center';
}

// ── expand (⤢) button ──────────────────────────────────────────────────────
/** Show ⤢ once the input needs MORE than this many lines. */
export const EXPAND_AFTER_LINES = 3;
/** Line height the mobile input is styled with (ChatScreen styles.input.lineHeight). */
export const COMPOSER_LINE_HEIGHT = 20;

/**
 * Lines the input currently shows. Two independent signals, the larger wins:
 *   · explicit newlines in the draft (works before any layout event arrives);
 *   · measured content height vs the smallest height seen (= one line; the empty
 *     input reports it on mount). Using the delta makes it independent of whether a
 *     platform's contentSize includes the vertical padding or not.
 */
export function composerLineCount(draft: string, contentHeight?: number, oneLineHeight?: number, lineHeight = COMPOSER_LINE_HEIGHT): number {
  const byNewlines = (draft || '').split('\n').length;
  let byHeight = 1;
  if (typeof contentHeight === 'number' && contentHeight > 0 && typeof oneLineHeight === 'number' && oneLineHeight > 0 && lineHeight > 0) {
    byHeight = 1 + Math.max(0, Math.round((contentHeight - oneLineHeight) / lineHeight));
  }
  return Math.max(byNewlines, byHeight);
}

export function shouldShowExpand(lines: number, voiceMode: boolean): boolean {
  return !voiceMode && lines > EXPAND_AFTER_LINES;
}

// ── fullscreen editor ─────────────────────────────────────────────────────
export type FullEditorEvent = 'expand' | 'collapse' | 'back' | 'sent' | 'conversationChanged';

export interface FullEditorTransition {
  open: boolean;
  /** For 'back': true = consumed (the chat must not go back). */
  handled: boolean;
}

/** The fullscreen editor edits the SAME draft; closing it (any way) keeps the text. */
export function nextFullEditor(open: boolean, event: FullEditorEvent): FullEditorTransition {
  switch (event) {
    case 'expand':
      return { open: true, handled: true };
    case 'back':
      return { open: false, handled: open };
    case 'collapse':
    case 'sent':
    case 'conversationChanged':
      return { open: false, handled: open };
  }
}

// ── ＋ ⇄ 发送 swap animation ──────────────────────────────────────────────
export interface SlotSwapAnimation {
  duration: number;
  fromOpacity: number;
  fromScale: number;
}

/** A short crossfade + scale-in; nothing at all when the OS asks for reduced motion. */
export function slotSwapAnimation(reduceMotion: boolean): SlotSwapAnimation {
  return reduceMotion
    ? { duration: 0, fromOpacity: 1, fromScale: 1 }
    : { duration: 140, fromOpacity: 0, fromScale: 0.8 };
}

// ── in-field mic (keyboard mode) ──────────────────────────────────────────
// Owner 2026-09-26:「…选择光标在哪个地方继续输入」 — keyboard mode gets a compact hold-to-talk
// mic INSIDE the input's right edge, so dictation lands at the cursor. It must not add height or
// move the centre line (#424): it is `control − 2·inset` tall and sits `inset` from the input's
// bottom-right corner, so on a one-line input its centre IS the input's centre; on a multi-line
// input it stays by the last line, next to the bottom-aligned buttons (WeChat).
/** Gap between the in-field mic and the input's border box (dp). */
export const FIELD_MIC_INSET = 4;

/** Diameter of the in-field mic for a given row control height (32 at 40, 28 at the 36 floor). */
export function composerFieldMicSize(control: number): number {
  return Math.max(0, control - 2 * FIELD_MIC_INSET);
}

/** Right padding the input needs so text never runs under the mic (mic + its inset + 4dp air). */
export function composerInputPadRightWithMic(control: number): number {
  return composerFieldMicSize(control) + FIELD_MIC_INSET + 4;
}
