import fs from 'node:fs';
import { scrollbarCss, createScrollQuiet, SCROLLING_CLASS, THUMB_VAR } from './web-scrollbar-css';
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
const DARK = { scheme: 'dark' as const, textMuted: '#52525b', textSecondary: '#a1a1aa', text: '#f4f4f5' };
const LIGHT = { scheme: 'light' as const, textMuted: '#929aa6', textSecondary: '#626a76', text: '#20242a' };

const dark = scrollbarCss(DARK);
const light = scrollbarCss(LIGHT);
const desktop = scrollbarCss(DARK, true);

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


// ---- scroll-quiet timer (pure, fake clock) ----
const quietClock = () => {
  let now = 0; let seq = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimeout: (fn: () => void, ms: number) => { const id = ++seq; pending.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (h: unknown) => { pending.delete(h as number); },
    advance: (ms: number) => { now += ms; for (const [id, t] of [...pending]) if (t.at <= now) { pending.delete(id); t.fn(); } },
    pendingCount: () => pending.size,
  };
};
const qc = quietClock();
const classes = new Set<string>();
const el = { classList: { add: (c: string) => void classes.add(c), remove: (c: string) => void classes.delete(c) } };
const markScroll = createScrollQuiet(qc, 1000);
markScroll(el);
const markedOnScroll = classes.has('anet-scrolling');
qc.advance(600); markScroll(el);            // still scrolling: timer restarts
qc.advance(600);
const stillMarkedMidStream = classes.has('anet-scrolling');
const onePendingTimer = qc.pendingCount() === 1;
qc.advance(500);                            // 1000ms after the last event
const clearedAfterQuiet = !classes.has('anet-scrolling');
markScroll(null); markScroll({});           // no element / no classList: ignored
const noThrowOnJunk = true;

const checks: Array<[string, boolean]> = [
  // ---- generated css ----
  ['webkit scrollbar width is 6px (WeChat-thin)', /::-webkit-scrollbar \{\n\s*width: 6px;\n\s*height: 6px;/.test(dark)],
  ['painted thumb is ~4px: 1px transparent border clipped', /::-webkit-scrollbar-thumb \{[^}]*border: 1px solid transparent;[^}]*background-clip: padding-box;/.test(dark)],
  ['webkit thumb is rounded', /::-webkit-scrollbar-thumb \{[^}]*border-radius: 999px;/.test(dark)],
  ['firefox scrollbar-width is thin', /scrollbar-width: thin;/.test(dark)],
  ['standard scrollbar props are fenced off from webkit/blink (Chromium 121+ would drop the ::-webkit rules)', /@supports not selector\(::-webkit-scrollbar\) \{\n\s*\* \{\n\s*scrollbar-width: thin;/.test(dark)],
  ['no unfenced scrollbar-width outside the @supports block', dark.indexOf('scrollbar-width:') > dark.indexOf('@supports not selector(::-webkit-scrollbar)')],
  // 2026-09-16 Vincent (macOS 0.2.66 dark theme): a white scrollbar track. WKWebView paints native chrome
  // from `color-scheme`; declare it so the native scrollbar follows the theme when the custom rules do not.
  ['dark palette declares color-scheme: dark', /:root \{\n\s*color-scheme: dark;/.test(dark)],
  ['light palette declares color-scheme: light', /:root \{\n\s*color-scheme: light;/.test(light)],
  ['desktop shell declares color-scheme too', /color-scheme: dark;/.test(desktop)],
  ['installer derives scheme from themeMode()', /scheme: themeMode\(\) === 'light' \? 'light' : 'dark'/.test(fs.readFileSync(new URL('./web-scrollbar.ts', import.meta.url), 'utf8'))],
  ['firefox scrollbar is transparent at rest', /\* \{\n\s*scrollbar-width: thin;\n\s*scrollbar-color: transparent transparent;/.test(dark)],
  ['firefox scrollbar shows the muted token on hover/scrolling', /\*:hover, \.anet-scrolling \{\n\s*scrollbar-color: #52525b transparent;/.test(dark)],
  ['webkit track is transparent',
    /::-webkit-scrollbar-track \{\n\s*background: transparent;/.test(dark)],
  ['webkit corner is transparent',
    /::-webkit-scrollbar-corner \{\n\s*background: transparent;/.test(dark)],
  ['no opaque white is painted anywhere', !/#fff|#ffffff|rgb\(255/i.test(dark)],
  ['browser rules are scoped to pointer-capable devices', /@media \(any-pointer: fine\), \(hover: hover\) \{/.test(dark)],
  ['every rule sits inside that guard',
    dark.indexOf('@media (any-pointer: fine)') < dark.indexOf('::-webkit-scrollbar')],
  ['Tauri desktop bypasses unreliable pointer media detection',
    !desktop.includes('any-pointer') && desktop.includes('::-webkit-scrollbar-track')],

  // Three distinct states: resting, hover, and a stronger active step so a drag
  // does not look like a hover that failed to catch.
  ['thumb colour comes from the fade variable', /::-webkit-scrollbar-thumb \{\n\s*background-color: var\(--anet-sb-thumb\);/.test(dark)],
  ['the variable is transparent at rest', /\* \{[^}]*--anet-sb-thumb: transparent;/.test(dark)],
  ['hover or scrolling sets the variable to the muted token', /\*:hover, \.anet-scrolling \{[^}]*--anet-sb-thumb: #52525b;/.test(dark)],
  ['the variable is registered as an interpolable <color> (so it can fade)', /@property --anet-sb-thumb \{\n\s*syntax: '<color>';\n\s*inherits: true;\n\s*initial-value: transparent;/.test(dark)],
  ['the fade is a transition on the variable', /transition: --anet-sb-thumb 200ms/.test(dark)],
  ['reduced motion drops the fade', /@media \(prefers-reduced-motion: reduce\) \{\n\s*\* \{\n\s*transition: none;/.test(dark)],
  ['constants match the css', SCROLLING_CLASS === 'anet-scrolling' && THUMB_VAR === '--anet-sb-thumb'],
  ['hover thumb uses the secondary token',
    /::-webkit-scrollbar-thumb:hover \{\n\s*background-color: #a1a1aa;/.test(dark)],
  ['active thumb goes one step beyond hover',
    /::-webkit-scrollbar-thumb:active \{\n\s*background-color: #f4f4f5;/.test(dark)],
  ['active differs from hover on the light palette too',
    /::-webkit-scrollbar-thumb:active \{\n\s*background-color: #20242a;/.test(light)],

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

  // ---- scroll-quiet ----
  ['a scroll event marks the element as scrolling', markedOnScroll],
  ['continued scrolling keeps the mark (timer restarts)', stillMarkedMidStream],
  ['restarting replaces the timer instead of stacking', onePendingTimer],
  ['the mark clears after 1s of quiet', clearedAfterQuiet],
  ['null targets and elements without classList are ignored', noThrowOnJunk],
  ['the installer wires a capture-phase passive scroll listener',
    /addEventListener\('scroll', onScroll, \{ capture: true, passive: true \}\)/.test(fs.readFileSync(new URL('./web-scrollbar.ts', import.meta.url), 'utf8'))],
  ['teardown removes that listener',
    /removeEventListener\('scroll', onScroll/.test(fs.readFileSync(new URL('./web-scrollbar.ts', import.meta.url), 'utf8'))],
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
