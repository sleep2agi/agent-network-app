// ck-style (self-executing; run by scripts/run-tests.mjs). Covers the WeChat-style
// one-level 「＋」 panel: state machine, per-platform cell list, and ChatScreen wiring.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const { nextPlusPanel, plusPanelItems, plusPanelHeight, cameraAvailable, PLUS_PANEL_DEFAULT_HEIGHT } = await import('./composer-plus-panel');

let ck = 0;
const check = (cond: boolean, msg: string) => { assert.ok(cond, msg); ck++; };

// ── state machine ──────────────────────────────────────────────────────────
{
  const open = nextPlusPanel(false, 'toggle');
  check(open.open === true, 'toggle from closed opens');
  check(open.dismissKeyboard === true, 'opening the panel dismisses the keyboard');
  const close = nextPlusPanel(true, 'toggle');
  check(close.open === false, 'toggle from open closes');
  check(close.dismissKeyboard === false, 'closing via + does not touch the keyboard');

  check(nextPlusPanel(true, 'inputFocus').open === false, 'focusing the input closes the panel');
  check(nextPlusPanel(true, 'keyboardShown').open === false, 'keyboard appearing closes the panel');
  check(nextPlusPanel(false, 'keyboardShown').open === false, 'keyboard never opens the panel');
  check(nextPlusPanel(true, 'itemPicked').open === false, 'picking a cell closes the panel');
  check(nextPlusPanel(true, 'conversationChanged').open === false, 'switching conversation closes the panel');

  const backOpen = nextPlusPanel(true, 'back');
  check(backOpen.open === false && backOpen.handled === true, 'back with panel open: closes it and consumes the back press');
  const backClosed = nextPlusPanel(false, 'back');
  check(backClosed.open === false && backClosed.handled === false, 'back with panel closed: NOT consumed (chat may go back)');

  // toggle twice = original state; keyboard interplay sequence
  let s = false;
  for (const ev of ['toggle', 'inputFocus', 'toggle', 'toggle'] as const) s = nextPlusPanel(s, ev).open;
  check(s === false, 'toggle → focus → toggle → toggle ends closed');
}

// ── cells per platform ─────────────────────────────────────────────────────
const keys = (env: Parameters<typeof plusPanelItems>[0]) => plusPanelItems(env).map(i => i.key).join(',');
// 0.2.105 default: 旁路提问 (BTW) hidden (chat-entry-flags.ts SHOW_BTW_ENTRY = false).
check(keys({ os: 'android', desktop: false, attachEnabled: true }) === 'album,file,camera', 'android default: 相册, 文件, 拍照 — no 旁路提问');
check(keys({ os: 'ios', desktop: false, attachEnabled: true }) === 'album,file,camera', 'ios default: same as android');
check(keys({ os: 'web', desktop: false, attachEnabled: true }) === 'album,file', 'web (mobile layout) default: no camera, no BTW');
check(keys({ os: 'web', desktop: true, attachEnabled: true }) === 'album,file', 'desktop popover default: 图片/文件 only');
check(keys({ os: 'ios', desktop: true, attachEnabled: true }) === 'album,file', 'desktop popover never lists camera, whatever os reports');
check(keys({ os: 'android', desktop: false, attachEnabled: false }) === '', 'attach kill-switch off + BTW hidden: empty');
// With the flag back on (btwEntry: true) the old layout returns unchanged.
check(keys({ os: 'android', desktop: false, attachEnabled: true, btwEntry: true }) === 'album,file,btw,camera', 'btwEntry on: 相册, 文件, 旁路提问, 拍照 (owner priority order)');
check(keys({ os: 'web', desktop: true, attachEnabled: true, btwEntry: true }) === 'album,file,btw', 'btwEntry on, desktop: 图片/文件/旁路提问');
check(keys({ os: 'android', desktop: false, attachEnabled: false, btwEntry: true }) === 'btw', 'btwEntry on, attach off: only 旁路提问');
check(cameraAvailable('android') && cameraAvailable('ios') && !cameraAvailable('web') && !cameraAvailable('windows'), 'camera only on native');
{
  const items = plusPanelItems({ os: 'android', desktop: false, attachEnabled: true, btwEntry: true });
  const byKey = Object.fromEntries(items.map(i => [i.key, i]));
  check(byKey.album.label === '相册' && byKey.file.label === '文件' && byKey.btw.label === '旁路提问' && byKey.camera.label === '拍照', 'cell labels');
  check(byKey.btw.icon === null && items.filter(i => i.key !== 'btw').every(i => typeof i.icon === 'string' && i.icon.length > 0), 'BTW uses the text badge, others an icon');
  check(new Set(items.map(i => i.a11y)).size === items.length, 'a11y labels are distinct');
}

