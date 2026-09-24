// Pure half of the themed scrollbar: no react-native import, so it can be
// exercised directly. react-native's entry point ships Flow syntax that the
// test runner cannot parse, which is why the DOM-facing halves live next door
// in web-scrollbar-dom.ts and web-scrollbar.ts rather than here.
export { STYLE_ELEMENT_ID } from './web-scrollbar-dom';
import { STYLE_ELEMENT_ID as _id } from './web-scrollbar-dom';
void _id;

/** The subset of the palette the scrollbar needs. */
export interface ScrollbarPalette {
  /** Which native colour scheme the page is in. WKWebView paints its own scrollbar (and other native
   *  chrome) from `color-scheme`; without it a dark theme still gets a white scrollbar track
   *  (Vincent 2026-09-16 screenshot, macOS 0.2.66). */
  scheme: 'dark' | 'light';
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
export const SCROLLING_CLASS = 'anet-scrolling';
/** Custom property carrying the thumb colour, so show/hide can fade (a registered
 *  <color> property is interpolable; the ::-webkit-scrollbar-thumb background is not). */
export const THUMB_VAR = '--anet-sb-thumb';

export const scrollbarCss = (palette: ScrollbarPalette, desktopShell = false): string => {
  // WeChat-style (Vincent 2026-09-24): thin, and invisible unless the pointer is over the
  // scroll area or it is scrolling right now. The gutter keeps a constant width so showing
  // and hiding never shifts layout — WebKit's classic scrollbar cannot overlay content.
  const rules = `
  @property ${THUMB_VAR} {
    syntax: '<color>';
    inherits: true;
    initial-value: transparent;
  }
  :root {
    color-scheme: ${palette.scheme};
  }
  * {
    ${THUMB_VAR}: transparent;
    transition: ${THUMB_VAR} 200ms ease-out;
  }
  *:hover, .${SCROLLING_CLASS} {
    ${THUMB_VAR}: ${palette.textMuted};
    transition-duration: 80ms;
  }
  /* Only engines without ::-webkit-scrollbar get the standard properties: Chromium 121+
     ignores every ::-webkit-scrollbar rule on an element that sets scrollbar-width or
     scrollbar-color, which would leave WebView2 with its ~10px native bar. */
  @supports not selector(::-webkit-scrollbar) {
    * {
      scrollbar-width: thin;
      scrollbar-color: transparent transparent;
    }
    *:hover, .${SCROLLING_CLASS} {
      scrollbar-color: ${palette.textMuted} transparent;
    }
  }
  ::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  ::-webkit-scrollbar-track {
    background: transparent;
  }
  ::-webkit-scrollbar-corner {
    background: transparent;
  }
  ::-webkit-scrollbar-thumb {
    background-color: var(${THUMB_VAR});
    border: 1px solid transparent;
    background-clip: padding-box;
    border-radius: 999px;
  }
  ::-webkit-scrollbar-thumb:hover {
    background-color: ${palette.textSecondary};
  }
  ::-webkit-scrollbar-thumb:active {
    background-color: ${palette.text};
  }
  @media (prefers-reduced-motion: reduce) {
    * {
      transition: none;
    }
  }
`;
  if (desktopShell) return rules;
  return `
/* Browser touch surfaces keep their native overlay scrollbar. pointer:fine
   is unreliable in macOS WKWebView, so the Tauri shell bypasses this guard. */
@media (any-pointer: fine), (hover: hover) {${rules}}
`;
};

/**
 * "Is this element scrolling right now?" — marks the element on every scroll event and
 * clears the mark after `delayMs` of quiet. Pure over its clock so a test can drive it.
 */
export interface ClassListLike { add(c: string): void; remove(c: string): void }
export interface ScrollTargetLike { classList?: ClassListLike }
export interface QuietClock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
export const createScrollQuiet = (clock: QuietClock, delayMs = 1000) => {
  const timers = new Map<ScrollTargetLike, unknown>();
  return (target: ScrollTargetLike | null | undefined): void => {
    if (!target || !target.classList) return;
    target.classList.add(SCROLLING_CLASS);
    const prev = timers.get(target);
    if (prev !== undefined) clock.clearTimeout(prev);
    timers.set(target, clock.setTimeout(() => {
      target.classList?.remove(SCROLLING_CLASS);
      timers.delete(target);
    }, delayMs));
  };
};
