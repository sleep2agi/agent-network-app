// The agent list scrolled with the platform's default scrollbar: on a dark
// theme that is a white gutter down the right edge of a near-black panel.
//
// This repository has no global stylesheet — it is an Expo RN-web app, and
// React Native styles cannot express `::-webkit-scrollbar` at all. So the rules
// are generated from the same theme tokens every component reads, and injected
// once into the document. Doing it per list would mean copying the same block
// into every scrollable panel and re-copying it whenever a token changes.
import { Platform } from 'react-native';
import { colors, onThemeChange } from './theme';

export const STYLE_ELEMENT_ID = 'anet-scrollbar-theme';

/** The subset of the palette the scrollbar needs. */
export interface ScrollbarPalette {
  /** Resting thumb — deliberately low contrast; a scrollbar is not content. */
  textMuted: string;
  /** Hover/active thumb — one step brighter, still not competing with text. */
  textSecondary: string;
}

/**
 * Build the stylesheet from theme tokens.
 *
 * The track stays transparent on purpose. Painting it any colour reintroduces
 * the original defect the moment a panel's background differs from the one
 * assumed here — a visible seam beside the list. Transparent inherits whatever
 * the scrolling element already has, so it cannot mismatch.
 */
export const scrollbarCss = (palette: ScrollbarPalette): string => `
/* Pointer devices only. Touch surfaces already overlay a scrollbar that hides
   itself, and narrowing it there costs the user grab area for no gain. */
@media (pointer: fine) {
  * {
    scrollbar-width: thin;
    scrollbar-color: ${palette.textMuted} transparent;
  }
  ::-webkit-scrollbar {
    width: 7px;
    height: 7px;
  }
  ::-webkit-scrollbar-track {
    background: transparent;
  }
  ::-webkit-scrollbar-corner {
    background: transparent;
  }
  ::-webkit-scrollbar-thumb {
    background: ${palette.textMuted};
    border-radius: 999px;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: ${palette.textSecondary};
  }
  ::-webkit-scrollbar-thumb:active {
    background: ${palette.textSecondary};
  }
}
`;

const apply = (): void => {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc?.head) return;
  let style = doc.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    doc.head.appendChild(style);
  }
  style.textContent = scrollbarCss(colors);
};

/**
 * Install the themed scrollbar and keep it in step with the palette.
 *
 * Returns a teardown so a caller can unsubscribe; on native it is a no-op, and
 * `document` is checked rather than assumed so a server or test environment
 * without a DOM does not throw.
 */
export const installWebScrollbarTheme = (): (() => void) => {
  if (Platform.OS !== 'web') return () => {};
  apply();
  return onThemeChange(apply);
};