// ── height ─────────────────────────────────────────────────────────────────
check(plusPanelHeight(850) === PLUS_PANEL_DEFAULT_HEIGHT && PLUS_PANEL_DEFAULT_HEIGHT === 260, 'default ≈ 260dp on a normal screen');
check(plusPanelHeight(850, 300) === 300, 'reuses the seen keyboard height');
check(plusPanelHeight(850, 900) === 340 && plusPanelHeight(850, 50) === 200, 'keyboard height clamped to 200..340');
check(plusPanelHeight(400) === 180, 'short landscape: at most 45% of the window');
check(plusPanelHeight(0) === 260, 'unknown window height falls back to the fixed height');

// ── ChatScreen wiring (source contract) ────────────────────────────────────
const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
check(!chat.includes("'发送附件'"), 'the second-level 「发送附件」 Alert is gone');
check(!/Alert\.alert\([^)]*\[\s*\{\s*text:\s*'图片'/.test(chat), 'no 图片/文件 Alert chooser left');
{
  const run = chat.slice(chat.indexOf('const runPlusItem'), chat.indexOf('const plusItems ='));
  check(run.includes("key === 'album') pickInto(pickImage)"), '相册 calls pickImage directly');
  check(run.includes("key === 'file') pickInto(pickDocument)"), '文件 calls pickDocument directly');
  check(run.includes("key === 'camera') pickInto(pickCameraPhoto)"), '拍照 calls pickCameraPhoto directly');
  check(run.includes('appendAttachment(item)'), 'picked items land in the main composer draft');
  check(run.includes("plusEvent('itemPicked')"), 'a tap closes the panel');
  check(!run.includes('Alert.alert(\'发送'), 'no chooser inside runPlusItem');
}
{
  // mobile branch = after `) : (` of the desktop ternary, up to SideThreadDrawer
  const mobile = chat.slice(chat.indexOf('      ) : (\n      <>'), chat.indexOf('<SideThreadDrawer'));
  const rowAt = mobile.indexOf('styles.inputRow');
  const panelAt = mobile.indexOf('accessibilityLabel="更多发送方式面板"');
  check(rowAt > 0 && panelAt > rowAt, 'inline panel renders in the mobile branch, AFTER the input row');
  check(!/<Modal[^>]*visible=\{plusMenuOpen\}/.test(chat), 'mobile no longer uses a full-screen Modal for +');
  check(chat.includes('<Modal visible={desktop && plusMenuOpen}'), 'the popover Modal is desktop-only');
  check(mobile.includes("onPress={() => plusEvent('toggle')}"), 'mobile + toggles');
  check(mobile.includes("onFocus={() => plusEvent('inputFocus')}"), 'input focus closes the panel');
  check(mobile.includes('plusPanelHeight(plusWindowHeight'), 'panel has the fixed height');
  check(mobile.includes('(plusMenuOpen ? 0 : composerInset)'), 'bottom inset moves from the input row to the panel');
}
check(/if \(keyboardVisible\) plusEvent\('keyboardShown'\)/.test(chat), 'keyboard showing closes the panel');
check(/if \(t\.dismissKeyboard && !desktop\) \{\s*mainComposerRef\.current\?\.blur\(\);\s*Keyboard\.dismiss\(\);/.test(chat), 'opening blurs the input and dismisses the keyboard');
{
  const back = chat.slice(chat.indexOf('if (!plusMenuOpen || desktop'), chat.indexOf('if (!plusMenuOpen || desktop') + 300);
  check(back.includes("Platform.OS !== 'android'") && back.includes("BackHandler.addEventListener('hardwareBackPress', () => plusEvent('back'))"), 'Android back closes the panel first');
}
check(chat.includes('keyboardAvoidEnabled(Platform.OS, keyboardVisible)'), '#383 KAV gate untouched');

// ── attach / permissions ───────────────────────────────────────────────────
const attach = readFileSync(new URL('./attach.ts', import.meta.url), 'utf8');
check(attach.includes('requestCameraPermissionsAsync') && attach.includes('launchCameraAsync'), 'camera asks permission then launches');
const appJson = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
const picker = appJson.expo.plugins.find((p: any) => Array.isArray(p) && p[0] === 'expo-image-picker');
check(typeof picker?.[1]?.cameraPermission === 'string' && picker[1].cameraPermission.length > 0, 'iOS camera usage text declared (and CAMERA not blocked on Android)');

console.log(`composer plus panel: ${ck}/${ck} checks passed`);
