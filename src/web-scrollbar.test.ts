import fs from 'node:fs';
import { scrollbarCss } from './web-scrollbar-css';
import {
  STYLE_ELEMENT_ID,
  applyScrollbarCss,
  createScrollbarInstaller,
  type StyleElementLike,
  type StyleHostLike,
} from './web-scrollbar-dom';

// Dark and light palettes as theme.ts defines them. Passed explicitly so the
// test states which values it expects rather than reading whatever the module
// singleton happens to hold at import time.
const DARK = { textMuted: '#52525b', textSecondary: '#a1a1aa', text: '#f4f4f5' };
const LIGHT = { textMuted: '#929aa6', textSecondary: '#626a76', text: '#20242a' };

const dark = scrollbarCss(DARK);
const light = scrollbarCss(LIGHT);

const cssSource = fs
  .readFileSync(new URL('./web-scrollbar-css.ts', import.meta.url), 'utf8')
  .replace(/\r\n?/g, '\n')
  .split('\n')
  .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
  .join('\n');
const app = fs
  .readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
  .replace(/\r\n?/g, '\n');

/** Minimal document double: records what actually lands in head. */
const fakeDoc = () => {
  const head: StyleElementLike[] = [];
  const doc: StyleHostLike & { head: { appendChild(n: StyleElementLike): void }; children: StyleElementLike[] } = {
    children: head,
    head: { appendChild: (node: StyleElementLike) => void head.push(node) },
    getElementById: (id: string) => head.find(n => n.id === id) ?? null,
    createElement: () => ({ id: '', textContent: null }),
  };
  return doc;
};

const styleCount = (doc: ReturnType<typeof fakeDoc>) =>
  doc.children.filter(n => n.id === STYLE_ELEMENT_ID).length;

// ---- behaviour: apply/reuse -------------------------------------------------
const reuse = fakeDoc();
applyScrollbarCss(reuse, dark);
const afterFirst = styleCount(reuse);
applyScrollbarCss(reuse, light);
const afterSecond = styleCount(reuse);
const reusedText = reuse.children.find(n => n.id === STYLE_ELEMENT_ID)?.textContent;

const otherDoc = fakeDoc();
applyScrollbarCss(otherDoc, dark);

const headless: StyleHostLike = {
  head: null,
  getElementById: () => {
    throw new Error('must not look for an element without a head');
  },
  createElement: () => {
    throw new Error('must not create an element without a head');
  },
};

// ---- behaviour: install/cleanup lifecycle -----------------------------------
const lifecycle = () => {
  const doc = fakeDoc();
  let palette = DARK;
  const listeners = new Set<() => void>();
  const install = createScrollbarInstaller({
    getDocument: () => doc,
    renderCss: () => scrollbarCss(palette),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  const emit = () => [...listeners].forEach(l => l());
  const text = () => doc.children.find(n => n.id === STYLE_ELEMENT_ID)?.textContent ?? '';
  return { doc, install, emit, listeners, text, setPalette: (p: typeof DARK) => { palette = p; } };
};

const live = lifecycle();
const teardown = live.install();
const installedText = live.text();
const listenersAfterInstall = live.listeners.size;
live.setPalette(LIGHT);
live.emit();
const afterThemeChange = live.text();
teardown();
live.setPalette(DARK);
live.emit();
const afterTeardown = live.text();

// React StrictMode mounts effects twice: install, cleanup, install again.
const strict = lifecycle();
const first = strict.install();
first();
strict.install();
strict.setPalette(LIGHT);
strict.emit();

const checks: Array<[string, boolean]> = [
  // ---- generated css ----
  ['webkit scrollbar width is 6-8px', /::-webkit-scrollbar \{\n\s*width: 7px;/.test(dark)],
  ['webkit thumb is rounded', /::-webkit-scrollbar-thumb \{[^}]*border-radius: 999px;/.test(dark)],
  ['firefox scrollbar-width is thin', /scrollbar-width: thin;/.test(dark)],
  ['firefox scrollbar-color is wired', /scrollbar-color: #52525b transparent;/.test(dark)],
  ['webkit track is transparent',
    /::-webkit-scrollbar-track \{\n\s*background: transparent;/.test(dark)],
  ['webkit corner is transparent',
    /::-webkit-scrollbar-corner \{\n\s*background: transparent;/.test(dark)],
  ['no opaque white is painted anywhere', !/#fff|#ffffff|rgb\(255/i.test(dark)],
  ['rules are scoped to pointer devices', /@media \(pointer: fine\) \{/.test(dark)],
  ['every rule sits inside that guard',
    dark.indexOf('@media (pointer: fine)') < dark.indexOf('::-webkit-scrollbar')],

  // Three distinct states: resting, hover, and a stronger active step so a drag
  // does not look like a hover that failed to catch.
  ['resting thumb uses the muted token', /::-webkit-scrollbar-thumb \{\n\s*background: #52525b;/.test(dark)],
  ['hover thumb uses the secondary token',
    /::-webkit-scrollbar-thumb:hover \{\n\s*background: #a1a1aa;/.test(dark)],
  ['active thumb goes one step beyond hover',
    /::-webkit-scrollbar-thumb:active \{\n\s*background: #f4f4f5;/.test(dark)],
  ['active differs from hover on the light palette too',
    /::-webkit-scrollbar-thumb:active \{\n\s*background: #20242a;/.test(light)],

  ['light thumb uses the light muted token', light.includes('#929aa6')],
  ['the two themes produce different css', dark !== light],
  ['light css carries no dark-theme colour', !light.includes('#52525b')],
  ['css is derived from the palette, not hardcoded',
    !/#52525b|#a1a1aa|#929aa6|#626a76|#f4f4f5|#20242a/.test(cssSource)],

  // ---- behaviour: the style element ----
  ['first apply creates the style element', afterFirst === 1],
  ['a second apply reuses it instead of appending another', afterSecond === 1],
  ['the reused element carries the newest css', reusedText === light],
  ['a different document gets its own element', styleCount(otherDoc) === 1],
  ['applying reports success when there is a head', applyScrollbarCss(fakeDoc(), dark)],
  ['no head is a no-op, not a throw', applyScrollbarCss(headless, dark) === false],
  ['a missing document is a no-op', applyScrollbarCss(null, dark) === false],

  // ---- behaviour: install / cleanup ----
  ['install writes the css immediately', installedText === scrollbarCss(DARK)],
  ['install subscribes exactly once', listenersAfterInstall === 1],
  ['a theme change after install updates the css', afterThemeChange === scrollbarCss(LIGHT)],
  ['after teardown a theme change no longer updates the css',
    afterTeardown === scrollbarCss(LIGHT)],
  ['teardown removes the listener', live.listeners.size === 0],
  ['install → cleanup → install leaves one live listener', strict.listeners.size === 1],
  ['install → cleanup → install leaves one style element', styleCount(strict.doc) === 1],
  ['the surviving installer still tracks the theme',
    strict.text() === scrollbarCss(LIGHT)],

  // ---- wiring ----
  ['App installs the themed scrollbar',
    /useEffect\(\(\) => installWebScrollbarTheme\(\), \[\]\)/.test(app)],
  ['the style element has a stable id', STYLE_ELEMENT_ID === 'anet-scrollbar-theme'],
];

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}
console.log(`web scrollbar theme: ${checks.length} checks passed`);
