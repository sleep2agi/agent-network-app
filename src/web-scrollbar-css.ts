// Pure half of the themed scrollbar: no react-native import, so it can be
// exercised directly. react-native's entry point ships Flow syntax that the
// test runner cannot parse, which is why the DOM-facing halves live next door
// in web-scrollbar-dom.ts and web-scrollbar.ts rather than here.
export { STYLE_ELEMENT_ID } from './web-scrollbar-dom';
import { STYLE_ELEMENT_ID as _id } from './web-scrollbar-dom';
void _id;

/** The subset of the palette the scrollbar needs. */
export interface ScrollbarPalette {
  /** Resting thumb — deliberately low contrast; a scrollbar is not content. */
  textMuted: string;
  /** Hover thumb — one step up, still not competing with text. */
  textSecondary: string;
  /** Active (dragging) thumb — the highest-contrast step, so the grab reads. */
  text: string;
}

/**
 * Build the stylesheet from theme tokens.
 *
 * The track stays transparent on purpose. Painting it any colour reintroduces
 * the original defect the moment a panel's background differs from the one
 * assumed here — a visible seam beside the list. Transparent inherits whatever
 * the scrolling element already has, so it cannot mismatch.
 *
 * Three steps, not two: resting, hover, and a distinctly stronger active state.
 * While dragging, the thumb is what the pointer is holding, and feedback that
 * matches hover leaves the drag looking like a hover that failed to catch.
 * "Stronger" is contrast, not brightness — on the light palette `text` is
 * darker than `textSecondary`, which is the same step away from the surface.
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
    background: ${palette.text};
  }
}
`;
