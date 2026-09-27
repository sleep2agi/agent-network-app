// Guard: a screen the desktop workspace renders in its right pane never shows the phone back header,
// and the window-pin never floats over that pane. See pane-header.ts / DesktopWindowPin.tsx.
//
// Two layers, checked separately (CLAUDE.md ⑤ of the main repo):
//   judge      — given a screen's source, is an ungated back affordance flagged?
//   collection — is every *Screen the workspace renders actually looked at (not just the list
//                pane-header.ts happens to name)?
import { existsSync, readFileSync as readRaw } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PANE_BACK_TEST_ID, PANE_SCREENS_WITH_BACK, paneShowsBack } from './pane-header';

let p = 0, t = 0;
const ck = (n: string, c: boolean, extra = '') => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n}${extra ? ` (${extra})` : ''}`); };

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const posix = (s: string) => s.split(sep).join('/');
const read = (rel: string) => readRaw(join(root, ...rel.split('/')), 'utf8').replace(/\r\n?/g, '\n');

// ── model ──
ck('model: desktop → no back', paneShowsBack(true) === false);
ck('model: phone / two-pane → back', paneShowsBack(false) === true && paneShowsBack(undefined) === true);

// ── judge ──
/** Back affordances: an Ionicons chevron-back, or the `‹` glyph as text. */
const BACK_GLYPH = /name="chevron-back"|>‹<\/Text>|>‹ /g;
/**
 * Every back glyph must sit in an element tagged testID={PANE_BACK_TEST_ID}, and every such tag must
 * be behind a `paneShowsBack(` / `showBack` condition shortly before it. Returns the problems.
 */
function judgeScreen(src: string): string[] {
  const problems: string[] = [];
  for (const m of src.matchAll(BACK_GLYPH)) {
    const before = src.slice(Math.max(0, m.index! - 500), m.index!);
    const tagAt = before.lastIndexOf(`testID={${'PANE_BACK_TEST_ID'}}`);
    if (tagAt < 0) { problems.push(`untagged back glyph at offset ${m.index}`); continue; }
    const gateWindow = before.slice(Math.max(0, tagAt - 400), tagAt);
    if (!/paneShowsBack\(|showBack\s*\?|!showBack|showBack\s*&&/.test(gateWindow)) problems.push(`back at offset ${m.index} not gated on paneShowsBack`);
  }
  return problems;
}
const GOOD = `{paneShowsBack(desktop) ? (\n  <Pressable testID={PANE_BACK_TEST_ID} onPress={onBack}>\n    <Ionicons name="chevron-back" />\n  </Pressable>\n) : null}`;
const BAD_UNGATED = `<Pressable testID={PANE_BACK_TEST_ID} onPress={onBack}>\n  <Ionicons name="chevron-back" />\n</Pressable>`;
const BAD_UNTAGGED = `<Pressable onPress={onBack}><Text style={x}>‹</Text></Pressable>`;
ck('judge self-test: gated + tagged passes', judgeScreen(GOOD).length === 0);
ck('judge self-test: ungated back is flagged', judgeScreen(BAD_UNGATED).length === 1);
ck('judge self-test: untagged ‹ is flagged', judgeScreen(BAD_UNTAGGED).length === 1);
ck('judge self-test: the 0.2.124 LogsScreen header would be flagged',
  judgeScreen(`<Pressable onPress={onBack} testID="logs-back">\n<Ionicons name="chevron-back" size={22} />\n<Text>Server</Text>`).length === 1);

// ── App.tsx: the desktop workspace ──
const app = read('App.tsx');
const wsStart = app.indexOf('function DesktopWorkspace(');
const wsEnd = app.indexOf('\nfunction ', wsStart + 10);
const workspace = wsStart >= 0 && wsEnd > wsStart ? app.slice(wsStart, wsEnd) : '';
ck('collection: DesktopWorkspace found in App.tsx', workspace.length > 1000, `${workspace.length} chars`);

/** Every `<Name …/>` element in `block`, with its full prop text. */
const elements = (block: string) => [...block.matchAll(/<([A-Z]\w*Screen)\b([\s\S]*?)\/>/g)].map(m => ({ name: m[1], props: m[2] }));
const els = elements(workspace);
ck('collection: workspace renders ≥ 10 screen elements', els.length >= 10, els.map(e => e.name).join(','));

for (const e of els.filter(e => /\bonBack=/.test(e.props))) {
  ck(`App.tsx: <${e.name} onBack> in the desktop workspace passes \`desktop\``, /(^|\s)desktop(\s|=\{true\}|$)/.test(e.props));
}

