// Wiring contract for the Android two-pane: App.tsx / ChatScreen / NodeDetailScreen import
// react-native, so (like chat-pins.test.ts) the wiring is checked on source text
// (CRLF-normalised: the Windows runner checks out with autocrlf).
import { readFileSync } from 'node:fs';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n}`); };

const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const node = readFileSync(new URL('./NodeDetailScreen.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// Decision comes from the tested helper, and desktop is still "layout === 'desktop'".
ck('App decides via chooseAppLayout', app.includes('chooseAppLayout({'));
ck('desktop flag is the helper\'s desktop result', app.includes("const desktop = layout === 'desktop';"));
ck('no second inline desktop threshold left in App', !/const desktop = tauriDesktop && width/.test(app));

// Phone branch unchanged: the phone ChatScreen / NodeDetailScreen get none of the new props.
// Indentation-agnostic: these branches sit inside the nav shell (rail slot | content).
const phoneStart = app.search(/\n *\) : screen\.name === 'chat' \? \(/);
const phoneEndRel = app.slice(phoneStart + 1).search(/\n *\) : screen\.name === 'picker' \? \(/);
const phoneEnd = phoneEndRel < 0 ? -1 : phoneStart + 1 + phoneEndRel;
const phone = app.slice(phoneStart, phoneEnd);
ck('phone chat/node branch located', phoneStart > 0 && phoneEnd > phoneStart && phone.includes('<ChatScreen') && phone.includes('<NodeDetailScreen'));
ck('phone ChatScreen keeps its back chevron (no hideBack)', !phone.includes('hideBack'));
ck('phone NodeDetailScreen sizes by window (no layoutWidth / touch)', !phone.includes('layoutWidth') && !/\btouch\b/.test(phone));

// Desktop workspace unchanged: still the desktop ChatScreen, no Android props.
const desk = app.slice(app.indexOf('function DesktopWorkspace('), app.indexOf('function RailButton('));
ck('desktop workspace located', desk.length > 100);
ck('desktop ChatScreen still desktop', desk.includes('desktop\n    />'));
ck('desktop workspace gets no Android props', !desk.includes('hideBack') && !desk.includes('layoutWidth') && !/\btouch\b/.test(desk));

// Two-pane: touch-sized screens, not the desktop (mouse) variants.
const twoStart = app.indexOf('<View style={styles.twoPane} testID="android-two-pane">');
const twoEndRel = app.slice(twoStart).search(/\n *\) : screen\.name === 'chat' \? \(/);
const two = twoEndRel < 0 ? '' : app.slice(twoStart, twoStart + twoEndRel);
ck('two-pane branch located', twoStart > 0 && two.includes('<AgentsScreen') && two.includes('<ChatScreen'));
ck('two-pane list is the phone (non-compact) list: rows stay finger-sized, long-press opens node', !/<AgentsScreen[^>]*\bcompact\b/.test(two));
ck('two-pane ChatScreen is not the desktop (hover) variant', !/<ChatScreen[\s\S]*?\bdesktop\b[\s\S]*?\/>/.test(two.slice(two.indexOf('<ChatScreen'), two.indexOf('/>', two.indexOf('<ChatScreen')) + 2)));
ck('two-pane list highlights the selection', two.includes('selectedAlias={twoPaneSelection.selectedAlias}'));
// With the rail, the panes split the width beside it (not the whole window).
ck('two-pane node screens get pane width + touch', (two.match(/layoutWidth=\{paneAreaWidth - paneListWidth\} touch/g) ?? []).length === 2);
ck('two-pane list width is computed from the area beside the rail', two.includes('{ width: paneListWidth }') && app.includes('const paneListWidth = twoPaneListWidth(paneAreaWidth);'));
ck('pane area = window minus rail and insets when the rail shows', app.includes('const paneAreaWidth = railShown ? contentWidthBesideRail(width, insets.left, insets.right) : width;'));
// Insets: the rail takes the left one (its background runs to the edge), the content the right one.
ck('rail gets the left and bottom insets', /<MobileNavRail[\s\S]*?insetLeft=\{insets\.left\}[\s\S]*?insetBottom=\{tabBarInset\}[\s\S]*?\/>/.test(app));
ck('content beside the rail honours the right inset', app.includes('railShown && { paddingRight: insets.right }'));
ck('each conversation mounts fresh in the pane (keyed by alias)', two.includes('key={`chat:${screen.alias}`}'));

// Fold/unfold handoff: only a switch into/out of twoPane bumps (desktop⇄phone at 860 unchanged).
ck('bump only for twoPane transitions', app.includes("if (lastLayout.current === 'twoPane' || layout === 'twoPane') bumpLayoutGeneration();"));
ck('ChatScreen hands the draft off on unmount', chat.includes('releaseOnUnmount(draftHandoffKey, draftRef.current, mountedGeneration)') && chat.includes('takeHandoff<string>(draftHandoffKey)'));
ck('ChatScreen hides back only when asked', chat.includes('{!desktop && !hideBack ? ('));
ck('NodeDetailScreen hands the tab off on unmount', node.includes('releaseOnUnmount(sectionHandoffKey, activeSectionRef.current, mountedGeneration)') && node.includes('takeHandoff<NodeSectionKey>(sectionHandoffKey)'));
ck('NodeDetailScreen falls back to window width', node.includes('const width = layoutWidth ?? windowWidth;'));

// ── nav chrome: rail on the two-pane, bottom tabs on the phone, one shell for both ──
ck('App decides chrome via navChromeFor(layout, screen.name)', app.includes('const navChrome = navChromeFor(layout, screen.name);'));
ck('rail renders only when navChrome is rail', app.includes("const railShown = navChrome === 'rail';") && /\{railShown \? \(\s*<MobileNavRail/.test(app));
ck('bottom tab bar renders only when navChrome is bottomTabs (exactly one call site)', (app.match(/mobileTabBar\(/g) ?? []).length === 1 && app.includes("{navChrome === 'bottomTabs' ? mobileTabBar(navActive) : null}"));
ck('rail uses the same destinations as the phone tabs', /<MobileNavRail[\s\S]*?tabs=\{MOBILE_TABS\}/.test(app));
ck('rail and tabs share one active key and one press handler', /<MobileNavRail[\s\S]*?active=\{navActive\}[\s\S]*?onSelect=\{onNavPress\}/.test(app) && app.includes('onPress={() => onNavPress(tab.key)}'));
ck('press on the current destination is a no-op (keeps the open chat)', app.includes('const next = screenForNavPress(key, screen.name);') && app.includes('if (next) setScreen(next as Screen);'));
ck('brand/version hidden on short windows via railShowsBrand(height)', app.includes('showBrand={railShowsBrand(height)}'));
// Tree stability: the rail is a slot *before* the content inside the same shell, so the
// content element keeps its position when the rail appears/disappears (fold/unfold).
const shellStart = app.indexOf('<View style={styles.navShell} testID="nav-shell">');
const railAt = app.indexOf('{railShown ? (', shellStart);
const contentAt = app.indexOf('<View style={[styles.navContent,', shellStart);
const twoAt = app.indexOf('{twoPaneSelection ? (', shellStart);
ck('shell → rail slot → content → (two-pane | phone screens), in that order', shellStart > 0 && shellStart < railAt && railAt < contentAt && contentAt < twoAt);
ck('rail slot renders null (not a different element) when hidden', /\{railShown \? \([\s\S]*?<MobileNavRail[\s\S]*?\/>\s*\) : null\}/.test(app.slice(shellStart, contentAt)));
// Desktop untouched: its workspace never mounts the mobile rail.
ck('desktop workspace does not mount MobileNavRail', !desk.includes('MobileNavRail'));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
