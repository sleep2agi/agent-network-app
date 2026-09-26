// Static guard for THE SAFE-AREA RULE (src/modal-safe-area.ts header). ck style: self-executing,
// exit 1 on any failure. The measured half lives in tests/test-layout-sweep/run.mjs.
//
//   R1  app-styles' shared `root` style carries no padding (it is reused INSIDE the root — the
//       0.2.118 节点信息 double inset was exactly this).
//   R2  nothing reachable from a main-window screen / pane adds a top inset again: no insets.top,
//       StatusBar.currentHeight, statusBarHeight(), SafeAreaView, edges={['top'…]}.
//       (keyboardVerticalOffset lines are exempt — that is a keyboard offset, not padding.)
//   R3  every <Modal> subtree applies useModalSafePadding(…)'s output (directly or through a
//       value derived from it) — a Modal is its own window under Android edge-to-edge.
//   R4  the inset tables are only called through that hook (single path, so the rule and the web
//       simulation apply uniformly): no direct rulesFullscreenPadding( / modalSafePadding( calls.
//
// Two layers, checked separately (CLAUDE.md ⑤): the judge (does a bad line get flagged?) and the
// collection (does a file in a sub-directory / a new *Screen.tsx get scanned at all?).
import { mkdtempSync, mkdirSync, readdirSync, readFileSync as readRaw, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0;
const failures: string[] = [];
const ck = (name: string, ok: boolean, extra = '') => {
  if (ok) pass++; else failures.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` (${extra})` : ''}`);
};

const posix = (p: string) => p.split(sep).join('/');
// Windows checkouts may have CRLF (core.autocrlf): every regex below assumes '\n' line ends, and
// `;\n` ends a declaration for helperNames — so normalise on every read.
const normalizeEol = (src: string) => src.replace(/\r\n?/g, '\n');
const readFileSync = (p: string, _enc: 'utf8') => normalizeEol(readRaw(p, 'utf8'));

// ── collection ───────────────────────────────────────────────────────────────────────────────
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(tsx?|mts)$/.test(e) && !/\.test\.tsx?$/.test(e) && !/\.d\.ts$/.test(e)) out.push(p);
  }
  return out;
}

// Files allowed to touch the raw inset primitives: the root and the rule's own modules; fixture
// routes are standalone windows that never render inside the root.
const PRIMITIVE_OWNERS = new Set(['App.tsx', 'src/safe-area-runtime.ts', 'src/modal-safe-area.ts', 'src/rules-fullscreen-layout.ts']);
const isFixture = (rel: string) => /Fixture[A-Za-z]*\.tsx$/.test(rel);
// Root-level chrome App() mounts OUTSIDE the main-window shell (own windows / title bars).
const ROOT_CHROME = new Set(['MacTitleStrip', 'WinTitleBar', 'DesktopUpdatePrompt', 'AndroidUpdatePrompt', 'TrayPanel']);

function resolveImport(fromAbs: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(fromAbs), spec);
  for (const c of [base, `${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')]) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}
const importsOf = (abs: string, src: string) => [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => resolveImport(abs, m[1])).filter((x): x is string => !!x);

/** Main-window screens: components App.tsx renders (minus root chrome / fixtures) + every *Screen.tsx; then their import closure. */
export function collectPaneFiles(root: string): { screens: string[]; reachable: string[] } {
  const app = join(root, 'App.tsx');
  const appSrc = readFileSync(app, 'utf8');
  const defaults = new Map<string, string>();
  for (const m of appSrc.matchAll(/^import\s+([A-Z]\w*)\b[^;\n]*from\s+['"]([^'"]+)['"]/gm)) {
    const f = resolveImport(app, m[2]); if (f) defaults.set(m[1], f);
  }
  const rendered = new Set([...appSrc.matchAll(/<([A-Z]\w*)[\s/>]/g)].map(m => m[1]));
  const screens = new Set<string>();
  for (const name of rendered) {
    const f = defaults.get(name);
    if (f && !ROOT_CHROME.has(name) && !isFixture(posix(relative(root, f)))) screens.add(f);
  }
  for (const f of walk(join(root, 'src'))) if (/Screen\.tsx$/.test(f) && !isFixture(posix(relative(root, f)))) screens.add(f);
  const seen = new Set<string>();
  const queue = [...screens];
  while (queue.length) {
    const f = queue.shift()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const g of importsOf(f, readFileSync(f, 'utf8'))) if (!seen.has(g)) queue.push(g);
  }
  const rel = (f: string) => posix(relative(root, f));
  return { screens: [...screens].map(rel).sort(), reachable: [...seen].map(rel).filter(r => !PRIMITIVE_OWNERS.has(r) && !isFixture(r)).sort() };
}

// ── judges ───────────────────────────────────────────────────────────────────────────────────
const stripComment = (line: string) => line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '').replace(/\{\/\*.*?\*\/\}/g, '');

