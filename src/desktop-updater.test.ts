import fs from 'node:fs';

const source = fs.readFileSync(new URL('./desktop-updater.ts', import.meta.url), 'utf8');
const prompt = fs.readFileSync(new URL('./DesktopUpdatePrompt.tsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const settings = fs.readFileSync(new URL('./SettingsScreen.tsx', import.meta.url), 'utf8');
const androidUpdater = fs.readFileSync(new URL('./android-updater.ts', import.meta.url), 'utf8');
const config = JSON.parse(fs.readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const capability = JSON.parse(fs.readFileSync(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8'));

const checks: Array<[string, boolean]> = [
  ['startup mounts automatic update prompt', app.includes('<DesktopUpdatePrompt />')],
  ['detached chat windows do not mount the prompt (2026-09-06 screenshot: every window prompted)', app.includes('{dedicatedChatWindow ? null : <DesktopUpdatePrompt />}') && app.includes('!!requestedChatAlias()')],
  ['prompt shows only the newest section in a bounded scroll view', prompt.includes('latestReleaseNotes(update.notes)') && prompt.includes('<ScrollView style={styles.notesScroll}') && prompt.includes('maxHeight: 240')],
  ['install button stays outside the scroll view', prompt.indexOf('</ScrollView>') < prompt.indexOf('installDesktopUpdate()')],
  ['startup check is delayed and non-blocking', prompt.includes('setTimeout') && prompt.includes('checkDesktopUpdate')],
  ['manual settings check exists', settings.includes('checkDesktopUpdate')],
  ['download and install reports progress', source.includes('downloadAndInstall') && source.includes("kind: 'downloading'")],
  ['successful install relaunches', source.includes("plugin-process") && source.includes('await relaunch()')],
  ['relaunch stops the local Hub first (app#246: no orphaned old sidecar)', source.includes('await stopLocalHub().catch(') && source.indexOf('await stopLocalHub()') < source.indexOf('await relaunch()')],
  ['non-Tauri platforms stay unsupported', source.includes("kind: 'unsupported'")],
  ['offline checks clear stale staged updates', source.includes('pendingUpdate = undefined') && source.includes('checkOverride')],
  ['signed updater artifacts are enabled', config.bundle.createUpdaterArtifacts === true],
  ['stable anet.sh updater endpoint configured', config.plugins.updater.endpoints[0] === 'https://anet.sh/desktop/update/latest.json'],
  // Tauri tries endpoints in order and moves on only when one errors or answers non-2xx (the
  // anet.sh route answers 503 when both GitHub and its fallback.json fail). The ModelScope
  // manifest is written by .github/workflows/modelscope-mirror.yml with platform URLs on
  // ModelScope and the original signatures (the plugin verifies the signature over the
  // downloaded bytes, which are identical). It must stay second: it lags publishing by the
  // mirror run, and anet.sh is the activation boundary.
  ['ModelScope China mirror is the second (fallback) updater endpoint', config.plugins.updater.endpoints.length === 2
    && config.plugins.updater.endpoints[1] === 'https://modelscope.cn/datasets/SmartFlowAI/agent-network-releases/resolve/master/desktop/latest/latest.json'],
  ['updater public key configured', typeof config.plugins.updater.pubkey === 'string' && config.plugins.updater.pubkey.length > 80],
  ['frontend update permissions enabled', capability.permissions.includes('updater:default') && capability.permissions.includes('process:allow-restart')],
  // 安卓(app 2026-09-25「安卓点击更新好像更新不了」):同一行在安卓上走 GitHub release 的 APK,不再落到「不支持」。
  ['settings row calls the Android check on Android', /if \(isAndroid\) void checkAndroidUpdate\(APP_VERSION\);\s*else void checkDesktopUpdate\(undefined, \{ manual: true \}\);/.test(settings)],
  ['settings row renders the Android view on Android', settings.includes('? describeAndroidUpdateRow(androidUpdate')],
  ['App mounts the Android prompt only on Android', app.includes("{Platform.OS === 'android' ? <AndroidUpdatePrompt /> : null}")],
  ['installer intent grants read permission on a content:// uri', androidUpdater.includes('getContentUriAsync(current.fileUri)') && androidUpdater.includes('flags: 1, // Intent.FLAG_GRANT_READ_URI_PERMISSION') && androidUpdater.includes("'android.intent.action.VIEW'")],
];
for (const [name, ok] of checks) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}
