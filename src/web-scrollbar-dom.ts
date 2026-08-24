// DOM half of the themed scrollbar, kept free of react-native so its behaviour
// can be driven directly by a test with a fake document.
//
// The previous revision asserted this logic with source-text regexes, and
// review showed both were satisfiable without the behaviour: appending a fresh
// <style> on every call still matched `getElementById(...)` somewhere in the
// file, and an installer returning `() => {}` still matched
// `onThemeChange(apply)`. Text near the behaviour is not the behaviour.
//
// 🔴 Content-Security-Policy: this injects a <style> element at runtime. If a
// CSP is ever added to the desktop shell or the web build, it needs
// `style-src` to permit that (a nonce on the element, or 'unsafe-inline').
// Without it the rules are silently dropped and the scrollbar reverts to the
// platform default — with no error anywhere.

export const STYLE_ELEMENT_ID = 'anet-scrollbar-theme';

/** The slice of `<style>` this module touches. */
export interface StyleElementLike {
  id: string;
  textContent: string | null;
}

/** The slice of `Document` this module touches. */
export interface StyleHostLike {
  head?: { appendChild(node: StyleElementLike): void } | null;
  getElementById(id: string): StyleElementLike | null;
  createElement(tagName: 'style'): StyleElementLike;
}

/**
 * Write `css` into the document's scrollbar style element, creating it once.
 *
 * Returns whether anything was written, so a caller can tell "no document" from
 * "written" instead of guessing.
 */
export const applyScrollbarCss = (
  doc: StyleHostLike | null | undefined,
  css: string,
): boolean => {
  if (!doc || !doc.head) return false;
  let style = doc.getElementById(STYLE_ELEMENT_ID);
  if (!style) {
    style = doc.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    doc.head.appendChild(style);
  }
  style.textContent = css;
  return true;
};

export interface InstallerDeps {
  /** Resolved at call time: the document may not exist yet when this is built. */
  getDocument: () => StyleHostLike | null | undefined;
  /** Current palette, read fresh on every apply so theme switches are picked up. */
  renderCss: () => string;
  /** Theme subscription; must return its own unsubscribe. */
  subscribe: (listener: () => void) => () => void;
}

/**
 * Install the stylesheet and keep it in step with the theme.
 *
 * The returned teardown both unsubscribes and stops further writes, so a
 * double-install (React StrictMode mounts effects twice) leaves one live
 * listener and one style element rather than two of each.
 */
export const createScrollbarInstaller = (deps: InstallerDeps) => (): (() => void) => {
  let live = true;
  const apply = (): void => {
    if (!live) return;
    applyScrollbarCss(deps.getDocument(), deps.renderCss());
  };
  apply();
  const unsubscribe = deps.subscribe(apply);
  return () => {
    live = false;
    unsubscribe();
  };
};
