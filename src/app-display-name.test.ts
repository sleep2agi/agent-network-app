import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const expo = JSON.parse(read('app.json')).expo;
const desktop = JSON.parse(read('src-tauri/tauri.conf.json'));
let p = 0, t = 0;
function ck(name: string, ok: boolean) {
  t++;
  if (ok) p++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
}
ck('mobile app display name', expo.name === 'ANet');
ck('desktop window display name', desktop.app.windows[0].title === 'ANet');
ck('iOS installed identity unchanged', expo.ios.bundleIdentifier === 'top.vansin.agentnetwork');
ck('Android installed identity unchanged', expo.android.package === 'com.anonymous.agentnetworkapp');
ck('Expo slug unchanged', expo.slug === 'agent-network-app');
ck('desktop installed identity unchanged', desktop.identifier === 'top.vansin.agentnetwork.desktop');
// Installer renaming is a separate migration: changing productName changes the default MSI upgrade code.
ck('desktop installer identity waits for migration', desktop.productName === 'Agent Network');
ck('desktop executable identity unchanged', read('src-tauri/Cargo.toml').includes('name = "agent-network-desktop"'));
ck('update endpoints unchanged', JSON.stringify(desktop.plugins.updater.endpoints) === JSON.stringify([
  'https://anet.sh/desktop/update/latest.json',
  'https://modelscope.cn/datasets/SmartFlowAI/agent-network-releases/resolve/master/desktop/latest/latest.json',
]));
for (const file of [
  'App.tsx', 'src/TrayPanel.tsx', 'src/win-title-bar.tsx', 'src/task-window-model.ts',
  'src/desktop-chat-menu.ts', 'src/desktop-settings-window.ts', 'src/settings-model.ts',
  'src/mobile-notify-model.ts', 'src/keep-alive.ts', 'src/notifier-runtime.ts',
  'src/i18n-settings.ts', 'src/task-share-model.ts', 'src/changelog-model.ts',
  'src/NotifyDiagnosticsPanel.tsx', 'src/android-update-core.ts', 'src/xiaomi-guide.ts',
  'src-tauri/src/tray.rs', 'src-tauri/src/chat_notify.rs',
  'modules/anet-keepalive/android/src/main/java/expo/modules/anetkeepalive/AnetKeepAliveService.kt',
]) {
  // Historical comments and old release notes are not renamed.
  const live = read(file).split('\n').filter(line => !line.trimStart().startsWith('//')).join('\n');
  ck(`${file}: current display strings use ANet`, live.includes('ANet') && !live.includes('Agent Network') && !live.includes('#AgentNetwork'));
}
console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
