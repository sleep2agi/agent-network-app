import { readFileSync } from 'node:fs';
import {
  ANDROID_TWO_PANE_MIN_WIDTH, IPAD_TWO_PANE_MIN_WIDTH, TAURI_DESKTOP_MIN_WIDTH, chooseAppLayout, isAndroidLike, isIPadLike,
  paneSelectionFor, screenForPaneSelection, splitsInTwoPane, twoPaneListWidth,
  CHAT_PANE_MIN_WIDTH, LIST_PANE_DEFAULT_WIDTH, LIST_PANE_MAX_WIDTH, LIST_PANE_MIN_WIDTH, listWidthFromDrag, parseStoredListWidth,
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

// ── iPad: landscape splits, portrait keeps the phone stack (owner, iPad TestFlight) ──
const IPAD_WEB_UA = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ipad = (width: number, height: number) => chooseAppLayout({ os: 'ios', tauri: false, width, height, isPad: true });
ck('iPad threshold is 1024 pt', IPAD_TWO_PANE_MIN_WIDTH === 1024);
for (const [w, h, name] of [[1024, 768, '9.7"'], [1080, 810, '10.2"'], [1133, 744, 'mini 6'], [1180, 820, '10.9" Air'], [1194, 834, '11" Pro'], [1366, 1024, '12.9" Pro']] as const) {
  ck(`iPad ${name} landscape ${w}×${h} → twoPane`, ipad(w, h) === 'twoPane');
  ck(`iPad ${name} portrait ${h}×${w} → phone`, ipad(h, w) === 'phone');
}
// 12.9" portrait is exactly as wide as 9.7" landscape: only the orientation tells them apart.
ck('iPad 12.9" portrait 1024×1366 → phone (width alone would have split it)', ipad(1024, 1366) === 'phone');
ck('iPad Split View / Stage Manager window 981×1024 → phone', ipad(981, 1024) === 'phone');
ck('iPad landscape window narrower than 1024 (e.g. 2/3 split 980×768) → phone', ipad(980, 768) === 'phone');
ck('iPad with no height (caller did not pass it) → phone, never a guess', chooseAppLayout({ os: 'ios', tauri: false, width: 1366, isPad: true }) === 'phone');
ck('iPad never gets the desktop workspace', ipad(1366, 1024) !== 'desktop' && ipad(2000, 1000) !== 'desktop');
// Rotation: the same device re-evaluated with swapped dimensions flips both ways.
ck('rotation portrait→landscape→portrait: phone→twoPane→phone', ipad(820, 1180) === 'phone' && ipad(1180, 820) === 'twoPane' && ipad(820, 1180) === 'phone');
// iPhone landscape: isPad false → unchanged phone stack.
ck('iPhone Pro Max landscape 932×430 → phone (unchanged)', chooseAppLayout({ os: 'ios', tauri: false, width: 932, height: 430, isPad: false }) === 'phone');
ck('iPhone at an iPad-sized width without isPad → phone', chooseAppLayout({ os: 'ios', tauri: false, width: 1366, height: 1024 }) === 'phone');
ck('isIPadLike: native ios + isPad', isIPadLike('ios', true));
ck('isIPadLike: not ios without isPad', !isIPadLike('ios', false));
ck('isIPadLike: android never', !isIPadLike('android', true, IPAD_WEB_UA));
ck('isIPadLike: web + iPad UA (harness)', isIPadLike('web', false, IPAD_WEB_UA));
ck('isIPadLike: web + Mac UA (iPadOS Safari desktop mode) → no', !isIPadLike('web', false, MAC_UA));
ck('web + iPad UA landscape 1180×820 → twoPane', chooseAppLayout({ os: 'web', tauri: false, userAgent: IPAD_WEB_UA, width: 1180, height: 820 }) === 'twoPane');
ck('web + iPad UA portrait 820×1180 → phone', chooseAppLayout({ os: 'web', tauri: false, userAgent: IPAD_WEB_UA, width: 820, height: 1180 }) === 'phone');
// Android is unaffected by height: a portrait 10" tablet at 800 dp still splits as before.
ck('android portrait 800×1280 still twoPane (height ignored)', chooseAppLayout({ os: 'android', tauri: false, width: 800, height: 1280 }) === 'twoPane');

// ── phone / iOS (no isPad) / plain web unchanged: always the phone stack ──
for (const w of [320, 390, 700, 900, 1366]) {
  ck(`ios @${w} → phone (unchanged)`, chooseAppLayout({ os: 'ios', tauri: false, width: w }) === 'phone');
  ck(`plain web (desktop browser) @${w} → phone (unchanged)`, chooseAppLayout({ os: 'web', tauri: false, userAgent: MAC_UA, width: w }) === 'phone');
}

// ── list pane width ──
// 0.2.106: a fixed default (320) the user drags within 260–420, not 38% of the area.
// Areas are the width beside the 72 dp rail (window − 72).
ck('default list width is 320 on a roomy area (1128 = 1200 window)', twoPaneListWidth(1128) === 320);
ck('default does not grow with the window (2000)', twoPaneListWidth(2000) === 320);
ck('unfolded MIX Fold area (≈808) keeps the default 320', twoPaneListWidth(808) === 320);
ck('at the 700 threshold (area 628) the chat keeps ≥ 320: list 308', twoPaneListWidth(628) === 308 && 628 - twoPaneListWidth(628) >= 320);
ck('tiny area never pushes the list below 260', twoPaneListWidth(400) === 260);
ck('dragged width is honoured inside the bounds', twoPaneListWidth(1128, 300) === 300 && twoPaneListWidth(1128, 400) === 400);
ck('dragged width clamps to 420 max', twoPaneListWidth(1128, 900) === 420);
ck('dragged width clamps to 260 min', twoPaneListWidth(1128, 100) === 260);
ck('max also leaves the chat 320 (area 700 → ≤ 380)', twoPaneListWidth(700, 420) === 380);
ck('NaN / 0 / negative preference → default', twoPaneListWidth(1128, NaN) === 320 && twoPaneListWidth(1128, 0) === 320 && twoPaneListWidth(1128, -5) === 320);
ck('fractional preference rounds', twoPaneListWidth(1128, 300.6) === 301);
ck('constants are the documented 320 / 260 / 420 / chat 320',
  LIST_PANE_DEFAULT_WIDTH === 320 && LIST_PANE_MIN_WIDTH === 260 && LIST_PANE_MAX_WIDTH === 420 && CHAT_PANE_MIN_WIDTH === 320);
ck('drag right widens, left narrows, both clamped', listWidthFromDrag(320, 40, 1128) === 360 && listWidthFromDrag(320, -40, 1128) === 280
  && listWidthFromDrag(320, 500, 1128) === 420 && listWidthFromDrag(320, -500, 1128) === 260);
ck('drag with NaN dx stays put', listWidthFromDrag(333, NaN, 1128) === 333);
ck('stored width parses and clamps', parseStoredListWidth('300') === 300 && parseStoredListWidth('9999') === 420 && parseStoredListWidth('12') === 260);
ck('stored garbage reads as never saved', [null, undefined, '', 'abc', '0', '-3', 'Infinity'].every(v => parseStoredListWidth(v as any) === null));

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

// ── app.json must not lock orientation (0.2.100) ──
// "portrait" → expo prebuild writes android:screenOrientation="portrait" → Android letterboxes the app on an
// unfolded foldable in landscape and the two-pane branch above never sees the wide width (Vincent's screenshot).
// The built APK is checked too (android-build.yml, aapt2 xmltree); this catches it at PR time.
{
  const appJson = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
  const orientation = appJson.expo?.orientation;
  ck(`app.json orientation is "default" (got ${JSON.stringify(orientation)})`, orientation === 'default');
  ck('android block does not set its own orientation / resizeableActivity lock',
    appJson.expo?.android?.orientation === undefined && appJson.expo?.android?.resizeableActivity !== false);
  ck('iPad stays multitasking-capable (ios.requireFullScreen not true)', appJson.expo?.ios?.requireFullScreen !== true);
}

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
