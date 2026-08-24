// Pure half of the themed scrollbar: no react-native import, so it can be
// exercised directly. react-native's entry point ships Flow syntax that the
// test runner cannot parse, which is why the DOM-facing half lives next door
// in web-scrollbar.ts rather than here.
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