// Collection: every screen the workspace renders is inspected — a screen with a back glyph must be in
// PANE_SCREENS_WITH_BACK (judged above) or be an exemption whose own gate is checked here.
const EXEMPT: Record<string, { gate: RegExp; why: string }> = {
  ChatScreen: { gate: /\{!desktop && !hideBack \? \(/, why: 'back already hidden when `desktop`' },
  SettingsScreen: { gate: /\{compact \? \(subPage \? phoneHeader : listHeader\) : sidebar\}/, why: 'phone header only in the compact (< 640 dp) branch; desktop is ≥ 860' },
  ScheduledTasksScreen: { gate: /onBack=\{wide \? undefined :/, why: 'detail back only in the narrow master/detail branch' },
};
function collect(block: string, fileOf: (name: string) => string | null): { name: string; verdict: string }[] {
  const out: { name: string; verdict: string }[] = [];
  for (const name of new Set(elements(block).map(e => e.name))) {
    const src = fileOf(name);
    if (src === null) { out.push({ name, verdict: 'missing-file' }); continue; }
    const hasBack = new RegExp(BACK_GLYPH.source).test(src);
    if (!hasBack) { out.push({ name, verdict: 'no-back' }); continue; }
    if (PANE_SCREENS_WITH_BACK[name]) { out.push({ name, verdict: judgeScreen(src).length ? 'ungated' : 'gated' }); continue; }
    const ex = EXEMPT[name];
    out.push({ name, verdict: ex ? (ex.gate.test(src) ? 'exempt' : 'exempt-gate-missing') : 'unlisted-with-back' });
  }
  return out;
}
const fileOf = (name: string) => {
  const rel = PANE_SCREENS_WITH_BACK[name] ?? `src/${name}.tsx`;
  return existsSync(join(root, ...rel.split('/'))) ? read(rel) : null;
};
const verdicts = collect(workspace, fileOf);
for (const v of verdicts) {
  ck(`workspace screen ${v.name}: ${v.verdict}`, ['no-back', 'gated', 'exempt'].includes(v.verdict));
}
for (const name of Object.keys(PANE_SCREENS_WITH_BACK)) {
  ck(`listed screen ${name} is rendered by the workspace`, verdicts.some(v => v.name === name));
}
// Collection self-test: a new screen with a phone back that nobody listed must not slip through.
const fakeBlock = `<BrandNewScreen cfg={cfg} onBack={() => {}} />`;
const fakeVerdict = collect(fakeBlock, () => BAD_UNTAGGED);
ck('collection self-test: an unlisted screen with a back glyph is caught', fakeVerdict[0]?.verdict === 'unlisted-with-back');
ck('collection self-test: a listed screen that loses its gate is caught', collect(`<LogsScreen cfg={cfg} />`, () => BAD_UNGATED)[0]?.verdict === 'ungated');

// ── the window pin: real layout space in the main window ──
const mainStart = app.indexOf('if (desktop && cfg && screen.name !== \'login\')');
const mainReturn = mainStart >= 0 ? app.slice(mainStart, app.indexOf('\n  }\n', mainStart)) : '';
ck('pin: main desktop window branch found', mainReturn.length > 100);
ck('pin: main desktop window does not render the floating pin', !/<DesktopWindowPin\s*\/>|<DesktopWindowPin(?![^>]*placement="rail")[^>]*\/>/.test(mainReturn));
ck('pin: the rail renders it (placement="rail")', /<DesktopWindowPin[^>]*placement="rail"[^>]*\/>/.test(workspace));
const pin = read('src/DesktopWindowPin.tsx');
ck('pin: rail placement has no absolute positioning', /placement === 'rail' \? \{(?![^}]*position: 'absolute')[^}]*\}/.test(pin));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
