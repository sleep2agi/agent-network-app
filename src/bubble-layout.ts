// Layout-only style fragments (no colours, no react-native import) for the chat bubble chain and
// the markdown blocks inside it. ChatScreen / DmChatScreen / MarkdownMessage spread these into
// their StyleSheets, and bubble-layout.test.ts runs the very same objects through Yoga — the
// engine that lays out the native app — so the guard measures what ships, not a copy.
//
// 2026-09-30 (owner, Android tablet landscape, 0.2.161): a long markdown reply's bubble ended a
// few lines early, the rest of the text ran out below it, and the quote row under the bubble was
// drawn over the body. The bubble chain is shrink-to-fit (alignSelf flex-start + maxWidth), so Yoga
// sizes it from measurements of its content, then lays the content out again at the final width.
// Anything whose height depends on a flex negotiation *inside* that bubble can be measured at one
// width and drawn at another, and the bubble keeps the height of the first:
//   - list rows were `marker | text` with the text `flexBasis: 0` → measured at width 0, so the
//     bubble took the width of its widest non-list line (the 【】 heading — the owner's screenshot)
//     and its height from the wrong measurement;
//   - basis auto instead is still a flex row: the text is measured at the full row width, then
//     shrunk by the marker → one line more than the bubble made room for;
//   - the ≥3-column table cards (label | value row) and the ≤2-column grid (`flex: 1` cells): same.
// So inside a bubble, text never takes its width from a flex negotiation: list text is a plain
// column child (marker absolutely positioned in the row's left padding), a card line is one Text
// with the label as a span, grid cells get a fixed percentage share. bubble-layout.test.ts checks
// every box in the bubble against what it holds, and keeps the old styles as must-go-red controls.
//
// Functions, not constants: `spacing` is rewritten in place by the density setting and every
// makeStyles() re-runs, so these must read it at call time.
import { spacing } from './theme';

/** Desktop bubble max width (px). */
export const DESKTOP_BUBBLE_MAX = 640;

/** Desktop: sent and reply bubbles share one max width — 85% of the pane, capped. Phone/tablet: none. */
export function desktopBubbleCap(desktop: boolean, paneWidth: number): { maxWidth: number } | null {
  return desktop && paneWidth > 0 ? { maxWidth: Math.min(DESKTOP_BUBBLE_MAX, Math.floor(paneWidth * 0.85)) } : null;
}

export const bubbleLayout = () => ({
  messageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, width: '100%' },
  sentRow: { justifyContent: 'flex-end' },
  replyRow: { justifyContent: 'flex-start' },
  messageContent: { maxWidth: '85%', flexShrink: 1, alignItems: 'flex-start' },
  sentContent: { alignItems: 'flex-end' },
  bubblePressable: { maxWidth: '100%', alignItems: 'flex-end' },
  replyPressable: { maxWidth: '100%', alignSelf: 'flex-start' },
  bubble: { alignSelf: 'flex-end', maxWidth: '100%', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  replyBubble: { alignSelf: 'flex-start', maxWidth: '85%', flexShrink: 1 },
  // 桌面:发出与回复同一个最大宽度(bubbleCap),回复不再是 85% 里再 85%。
  replyBubbleDesktop: { maxWidth: '100%' },
  quoteChip: { marginTop: 4, maxWidth: '100%', borderLeftWidth: 2, paddingLeft: spacing.sm, paddingVertical: 1 },
  quoteChipSent: { alignSelf: 'flex-end' },
  quoteChipReply: { alignSelf: 'flex-start' },
} as const);

export const markdownLayout = () => ({
  // minWidth 0:气泡里的列与行是 flex 子项,默认 min-width:auto 会按内容宽度撑开父级
  root: { gap: spacing.sm, minWidth: 0, maxWidth: '100%' },
  block: { marginBottom: 2 },
  heading: { marginTop: spacing.xs },
  // marker absolutely positioned in the row's left padding, text a plain column child — see the
  // header. Marker width + padding come per list from listIndent() (sized for its widest number).
  listRow: { minWidth: 0 },
  marker: { position: 'absolute', left: 0, top: 0 },
  listText: { minWidth: 0 },
  quote: { borderLeftWidth: 3, paddingLeft: spacing.md, minWidth: 0 },
  code: { maxWidth: '100%', padding: spacing.md },
  table: { maxWidth: '100%', borderWidth: 1 },
  tableRow: { flexDirection: 'row' },
  // + `width: 100/columns %` from gridCellWidth(): a definite share, not a grow/shrink negotiation.
  tableCellFlex: { minWidth: 0, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRightWidth: 1, borderBottomWidth: 1 },
  tableStack: { gap: spacing.sm },
  tableCard: { borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 2 },
} as const);

/** Native ≤2-column grid: each cell takes an equal percentage share of the row. */
export const gridCellWidth = (columns: number) => ({ width: `${100 / Math.max(1, columns)}%` as const });

/** Widest glyphs a list marker is drawn with (14px markdown text): a digit, and the '.' after it. */
export const MARKER_DIGIT_W = 9;
export const MARKER_DOT_W = 6;

/**
 * Hanging indent for one list: the marker column is as wide as the list's widest marker
 * ("12." for 12 items, "100." from 100), never less than 16, so every item's text starts at the
 * same x and a two/three-digit number never spills into the gap or wraps.
 */
export function listIndent(itemCount: number, ordered: boolean): { marker: { width: number }; row: { paddingLeft: number } } {
  const width = ordered ? Math.max(16, String(Math.max(1, itemCount)).length * MARKER_DIGIT_W + MARKER_DOT_W) : 16;
  return { marker: { width }, row: { paddingLeft: width + spacing.sm } };
}