const R2_TOKENS: Array<[RegExp, string]> = [
  [/\binsets\.top\b/, 'insets.top'],
  [/useSafeAreaInsets\(\)\.top/, 'useSafeAreaInsets().top'],
  [/StatusBar\.currentHeight/, 'StatusBar.currentHeight'],
  [/\bstatusBarHeight\(/, 'statusBarHeight()'],
  [/\bSafeAreaView\b/, 'SafeAreaView'],
  [/edges=\{\s*\[[^\]]*['"]top['"]/, "edges={['top']}"],
];
/** R2 on one file's source → `line: token` findings. */
export function judgeNoSecondInset(src: string): string[] {
  const out: string[] = [];
  src.split('\n').forEach((raw, i) => {
    const line = stripComment(raw);
    if (/keyboardVerticalOffset/.test(line)) return;
    for (const [re, label] of R2_TOKENS) if (re.test(line)) out.push(`${i + 1}: ${label}`);
  });
  return out;
}

/** R4: direct calls to the inset tables. */
export function judgeHelperBypass(src: string): string[] {
  const out: string[] = [];
  src.split('\n').forEach((raw, i) => { const line = stripComment(raw); if (/\b(rulesFullscreenPadding|modalSafePadding)\(/.test(line) && !/^\s*(export\s+)?function\b/.test(line)) out.push(`${i + 1}: ${line.trim().slice(0, 80)}`); });
  return out;
}

/** Identifiers bound to useModalSafePadding(…) and everything derived from them (fixpoint). */
function helperNames(src: string): Set<string> {
  const names = new Set<string>();
  for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*useModalSafePadding\(/g)) names.add(m[1]);
  const decls = [...src.matchAll(/(?:const|let)\s+(\w+)\s*=([\s\S]*?);\n/g)].map(m => ({ name: m[1], body: m[2] }));
  for (let grew = true; grew;) {
    grew = false;
    for (const d of decls) if (!names.has(d.name) && [...names].some(n => new RegExp(`\\b${n}\\b`).test(d.body))) { names.add(d.name); grew = true; }
  }
  return names;
}

/** R3 on one file: every <Modal …>…</Modal> subtree references a helper-derived name. → offending line numbers. */
const stripComments = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))   // keep line numbers
  .replace(/(^|\s)\/\/[^\n]*/g, (m, lead) => lead);
export function judgeModalsUseHelper(raw: string): { modals: number; bad: string[] } {
  const src = stripComments(raw);
  const names = helperNames(src);
  const bad: string[] = [];
  let modals = 0;
  const re = /<Modal\b|<\/Modal>/g;
  let depth = 0, start = -1;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m[0] === '<Modal') { if (depth === 0) start = m.index; depth++; }
    else if (depth > 0 && --depth === 0) {
      modals++;
      const body = src.slice(start, m.index);
      const ok = [...names].some(n => new RegExp(`\\b${n}\\b`).test(body));
      if (!ok) bad.push(`${src.slice(0, start).split('\n').length}`);
    }
  }
  if (depth !== 0) bad.push('unbalanced <Modal>');
  return { modals, bad };
}

/** R1: the shared root style block in app-styles has no padding. */
export function judgeRootStyle(src: string): string[] {
  const m = src.match(/\n\s*root:\s*\{([\s\S]*?)\n\s*\},/);
  if (!m) return ['no root style found'];
  return /\bpadding\w*\s*:/.test(m[1].split('\n').map(stripComment).join('\n')) ? ['root style pads'] : [];
}

