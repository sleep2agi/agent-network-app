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
import { STYLE_ELEMENT_ID, scrollbarCss } from './web-scrollbar-css';

export { STYLE_ELEMENT_ID, scrollbarCss } from './web-scrollbar-css';
export type { ScrollbarPalette } from './web-scrollbar-css';

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
