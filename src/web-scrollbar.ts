// The agent list scrolled with the platform's default scrollbar: on a dark
// theme that is a white gutter down the right edge of a near-black panel.
//
// This repository has no global stylesheet — it is an Expo RN-web app, and
// React Native styles cannot express `::-webkit-scrollbar` at all. So the rules
// are generated from the same theme tokens every component reads, and injected
// once into the document. Doing it per list would mean copying the same block
// into every scrollable panel and re-copying it whenever a token changes.
//
// This file is only the wiring: platform check, palette source, subscription.
// The behaviour lives in web-scrollbar-dom.ts, which takes its document as an
// argument so a test can drive it instead of asserting about this file's text.
import { Platform } from 'react-native';
import { colors, onThemeChange, themeMode } from './theme';
import { createScrollbarInstaller, type StyleHostLike } from './web-scrollbar-dom';
import { scrollbarCss, createScrollQuiet } from './web-scrollbar-css';

export { STYLE_ELEMENT_ID } from './web-scrollbar-dom';
export { scrollbarCss } from './web-scrollbar-css';
export type { ScrollbarPalette } from './web-scrollbar-css';

const install = createScrollbarInstaller({
  getDocument: () => (globalThis as { document?: StyleHostLike }).document ?? null,
  renderCss: () => scrollbarCss({ ...colors, scheme: themeMode() === 'light' ? 'light' : 'dark' }, !!(globalThis as any).__TAURI_INTERNALS__),
  subscribe: (listener) => onThemeChange(listener),
});

/**
 * Install the themed scrollbar and keep it in step with the palette.
 *
 * Returns a teardown; on native it is a no-op, and a missing `document` is
 * tolerated rather than assumed away.
 */
export const installWebScrollbarTheme = (): (() => void) => {
  if (Platform.OS !== 'web') return () => {};
  const teardownTheme = install();
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) return teardownTheme;
  // One capture-phase listener marks whichever element is scrolling, so every list,
  // chat pane and settings column gets the same show-while-scrolling behaviour.
  const mark = createScrollQuiet({ setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) });
  const onScroll = (e: Event): void => {
    const t = e.target as unknown;
    mark((t === doc ? doc.documentElement : t) as { classList?: DOMTokenList });
  };
  doc.addEventListener('scroll', onScroll, { capture: true, passive: true });
  return () => {
    doc.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
    teardownTheme();
  };
};
