import {
  ANDROID_TWO_PANE_MIN_WIDTH, TAURI_DESKTOP_MIN_WIDTH, chooseAppLayout, isAndroidLike,
  paneSelectionFor, screenForPaneSelection, splitsInTwoPane, twoPaneListWidth,
} from './wide-layout';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log(`PASS: ${n}`); } else console.log(`FAIL: ${n}`); };

const ANDROID_WEB_UA = 'Mozilla/5.0 (Linux; Android 14; 2308CPXD0C) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Edg/128.0';

// ── threshold constant ──
ck('threshold is the documented 700 dp', ANDROID_TWO_PANE_MIN_WIDTH === 700);
ck('desktop threshold unchanged at 860', TAURI_DESKTOP_MIN_WIDTH === 860);

// ── Android: real device widths ──
const android = (width: number) => chooseAppLayout({ os: 'android', tauri: false, width });
ck('MIX Fold cover (≈392 dp) → phone', android(392) === 'phone');
ck('large phone portrait (480 dp) → phone', android(480) === 'phone');
ck('7" tablet portrait (600 dp) → phone', android(600) === 'phone');
ck('just below threshold (699.9) → phone', android(699.9) === 'phone');
ck('exactly threshold (700) → twoPane', android(700) === 'twoPane');
ck('MIX Fold inner (≈800 dp) → twoPane', android(800) === 'twoPane');
ck('MIX Fold inner (≈900 dp) → twoPane', android(900) === 'twoPane');
ck('10" tablet landscape (1280 dp) → twoPane', android(1280) === 'twoPane');
ck('Android never gets the desktop workspace, even at 1600 dp', android(1600) !== 'desktop');

// ── web build in an Android browser takes the Android branch ──
ck('isAndroidLike: native android', isAndroidLike('android'));
ck('isAndroidLike: web + Android UA', isAndroidLike('web', ANDROID_WEB_UA));
ck('isAndroidLike: not web + mac UA', !isAndroidLike('web', MAC_UA));
ck('isAndroidLike: not ios', !isAndroidLike('ios', ANDROID_WEB_UA));
ck('isAndroidLike: "android" substring inside a word is not a match', !isAndroidLike('web', 'Mozilla/5.0 NotAndroidish'));
ck('web + Android UA at 900 → twoPane', chooseAppLayout({ os: 'web', tauri: false, userAgent: ANDROID_WEB_UA, width: 900 }) === 'twoPane');
// Android UA wins over the Tauri global: a real Tauri desktop webview never sends an Android UA,
// and the mocked-Tauri Playwright harness relies on this to render the Android branch.
ck('web + Android UA + tauri global at 900 → twoPane', chooseAppLayout({ os: 'web', tauri: true, userAgent: ANDROID_WEB_UA, width: 900 }) === 'twoPane');
ck('web + Android UA + tauri global at 400 → phone', chooseAppLayout({ os: 'web', tauri: true, userAgent: ANDROID_WEB_UA, width: 400 }) === 'phone');
ck('web + Android UA at 400 → phone', chooseAppLayout({ os: 'web', tauri: false, userAgent: ANDROID_WEB_UA, width: 400 }) === 'phone');

// ── desktop (Tauri) unchanged: exactly `tauri && width >= 860` ──
for (const ua of [MAC_UA, WIN_UA, '']) {
  for (const w of [320, 520, 699, 700, 800, 859, 860, 861, 1280, 2560]) {
    const got = chooseAppLayout({ os: 'web', tauri: true, userAgent: ua, width: w });
    const before = w >= 860 ? 'desktop' : 'phone';
    ck(`tauri ${ua ? ua.slice(13, 22) : 'no-UA'} @${w} → ${before} (as before)`, got === before);
  }
}

// ── phone / iOS / plain web unchanged: always the phone stack ──
for (const w of [320, 390, 700, 900, 1366]) {
  ck(`ios @${w} → phone (unchanged)`, chooseAppLayout({ os: 'ios', tauri: false, width: w }) === 'phone');
  ck(`plain web (desktop browser) @${w} → phone (unchanged)`, chooseAppLayout({ os: 'web', tauri: false, userAgent: MAC_UA, width: w }) === 'phone');
}

// ── list pane width ──
ck('list width at 700 = 320 (min)', twoPaneListWidth(700) === 320);
ck('list width at 900 = 342', twoPaneListWidth(900) === 342);
ck('list width at 1280 = 400 (max)', twoPaneListWidth(1280) === 400);
ck('detail pane at threshold ≥ 380', 700 - twoPaneListWidth(700) >= 380);

// ── which screens split ──
ck('agents splits', splitsInTwoPane({ name: 'agents' }));
ck('chat splits', splitsInTwoPane({ name: 'chat', alias: 'a' }));
ck('nodeDetail splits', splitsInTwoPane({ name: 'nodeDetail', alias: 'a' }));
ck('nodeInfo splits', splitsInTwoPane({ name: 'nodeInfo', alias: 'a' }));
for (const name of ['tasks', 'scheduled', 'messages', 'server', 'serverNodes', 'settings', 'logs', 'picker', 'wizard', 'taskDetail', 'login']) {
  ck(`${name} stays full width`, !splitsInTwoPane({ name }));
}
ck('chat without alias does not split', !splitsInTwoPane({ name: 'chat' }));

// ── stack → panes ──
const s1 = paneSelectionFor({ name: 'chat', alias: '节点A' });
ck('chat → selected 节点A, detail chat', s1?.selectedAlias === '节点A' && s1?.detail === 'chat');
const s2 = paneSelectionFor({ name: 'nodeDetail', alias: '节点B' });
ck('nodeDetail → selected 节点B, detail nodeDetail', s2?.selectedAlias === '节点B' && s2?.detail === 'nodeDetail');
const s3 = paneSelectionFor({ name: 'nodeInfo', alias: '节点C' });
ck('nodeInfo → selected 节点C, detail nodeInfo', s3?.selectedAlias === '节点C' && s3?.detail === 'nodeInfo');
const s4 = paneSelectionFor({ name: 'agents' });
ck('agents → nothing selected, empty detail', s4 !== null && s4.selectedAlias === undefined && s4.detail === null);
ck('tasks → null (full width)', paneSelectionFor({ name: 'tasks' }) === null);

// ── panes → stack ──
const b1 = screenForPaneSelection({ selectedAlias: '节点A', detail: 'chat' });
ck('selected chat → chat screen', b1.name === 'chat' && (b1 as any).alias === '节点A');
ck('no detail → agents', screenForPaneSelection({ detail: null }).name === 'agents');
ck('detail without alias → agents', screenForPaneSelection({ detail: 'chat' }).name === 'agents');

// ── round trip both ways ──
const screens = [{ name: 'agents' }, { name: 'chat', alias: 'x' }, { name: 'nodeDetail', alias: 'y' }, { name: 'nodeInfo', alias: 'z' }];
for (const s of screens) {
  const back = screenForPaneSelection(paneSelectionFor(s)!);
  ck(`stack→panes→stack identity for ${s.name}`, JSON.stringify(back) === JSON.stringify(s));
}
const sels = [{ detail: null }, { selectedAlias: 'x', detail: 'chat' as const }, { selectedAlias: 'y', detail: 'nodeDetail' as const }, { selectedAlias: 'z', detail: 'nodeInfo' as const }];
for (const sel of sels) {
  const back = paneSelectionFor(screenForPaneSelection(sel))!;
  ck(`panes→stack→panes identity for ${sel.detail}`, back.detail === sel.detail && back.selectedAlias === (sel as any).selectedAlias);
}

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
