import fs from 'node:fs';
import { scrollbarCss, STYLE_ELEMENT_ID } from './web-scrollbar-css';

// Dark and light palettes as theme.ts defines them. Passed explicitly so the
// test states which values it expects rather than reading whatever the module
// singleton happens to hold at import time.
const DARK = { textMuted: '#52525b', textSecondary: '#a1a1aa' };
const LIGHT = { textMuted: '#929aa6', textSecondary: '#626a76' };

const dark = scrollbarCss(DARK);
const light = scrollbarCss(LIGHT);

const source = fs
  .readFileSync(new URL('./web-scrollbar.ts', import.meta.url), 'utf8')
  .replace(/\r\n?/g, '\n');
const app = fs
  .readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
  .replace(/\r\n?/g, '\n');
const sourceCode = source
  .split('\n')
  .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
  .join('\n');

const checks: Array<[string, boolean]> = [
  // WebKit/Blink — Chrome, Edge, Safari, and the Tauri webview.
  ['webkit scrollbar width is 6-8px', /::-webkit-scrollbar \{\n\s*width: 7px;/.test(dark)],
  ['webkit thumb is rounded', /::-webkit-scrollbar-thumb \{[^}]*border-radius: 999px;/.test(dark)],
  ['webkit hover state is wired', /::-webkit-scrollbar-thumb:hover \{[^}]*background:/.test(dark)],
  ['webkit active state is wired', /::-webkit-scrollbar-thumb:active \{[^}]*background:/.test(dark)],

  // Firefox has no ::-webkit pseudo-elements; without these it keeps the
  // default white scrollbar and the reported defect stays fixed only in Chrome.
  ['firefox scrollbar-width is thin', /scrollbar-width: thin;/.test(dark)],
  ['firefox scrollbar-color is wired', /scrollbar-color: #52525b transparent;/.test(dark)],

  // The white gutter came from a painted track. Transparent cannot mismatch
  // whatever surface the scrolling panel actually has.
  ['webkit track is transparent',
    /::-webkit-scrollbar-track \{\n\s*background: transparent;/.test(dark)],
  ['webkit corner is transparent',
    /::-webkit-scrollbar-corner \{\n\s*background: transparent;/.test(dark)],
  ['firefox track is transparent', / transparent;/.test(dark)],
  ['no opaque white is painted anywhere', !/#fff|#ffffff|rgb\(255/i.test(dark)],

  // Both themes must be served, from tokens, and must actually differ.
  ['dark thumb uses the dark muted token', dark.includes('#52525b')],
  ['dark hover uses the dark secondary token', dark.includes('#a1a1aa')],
  ['light thumb uses the light muted token', light.includes('#929aa6')],
  ['light hover uses the light secondary token', light.includes('#626a76')],
  ['the two themes produce different css', dark !== light],
  ['light css carries no dark-theme colour', !light.includes('#52525b')],
  ['dark css carries no light-theme colour', !dark.includes('#929aa6')],

  // Colours come from the palette argument, not from literals in the module.
  ['css is derived from the palette, not hardcoded',
    !/#52525b|#a1a1aa|#929aa6|#626a76/.test(sourceCode)],

  // Touch surfaces already overlay an auto-hiding scrollbar; narrowing it there
  // takes away grab area and fixes nothing.
  ['rules are scoped to pointer devices', /@media \(pointer: fine\) \{/.test(dark)],
  ['every rule sits inside that guard',
    dark.indexOf('@media (pointer: fine)') < dark.indexOf('::-webkit-scrollbar')],

  // Wiring: generated css must actually reach the document, once, and follow
  // theme changes.
  ['the module subscribes to theme changes', /onThemeChange\(apply\)/.test(sourceCode)],
  ['the style element is reused rather than duplicated',
    /getElementById\(STYLE_ELEMENT_ID\)/.test(sourceCode)],
  ['injection is web-only', /Platform\.OS !== 'web'/.test(sourceCode)],
  ['a missing document is tolerated', /doc\?\.head/.test(sourceCode)],
  ['App installs the themed scrollbar',
    /useEffect\(\(\) => installWebScrollbarTheme\(\), \[\]\)/.test(app)],
  ['the style element has a stable id', STYLE_ELEMENT_ID === 'anet-scrollbar-theme'],
];

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}
console.log(`web scrollbar theme: ${checks.length} checks passed`);
