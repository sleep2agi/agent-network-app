import fs from 'node:fs';

const app = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const settings = fs.readFileSync(new URL('./SettingsScreen.tsx', import.meta.url), 'utf8');
const bridge = fs.readFileSync(new URL('./local-hub.ts', import.meta.url), 'utf8');
const rust = fs.readFileSync(new URL('../src-tauri/src/local_hub.rs', import.meta.url), 'utf8');

const checks: Array<[string, boolean]> = [
  ['first run offers recommended local workspace', app.includes('开始使用（本地）')],
  ['first run retains explicit remote-server path', app.includes('连接已有服务器')],
  ['saved local profile starts before workspace restore', app.includes("stored?.profileId === LOCAL_HUB_PROFILE_ID") && app.includes('await startLocalHub()')],
  ['settings exposes local Hub status card', settings.includes('testID="local-hub-settings-card"')],
  ['settings exposes restart, stop and logs', settings.includes('restartLocalHub()') && settings.includes('stopLocalHub()') && settings.includes('openLocalHubLogs()')],
  ['settings exposes explicit backup and confirmed delete', settings.includes('backupLocalHubData()') && settings.includes('deleteLocalHubData()') && settings.includes("localDeleteText !== '删除本地数据'")],
  ['ordinary account removal hides for local profile', settings.includes("profile.profileId !== LOCAL_HUB_PROFILE_ID")],
  ['bridge uses Tauri supervisor commands', bridge.includes("invokeLocalHub('start_local_hub')") && bridge.includes("invokeLocalHub('local_hub_status')")],
  ['Hub binds loopback only', rust.includes('.env("HOST", "127.0.0.1")')],
  ['supervisor has capped exponential retries', rust.includes('[1_u64, 2, 4, 8, 16, 30]')],
  ['bootstrap removes unsafe development/master-token env', rust.includes('.env_remove("COMMHUB_DEV_OPEN")') && rust.includes('.env_remove("COMMHUB_AUTH_TOKEN")')],
  ['delete requires an exact native-side confirmation and backup first', rust.includes('confirmation != "DELETE LOCAL WORKSPACE"') && rust.lastIndexOf('backup_local_hub_stopped()?') < rust.indexOf('remove_local_profile_data()?')],
];

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}