// ── selftest: the judges ─────────────────────────────────────────────────────────────────────
ck('judge R2 flags paddingTop: insets.top', judgeNoSecondInset(`const s = { paddingTop: insets.top };`).length === 1);
ck('judge R2 flags StatusBar.currentHeight padding', judgeNoSecondInset(`<View style={{ paddingTop: StatusBar.currentHeight }} />`).length === 1);
ck('judge R2 flags SafeAreaView / edges top', judgeNoSecondInset(`<SafeAreaView edges={['top']}>`).length === 2);
ck('judge R2 ignores keyboardVerticalOffset', judgeNoSecondInset(`keyboardVerticalOffset={Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0}`).length === 0);
ck('judge R2 ignores comments', judgeNoSecondInset(`// was paddingTop: insets.top\n  * StatusBar.currentHeight\n`).length === 0);
ck('judge R2 allows the bottom inset', judgeNoSecondInset(`const pad = insets.bottom;`).length === 0);
ck('judge R4 flags a direct table call', judgeHelperBypass(`const safe = rulesFullscreenPadding(Platform.OS, useSafeAreaInsets(), 0);`).length === 1);
ck('judge R3 flags a Modal without the helper', judgeModalsUseHelper(`return <Modal visible><View style={s.root}><Text/></View></Modal>;`).bad.length === 1);
ck('judge R3 passes a Modal with the helper', judgeModalsUseHelper(`const safe = useModalSafePadding('fullScreen');\nreturn <Modal visible><View style={[s.root, safe]} /></Modal>;`).bad.length === 0);
ck('judge R3 passes a value derived from the helper', judgeModalsUseHelper(`const x = useModalSafePadding('overlay');\nconst pad = { paddingBottom: x.paddingBottom };\nreturn <Modal><View style={pad} /></Modal>;`).bad.length === 0);
ck('judge R3 is per Modal (second one unpadded)', judgeModalsUseHelper(`const safe = useModalSafePadding('fullScreen');\n<Modal><View style={safe} /></Modal>\n<Modal><View style={s.x} /></Modal>`).bad.length === 1);
ck('judge R3 ignores <Modal> in comments', judgeModalsUseHelper(`// every <Modal> pads\n/* a <Modal> here */\nconst a = 1;`).modals === 0);
ck('judge R3: a helper named elsewhere in the file does not count', judgeModalsUseHelper(`const safe = useModalSafePadding('fullScreen');\nconst y = safe;\n<Modal><View style={s.root} /></Modal>`).bad.length === 1);
ck('judge R3 survives CRLF sources (Windows checkout)', judgeModalsUseHelper(normalizeEol(`const safe = useModalSafePadding('fullScreen');\r\nconst pad = { a: safe.paddingTop };\r\nreturn <Modal><View style={pad} /></Modal>;\r\n`)).bad.length === 0);
ck('collect: CRLF source is read with \\n line ends', (() => { const t = mkdtempSync(join(tmpdir(), 'eol-')); try { writeFileSync(join(t, 'a.ts'), 'x\r\ny\r\n'); return !readFileSync(join(t, 'a.ts'), 'utf8').includes('\r'); } finally { rmSync(t, { recursive: true, force: true }); } })());
ck('judge R1 flags a padded root', judgeRootStyle(`\n  root: {\n    flex: 1,\n    paddingTop: 24,\n  },`).length === 1);
ck('judge R1 passes the plain root', judgeRootStyle(`\n  root: {\n    flex: 1,\n    // paddingTop: was here\n  },`).length === 0);

