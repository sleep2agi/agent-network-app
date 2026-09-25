// Wiring contract for the Android two-pane: App.tsx / ChatScreen / NodeDetailScreen import
// react-native, so (like chat-pins.test.ts) the wiring is checked on source text.
import { readFileSync } from 'node:fs';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n}`); };

const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
const node = readFileSync(new URL('./NodeDetailScreen.tsx', import.meta.url), 'utf8');

// Decision comes from the tested helper, and desktop is still "layout === 'desktop'".
ck('App decides via chooseAppLayout', app.includes('chooseAppLayout({'));
ck('desktop flag is the helper\'s desktop result', app.includes("const desktop = layout === 'desktop';"));
ck('no second inline desktop threshold left in App', !/const desktop = tauriDesktop && width/.test(app));

// Phone branch unchanged: the phone ChatScreen / NodeDetailScreen get none of the new props.
const phoneStart = app.indexOf("\n      ) : screen.name === 'chat' ? (");
const phoneEnd = app.indexOf("\n      ) : screen.name === 'picker' ? (", phoneStart);
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
const twoStart = app.indexOf('<View style={[styles.twoPane,');
const two = app.slice(twoStart, app.indexOf("{mobileTabBar('agents')}", twoStart));
ck('two-pane branch located', twoStart > 0 && two.includes('<AgentsScreen') && two.includes('<ChatScreen'));
ck('two-pane list is the phone (non-compact) list: rows stay finger-sized, long-press opens node', !/<AgentsScreen[^>]*\bcompact\b/.test(two));
ck('two-pane ChatScreen is not the desktop (hover) variant', !/<ChatScreen[\s\S]*?\bdesktop\b[\s\S]*?\/>/.test(two.slice(two.indexOf('<ChatScreen'), two.indexOf('/>', two.indexOf('<ChatScreen')) + 2)));
ck('two-pane list highlights the selection', two.includes('selectedAlias={twoPaneSelection.selectedAlias}'));
ck('two-pane node screens get pane width + touch', (two.match(/layoutWidth=\{width - twoPaneListWidth\(width\)\} touch/g) ?? []).length === 2);
ck('two-pane honours left/right safe-area insets', two.includes('paddingLeft: insets.left, paddingRight: insets.right'));
ck('each conversation mounts fresh in the pane (keyed by alias)', two.includes('key={`chat:${screen.alias}`}'));

// Fold/unfold handoff: only a switch into/out of twoPane bumps (desktop⇄phone at 860 unchanged).
ck('bump only for twoPane transitions', app.includes("if (lastLayout.current === 'twoPane' || layout === 'twoPane') bumpLayoutGeneration();"));
ck('ChatScreen hands the draft off on unmount', chat.includes('releaseOnUnmount(draftHandoffKey, draftRef.current, mountedGeneration)') && chat.includes('takeHandoff<string>(draftHandoffKey)'));
ck('ChatScreen hides back only when asked', chat.includes('{!desktop && !hideBack ? ('));
ck('NodeDetailScreen hands the tab off on unmount', node.includes('releaseOnUnmount(sectionHandoffKey, activeSectionRef.current, mountedGeneration)') && node.includes('takeHandoff<NodeSectionKey>(sectionHandoffKey)'));
ck('NodeDetailScreen falls back to window width', node.includes('const width = layoutWidth ?? windowWidth;'));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
