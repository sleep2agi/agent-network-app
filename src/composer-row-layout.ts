// Mobile chat composer row — WeChat layout (owner 0.2.115:「这加号是不是放在右边比较好」,
// two WeChat screenshots: empty = 🔊 | input | 😊 | ⊕; typed = 🔊 | input | 😊 | 「发送」, plus a
// ⤢ expand button top-left once the input is multi-line).
//
//   [🎤/⌨] [ input  or  按住 说话 ] [＋ ⇄ 发送]
//   [ ⤢ ]  ← top-left of the row, only when the input is taller than 3 lines
//
// The right slot is ONE place that shows either ＋ (opens the #386 panel) or a labelled
// 「发送」 button — never both, never an arrow. Voice mode always shows ＋ there (the
// hold bar takes the middle; nothing typed can be sent from voice mode).
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
export function composerRightSlot({ draft, attachmentCount, voiceMode }: RightSlotInput): ComposerRightSlot {
  if (voiceMode) return 'plus';
  if ((draft || '').trim().length > 0) return 'send';
  if (attachmentCount > 0) return 'send';
  return 'plus';
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