// ── selftest: the collection (a nested screen, a helper it imports, an App-rendered component) ──
{
  const t = mkdtempSync(join(tmpdir(), 'safe-area-rule-'));
  try {
    mkdirSync(join(t, 'src', 'deep', 'er'), { recursive: true });
    writeFileSync(join(t, 'App.tsx'), `import Pane from './src/Pane';\nimport MacTitleStrip from './src/mac-title-strip';\nexport default () => <><MacTitleStrip /><Pane /></>;\n`);
    writeFileSync(join(t, 'src', 'Pane.tsx'), `import { part } from './deep/er/part';\nexport default () => null;\n`);
    writeFileSync(join(t, 'src', 'mac-title-strip.tsx'), `export default () => null;\n`);
    writeFileSync(join(t, 'src', 'deep', 'er', 'part.ts'), `export const part = 1;\n`);
    writeFileSync(join(t, 'src', 'deep', 'NestedScreen.tsx'), `export default () => null;\n`);
    writeFileSync(join(t, 'src', 'deep', 'LoneFixtureScreen.tsx'), `export default () => null;\n`);
    writeFileSync(join(t, 'src', 'deep', 'x.test.ts'), `// test\n`);
    const c = collectPaneFiles(t);
    ck('collect: App-rendered component is a screen', c.screens.includes('src/Pane.tsx'), c.screens.join(','));
    ck('collect: *Screen.tsx in a sub-directory is a screen', c.screens.includes('src/deep/NestedScreen.tsx'));
    ck('collect: import closure reaches a nested module', c.reachable.includes('src/deep/er/part.ts'), c.reachable.join(','));
    ck('collect: root chrome / fixtures / tests stay out', !c.reachable.some(r => /mac-title-strip|Fixture|\.test\./.test(r)));
    ck('collect: walk is recursive and skips tests', walk(join(t, 'src')).map(f => posix(relative(t, f))).includes('src/deep/er/part.ts') && !walk(join(t, 'src')).some(f => f.endsWith('.test.ts')));
  } finally { rmSync(t, { recursive: true, force: true }); }
}

// ── the real tree ───────────────────────────────────────────────────────────────────────────
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { screens, reachable } = collectPaneFiles(ROOT);
// Sanity on the denominator: the two files of the 0.2.118 double inset must be in scope.
ck('scope: NodeDetailScreen + LogsScreen are pane screens', screens.includes('src/NodeDetailScreen.tsx') && screens.includes('src/LogsScreen.tsx'), `${screens.length} screens`);
ck('scope: reachable set is non-trivial', reachable.length >= 30, `${reachable.length} files`);

const r1 = judgeRootStyle(readFileSync(join(ROOT, 'src', 'app-styles.ts'), 'utf8'));
ck('R1 app-styles root carries no padding (the root applies the inset once, App.tsx)', r1.length === 0, r1.join('; '));

const r2: string[] = [];
for (const rel of reachable) for (const f of judgeNoSecondInset(readFileSync(join(ROOT, rel), 'utf8'))) r2.push(`${rel}:${f}`);
ck(`R2 no second top inset in ${reachable.length} files reachable from ${screens.length} main-window screens`, r2.length === 0, r2.slice(0, 8).join(' | '));

const all = [join(ROOT, 'App.tsx'), ...walk(join(ROOT, 'src'))];
let modalCount = 0;
const r3: string[] = [];
const r4: string[] = [];
for (const abs of all) {
  const rel = posix(relative(ROOT, abs));
  const src = readFileSync(abs, 'utf8');
  if (/<Modal\b/.test(stripComments(src))) {
    const { modals, bad } = judgeModalsUseHelper(src);
    modalCount += modals;
    for (const b of bad) r3.push(`${rel}:${b}`);
  }
  if (!PRIMITIVE_OWNERS.has(rel)) for (const f of judgeHelperBypass(src)) r4.push(`${rel}:${f}`);
}
ck('scope: found the app\'s Modals (≥ 20; 23 on 2026-09-26)', modalCount >= 20, `${modalCount} Modals`);
ck(`R3 every <Modal> subtree applies useModalSafePadding (${modalCount} Modals)`, r3.length === 0, r3.join(' | '));
ck('R4 inset tables only reached through useModalSafePadding / mainWindowTopPadding', r4.length === 0, r4.join(' | '));

console.log(`\n${pass}/${pass + failures.length} passed`);
if (failures.length) { console.error(`FAILED: ${failures.join('; ')}`); process.exit(1); }
