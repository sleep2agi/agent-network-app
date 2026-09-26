// How the chat header fits its actions next to the agent name.
//
// 0.2.107 on a folded Xiaomi (≈390 dp portrait) showed `‹ [avatar] ··· 🔍 🔔 📌已置顶 ⚙设置`:
// the name column is the only flexible child (`flex: 1, minWidth: 0`) and every
// action is a fixed `minWidth: 58` pill that React Native never shrinks
// (flexShrink defaults to 0), two of them with text labels. At 390 dp the fixed
// parts alone add up to ≈410 dp, so the name column got 0 width and both the
// name and the status line rendered as a bare ellipsis.
//
// Pure on purpose: ChatScreen feeds it the header's measured width and which
// actions exist, and renders whatever it returns, so the decision is testable
// without React (chat-header-layout.test.ts).

/**
 * Width the name column must keep: 6 CJK glyphs at the 16 px title size plus
 * room for the ellipsis glyph, so a long name reads `示例节点名字…` rather
 * than being cut down to 4–5 characters.
 */
export const NAME_MIN_WIDTH = 6 * 16 + 16;

/** 'full' = today's look (58 dp pills, pin/settings carry text labels). */
export type HeaderMode = 'full' | 'icons' | 'overflow';

export type HeaderActionKey = 'search' | 'btw' | 'mute' | 'pin' | 'settings';

export interface HeaderLayoutInput {
  /** The header row's own width in dp (onLayout); window width before first layout. */
  width: number;
  /** Phone stack shows the ‹ back glyph; desktop / two-pane detail pane hide it. */
  hasBack: boolean;
  /** Tauri desktop: DesktopWindowPin owns the top-right corner (settings keeps a 42 dp margin). */
  desktop: boolean;
  /** Which actions this header has, in render order. `search` is always present. */
  actions: HeaderActionKey[];
}

export interface HeaderLayout {
  mode: HeaderMode;
  /** Show 「置顶/已置顶」「设置」 text next to the icons. */
  labels: boolean;
  /** Actions rendered in the row, in order (excludes the ⋯ button itself). */
  inline: HeaderActionKey[];
  /** Actions moved into the ⋯ menu (non-empty ⇒ render the ⋯ button). */
  overflow: HeaderActionKey[];
  /** Horizontal padding / gap the header row should use for this mode. */
  paddingHorizontal: number;
  gap: number;
  /** Estimated width left for the name column in this mode. */
  nameWidth: number;
}

/** Only these ever leave the row; search and settings always stay visible. */
// BTW (hidden since 0.2.105, chat-entry-flags.ts) stays inline behind its own
// flag; it is counted for width but never moved.
export const SECONDARY_ACTIONS: readonly HeaderActionKey[] = ['pin', 'mute'];

const BACK_WIDTH = 18; // `‹` at 28 px + paddingRight 8
const AVATAR = 32;
const WINDOW_PIN_RESERVE = 42;
const FULL_PILL = 58; // styles.headerAction minWidth
const ICON_BUTTON = 36; // compact icon-only hit target
const BTW_FULL = 42;
const LABEL_CHAR = 12; // headerActionText fontSize

function fullActionWidth(key: HeaderActionKey): number {
  // pin shows 「已置顶」 at worst (3 chars), settings 「设置」; 8+20+4+text+8.
  if (key === 'pin') return 40 + 3 * LABEL_CHAR;
  if (key === 'settings') return 40 + 2 * LABEL_CHAR;
  if (key === 'btw') return BTW_FULL;
  return FULL_PILL;
}

function nameWidthFor(
  input: HeaderLayoutInput,
  mode: HeaderMode,
  inline: HeaderActionKey[],
  hasMore: boolean,
): { nameWidth: number; paddingHorizontal: number; gap: number } {
  const full = mode === 'full';
  const paddingHorizontal = full ? 16 : 12;
  const gap = full ? 12 : 8;
  const actionWidths = inline.map(key => (full ? fullActionWidth(key) : ICON_BUTTON));
  if (hasMore) actionWidths.push(ICON_BUTTON);
  const children = (input.hasBack ? 1 : 0) + 1 /* avatar */ + 1 /* name */ + actionWidths.length;
  const fixed = paddingHorizontal * 2
    + (input.hasBack ? BACK_WIDTH : 0)
    + AVATAR
    + (input.desktop && inline.includes('settings') ? WINDOW_PIN_RESERVE : 0)
    + actionWidths.reduce((a, b) => a + b, 0)
    + gap * (children - 1);
  return { nameWidth: Math.max(0, input.width - fixed), paddingHorizontal, gap };
}

/**
 * Pick the roomiest mode that still leaves the name NAME_MIN_WIDTH:
 * full → icons (drop text labels, tighter spacing) → overflow (pin / mute
 * behind ⋯). Overflow is the floor: at 320 dp it is used even if the
 * name still ends up a little under the target.
 */
export function chooseHeaderLayout(input: HeaderLayoutInput): HeaderLayout {
  const actions = input.actions.includes('search') ? input.actions : (['search', ...input.actions] as HeaderActionKey[]);

  const full = nameWidthFor(input, 'full', actions, false);
  if (full.nameWidth >= NAME_MIN_WIDTH) {
    return { mode: 'full', labels: true, inline: actions, overflow: [], ...full };
  }

  const icons = nameWidthFor(input, 'icons', actions, false);
  const overflow = actions.filter(key => SECONDARY_ACTIONS.includes(key));
  if (icons.nameWidth >= NAME_MIN_WIDTH || overflow.length === 0) {
    return { mode: 'icons', labels: false, inline: actions, overflow: [], ...icons };
  }

  const inline = actions.filter(key => !SECONDARY_ACTIONS.includes(key));
  const packed = nameWidthFor(input, 'overflow', inline, true);
  return { mode: 'overflow', labels: false, inline, overflow, ...packed };
}
