// 字体大小 / 界面密度 wiring (source-level; the components import react-native, so they are read as
// text). Each criterion is first fed a known-bad snippet (it must go red), then run on the repo.
// ck style: self-executing, exit 1 on any failure.
import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0;
const failures: string[] = [];
const ck = (name: string, ok: boolean, extra = '') => {
  if (ok) pass++; else failures.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${extra ? ` — ${extra}` : ''}`);
};

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (rel: string) => readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n');

// ── criteria (pure) ──

/** Imports Text / TextInput straight from react-native (bypassing the scaled wrapper). */
export const importsRawText = (src: string): boolean => {
  const re = /import\s*\{([^}]*)\}\s*from\s*'react-native'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1].split(',').map(s => s.trim().replace(/^type\s+/, '')).some(n => n === 'Text' || n === 'TextInput')) return true;
  }
  return false;
};
/** Imports Ionicons from the package instead of ./icons (bypassing density). */
export const importsRawIcons = (src: string): boolean => /from\s*'@expo\/vector-icons'/.test(src);
/** `fontSize: fs(…)` — the wrapper already scales fontSize; this would scale twice. */
export const doubleScalesFont = (src: string): boolean =>
  src.split('\n').some(l => !/^\s*(\/\/|\*|\/\*)/.test(l) && /fontSize:\s*fs\(/.test(l));
/**
 * A module-level (column-0) value that reads density (`spacing.`, `ds(`) but is never rebuilt:
 * a plain `const x = StyleSheet.create({…spacing…})` / `const x = {…ds(…)…}` freezes the density
 * at import time — before the saved preference is even loaded.
 */
export function frozenScaleValues(src: string): string[] {
  const out: string[] = [];
  const re = /^(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(StyleSheet\.create\(|\{)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const end = src.indexOf('\n}', m.index);
    const body = src.slice(m.index, end < 0 ? undefined : end);
    if (/\bspacing\.|\bds\(/.test(body)) out.push(m[1]);
  }
  // Factory bound at module level (`let styles = makeStyles();`) but never rebuilt on restyle.
  const factory = /^const\s+([A-Za-z_$][\w$]*)\s*=\s*\(\)\s*=>\s*(?:\n\s*)?(?:StyleSheet\.create\(|\(\{)/gm;
  while ((m = factory.exec(src))) {
    const f = m[1];
    const end = src.indexOf('\n})', m.index);
    if (!/\bspacing\.|\bds\(/.test(src.slice(m.index, end < 0 ? undefined : end))) continue;
    const bind = new RegExp(`^(?:const|let)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${f}\\(\\)`, 'gm');
    let b: RegExpExecArray | null;
    while ((b = bind.exec(src))) {
      const rebuilt = new RegExp(`onThemeChange\\(\\(\\)\\s*=>\\s*\\{?[\\s\\S]{0,300}?\\b${b[1]}\\s*=\\s*${f}\\(\\)`).test(src);
      if (!rebuilt) out.push(b[1]);
    }
  }
  return out;
}

// known positives / negatives
ck('criterion: raw Text import is caught', importsRawText("import { View, Text } from 'react-native';"));
ck('criterion: raw TextInput (multi-line) is caught', importsRawText("import {\n  View,\n  TextInput,\n} from 'react-native';"));
ck('criterion: TextStyle is not Text', !importsRawText("import { View, type TextStyle } from 'react-native';"));
ck('criterion: raw Ionicons import is caught', importsRawIcons("import { Ionicons } from '@expo/vector-icons';"));
ck('criterion: fontSize: fs( is caught', doubleScalesFont('a: { fontSize: fs(12) }'));
ck('criterion: a comment mentioning it is not code', !doubleScalesFont(' * never write `fontSize: fs(n)`'));
ck('criterion: frozen module-level StyleSheet with spacing is caught', frozenScaleValues("const styles = StyleSheet.create({\n  a: { padding: spacing.md },\n});\n").join() === 'styles');
ck('criterion: frozen plain object with ds() is caught', frozenScaleValues("const rowStyles = {\n  row: { minHeight: ds(68) },\n} as const;\n").join() === 'rowStyles');
ck('criterion: factory bound but never rebuilt is caught', frozenScaleValues("const makeStyles = () => StyleSheet.create({\n  a: { padding: spacing.md },\n});\nlet styles = makeStyles();\n").join() === 'styles');
ck('criterion: factory + onThemeChange rebuild is clean', frozenScaleValues("const makeStyles = () => StyleSheet.create({\n  a: { padding: spacing.md },\n});\nlet styles = makeStyles();\nonThemeChange(() => { styles = makeStyles(); });\n").length === 0);
ck('criterion: plain-object factory (rowStyles) rebuild is clean', frozenScaleValues("const makeRowStyles = () => ({\n  row: { minHeight: ds(68) },\n} as const);\nlet rowStyles = makeRowStyles();\nonThemeChange(() => { rowStyles = makeRowStyles(); });\n").length === 0);

// ── collection ──
// Collected paths are normalised to POSIX here, once: `join` gives `src\icons.tsx` on Windows, and every
// comparison below (exclusions, key surfaces, failure listings) is written with '/'. `read()` joins
// them back onto `root`, which accepts '/' on every platform.
export const toPosix = (p: string): string => p.split(sep).join('/');
const files = ['App.tsx', ...readdirSync(join(root, 'src')).filter(f => /\.tsx?$/.test(f) && !f.includes('.test.')).map(f => toPosix(join('src', f)))];
ck(`collection: ${files.length} source files (≥ 150)`, files.length >= 150);
ck('collection: every path is POSIX (no platform separator leaks into comparisons)', files.every(f => !f.includes('\\')), files.filter(f => f.includes('\\')).slice(0, 3).join(', '));
ck('collection includes the key surfaces', ['src/AgentsScreen.tsx', 'src/MobileNavRail.tsx', 'src/ChatScreen.tsx', 'src/SettingsScreen.tsx'].every(f => files.includes(f)));

// ── repo scan ──
const rawText = files.filter(f => f !== 'src/ui-text.tsx' && importsRawText(read(f)));
ck('every Text/TextInput goes through src/ui-text.tsx', rawText.length === 0, rawText.join(', '));
const rawIcons = files.filter(f => f !== 'src/icons.tsx' && importsRawIcons(read(f)));
ck('every Ionicons goes through src/icons.tsx', rawIcons.length === 0, rawIcons.join(', '));
const doubled = files.filter(f => doubleScalesFont(read(f)));
ck('no fontSize: fs(…) anywhere', doubled.length === 0, doubled.join(', '));
const frozen = files.flatMap(f => frozenScaleValues(read(f)).map(n => `${f}:${n}`));
ck('no module-level value freezes density at import', frozen.length === 0, frozen.join(', '));

// ── the wrapper itself ──
const uiText = read('src/ui-text.tsx');
ck('Text wrapper disables RN\'s own OS scaling (we compose it, capped)', (uiText.match(/\{\.\.\.rest\} allowFontScaling=\{false\}/g) ?? []).length === 2);
ck('allowFontScaling={false} comes after {...rest} (callers cannot re-enable it)', /\{\.\.\.rest\} allowFontScaling=\{false\}/.test(uiText));
const icons = read('src/icons.tsx');
ck('icon wrapper scales size with ds()', icons.includes('size={ds('));
ck('AliasAvatar scales its size with ds() unless given a resolved fixedSize', read('src/AliasAvatar.tsx').includes('const size = fixedSize ? baseSize : ds(baseSize);'));
ck('AliasAvatar initial is fixedSize (follows the box, not the font)', read('src/AliasAvatar.tsx').includes('<Text fixedSize'));

// ── key surfaces ──
const agents = read('src/AgentsScreen.tsx');
ck('agent row: geometry from agentRowGeometry(listDense, densityFactor)', ['const rowGeom = () => agentRowGeometry(uiScale().listDense, uiScale().densityFactor);', '{ minHeight: rowGeom().height }', 'paddingVertical: rowGeom().padY', 'paddingHorizontal: rowGeom().padX', 'avatar: { width: rowGeom().avatar, height: rowGeom().avatar }'].every(s => agents.includes(s)));
ck('agent row: 更紧凑 rows are exactly the shared pitch (denserRowPitch)', agents.includes('...(uiScale().listDense ? { height: denserRowPitch(uiScale().denseFontMultiplier) } : { minHeight: rowGeom().height }),'));
ck('agent row: 更紧凑 separator overlaps instead of adding pitch', agents.includes('...(rowGeom().separatorOverlap ? { marginTop: -StyleSheet.hairlineWidth } : null)'));
ck('agent row: name / preview / time / label use listText roles', ['name: { flexShrink: 1, ...listText(\'name\')', 'preview: { flex: 1, minWidth: 0, ...listText(\'preview\') }', "time: { marginLeft: 'auto', ...listText('meta')", "label: { ...listText('meta')"].every(s => agents.includes(s)));
ck('agent groups: header text = listText meta/count, padding from the geometry', agents.includes("groupTitle: { flexShrink: 1, ...listText('meta')") && agents.includes("groupCount: { ...listText('count')") && agents.includes('paddingTop: rowGeom().groupPadTop, paddingBottom: rowGeom().groupPadBottom'));
ck('agent list publishes the first row top (head + filter bar block + first group header)', agents.includes('listYRef.current = e.nativeEvent.layout.y + e.nativeEvent.layout.height; publishFirstRowTop();') && agents.includes('onLayout={alignFirstRow && section === shownSections[0] ? e => { firstHeaderHRef.current = e.nativeEvent.layout.height; publishFirstRowTop(); } : undefined}') && agents.includes('publishListFirstRowTop(listYRef.current + firstHeaderHRef.current);'));
ck('agent row: rebuilt on restyle', agents.includes('onThemeChange(() => { rowStyles = makeRowStyles(); });'));
ck('agent row: name / preview / time are dense text', ['style={[rowStyles.name,', 'style={[rowStyles.preview,', 'style={[rowStyles.time,'].every(s => agents.includes(`<Text dense selectable={false} numberOfLines={1} ${s}`)));
const rail = read('src/MobileNavRail.tsx');
ck('nav rail: width + items from density', rail.includes('mobileRailWidth(uiScale().densityFactor) + insetLeft') && rail.includes('height: mobileRailItem(uiScale().densityFactor).height'));
ck('nav rail: labels are dense text', rail.includes('<Text dense style={[s.label, selected && s.labelActive]}'));
ck('nav rail: label = listText railLabel', rail.includes("label: { color: colors.textSecondary, ...listText('railLabel'),"));
ck('nav rail: 更紧凑 aligns items to the list (same pitch function, brand block above)', rail.includes('const align = uiScale().listDense ? alignedRailLayout(firstRowTop, denserRowPitch(uiScale().denseFontMultiplier), ds(12) + (showBrand ? ds(40) : 0)) : null;') && rail.includes('align && { height: align.itemHeight }') && rail.includes('align && { paddingTop: align.tabsPaddingTop, gap: align.gap }'));
ck('nav rail: the brand block numbers match its styles (paddingTop ds(12), brand ds(40))', rail.includes('paddingTop: ds(12),') && rail.includes('brand: { width: ds(40), height: ds(40),'));
const chat = read('src/ChatScreen.tsx');
// Density (incl. 更紧凑's one-step list text) must never reach message text: only 字体大小 does.
ck('chat content is independent of density: no list text / row geometry in ChatScreen / MarkdownMessage', ['listText(', 'agentRowGeometry(', 'denserRowPitch('].every(k => !chat.includes(k) && !read('src/MarkdownMessage.tsx').includes(k)));
ck('chat header: action heights via ds()', chat.includes('height: ds(34),') && chat.includes('headerActionCompact: { width: 36, height: ds(34),'));
// Mobile send / ＋ moved into ComposerRowParts.tsx (WeChat row, composer-row-layout.ts).
{
  const rowParts = read('src/ComposerRowParts.tsx');
  ck('composer: send button via ds()', /sendPill: \{\n\s+minWidth: ds\(56\),\n\s+height: ds\(36\),/.test(rowParts));
  ck('composer: ＋ button via ds()', /plusBtn: \{\n\s+width: ds\(36\),\n\s+height: ds\(36\),/.test(rowParts));
}
const node = read('src/NodeDetailScreen.tsx');
ck('node page: tabs/rail rebuilt + ds()', node.includes('onThemeChange(() => { localStyles = makeLocalStyles(); });') && node.includes('width: ds(200),') && node.includes('tabTouch: { minHeight: ds(40, 36)'));
const settings = read('src/SettingsScreen.tsx');
ck('settings: 外观 renders the scale controls', settings.includes("<UiScaleSettings s={styles} showFont={show('appearance', 'fontSize')} showDensity={show('appearance', 'density')} />"));
const app = read('App.tsx');
ck('App: tree is re-keyed by the scale', app.includes('const workspaceKey = `${theme}:${scaleKey}:'));
ck('App: wide layout + OS font scale fed in a layout effect', app.includes("setUiScaleLayoutWide(layout === 'twoPane');") && app.includes('setOsFontScale(scaleSim.osFontScale ?? fontScale ?? 1);') && app.includes('useLayoutEffect(() => {'));
ck('App: desktop reads the saved scale before the first frame', app.includes('const earlyScale = loadDesktopUiScale();'));
ck('App: mobile loads it from SecureStore', app.includes('void loadUiScalePrefs().then('));
ck('App: a scale remount carries the draft (layout handoff bump)', /if \(lastScaleKey\.current !== scaleKey\) \{\n\s+bumpLayoutGeneration\(\);/.test(app));
const storage = read('src/storage.ts');
ck('storage: SecureStore key ui_scale_v1 next to the theme', storage.includes('SecureStore.setItemAsync(UI_SCALE_STORAGE_KEY, raw)') && read('src/desktop-theme-storage.ts').includes("const UI_SCALE_KEY = 'ui_scale_v1';"));

console.log(`\nui-scale wiring: ${pass}/${pass + failures.length} passed`);
if (failures.length) { for (const f of failures) console.error('FAIL:', f); process.exit(1); }
