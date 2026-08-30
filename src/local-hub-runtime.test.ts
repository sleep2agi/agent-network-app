import fs from 'node:fs';

const app = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const settings = fs.readFileSync(new URL('./SettingsScreen.tsx', import.meta.url), 'utf8');
const bridge = fs.readFileSync(new URL('./local-hub.ts', import.meta.url), 'utf8');
const rust = fs.readFileSync(new URL('../src-tauri/src/local_hub.rs', import.meta.url), 'utf8');
const appWorkflow = fs.readFileSync(new URL('../.github/workflows/release-desktop-auto-update.yml', import.meta.url), 'utf8');
const migrationSeed = fs.readFileSync(new URL('../scripts/seed-previous-local-hub.mjs', import.meta.url), 'utf8');

const checks: Array<[string, boolean]> = [
  ['first run offers recommended local workspace', app.includes('创建本地工作区')],
  ['first run retains explicit remote-server path', app.includes('使用已有服务器登录')],
  ['first run reports preparing, starting and migrating stages', app.includes('正在准备本地工作区') && app.includes('正在启动本地服务') && app.includes('正在备份并迁移') && app.includes('status.requiresMigration')],
  ['saved local profile starts before workspace restore', app.includes("stored?.profileId === LOCAL_HUB_PROFILE_ID") && app.includes('await startLocalHub()')],
  ['local profile follows a fallback loopback port without changing identity', rust.includes('if session.server_url == endpoint') && rust.includes('profile_id: Some(session.profile_id)') && rust.includes('server_url: endpoint.into()')],
  ['missing local database does not reuse a stale session', /if database_existed\s*\{\s*if let Some\(session\) = existing_local_session\(\)\?/.test(rust)],
  ['settings exposes local Hub status card', settings.includes('testID="local-hub-settings-card"')],
  ['settings exposes restart, stop and logs', settings.includes('restartLocalHub()') && settings.includes('stopLocalHub()') && settings.includes('openLocalHubLogs()')],
  ['settings exposes explicit backup and confirmed delete', settings.includes('backupLocalHubData()') && settings.includes('deleteLocalHubData()') && settings.includes("localDeleteText !== '删除本地数据'")],
  ['ordinary account removal hides for local profile', settings.includes("profile.profileId !== LOCAL_HUB_PROFILE_ID")],
  ['bridge uses Tauri supervisor commands', bridge.includes("invokeLocalHub('start_local_hub')") && bridge.includes("invokeLocalHub('local_hub_status')")],
  ['signed release runs the packaged executable local Hub smoke on both platforms', rust.includes('pub fn packaged_smoke()') && rust.includes('/api/auth/me') && rust.includes('/api/status') && appWorkflow.includes('--smoke-local-hub') && appWorkflow.includes('ANET_PACKAGED_SMOKE_ROOT') && !appWorkflow.includes('HOME="$smoke_root"')],
  ['packaged local workspace proves public node and task flow', rust.includes('/api/auth/node-token') && rust.includes('"name": "report_status"') && rust.includes('report.text()') && rust.includes('reported node is missing from public status API') && rust.includes('public task dispatch returned') && rust.includes('dispatched task is missing from public tasks API')],
  ['signed release runs the local-plus-two-remote profile matrix on both platforms', rust.includes('pub fn packaged_multihub_smoke()') && rust.includes('A -> B -> C -> A switch crossed profile credentials') && rust.includes('cold-start child omitted Hub C') && rust.includes('revoked Hub B token was not rejected') && appWorkflow.includes('--smoke-multihub')],
  ['packaged first start proves preferred-port conflict fallback', rust.includes('cannot reserve preferred smoke port') && rust.includes('first["port"].as_u64() == Some(PREFERRED_PORT.into())')],
  ['Hub binds loopback only', rust.includes('.env("HOST", "127.0.0.1")')],
  ['supervisor has capped exponential retries', rust.includes('[1_u64, 2, 4, 8, 16, 30]')],
  ['supervisor refuses a duplicate when lock owner is alive but unhealthy', rust.includes('owner_pid.is_some_and(process_is_alive)') && rust.includes('refusing to start a duplicate')],
  ['ownership lock records a live desktop PID before sidecar spawn', rust.indexOf('writeln!(lock, "{}", std::process::id())') < rust.indexOf('let mut child = Command::new(executable)')],
  ['bootstrap removes unsafe development/master-token env', rust.includes('.env_remove("COMMHUB_DEV_OPEN")') && rust.includes('.env_remove("COMMHUB_AUTH_TOKEN")')],
  ['delete requires an exact native-side confirmation and backup first', rust.includes('confirmation != "DELETE LOCAL WORKSPACE"') && rust.lastIndexOf('backup_local_hub_stopped()?') < rust.indexOf('remove_local_profile_data()?')],
  ['version migration snapshots and restores data on failure', rust.includes('snapshot_data_for_migration') && rust.includes('restore_migration_snapshot') && rust.includes('config.hub_version != EXPECTED_HUB_VERSION')],
  ['signed packages migrate real previous-version node/task data', appWorkflow.includes('resolve-previous-desktop-hub-version.mjs') && appWorkflow.includes('ANET_SMOKE_PREVIOUS_HUB_VERSION') && !appWorkflow.includes('0.9.0-preview.28') && appWorkflow.includes('--smoke-local-hub-migration') && migrationSeed.includes('ANET_SMOKE_PREVIOUS_HUB_VERSION') && !migrationSeed.includes("0.9.0-preview.28") && rust.includes('ANET_SMOKE_PREVIOUS_HUB_VERSION is required') && rust.includes('previous-version node is missing after migration') && rust.includes('migration backup snapshot is missing') && !rust.includes('0.9.0-preview.28')],
  ['failed packaged migration restores exact previous data and metadata', appWorkflow.includes('--smoke-local-hub-failed-migration') && rust.includes('failed migration did not restore the exact previous database') && rust.includes('failed migration did not restore previous compatibility metadata') && rust.includes('failed migration left a stale supervisor lock')],
  ['packaged supervisor recovers a force-killed Hub', appWorkflow.includes('--smoke-local-hub-crash-recovery') && rust.includes('kill_process_for_smoke') && rust.includes('supervisor did not recover the killed sidecar within 20 seconds') && rust.includes('crash recovery changed profile or native credential')],
  ['signed release audits macOS and Windows uninstall/reinstall retention', appWorkflow.includes('Audit macOS app removal and reinstall data retention') && appWorkflow.includes('Audit Windows NSIS uninstall and reinstall data retention') && appWorkflow.includes('NSIS uninstall deleted retained app data') && appWorkflow.includes('reinstall lost retained database')],
  ['signed packages reject corrupt data with rollback and diagnostics', appWorkflow.includes('--smoke-local-hub-corrupt-data') && rust.includes('corrupt-data failure did not restore the exact original bytes') && rust.includes('corrupt data returned a non-actionable diagnostic') && rust.includes('corrupt-data failure left a stale supervisor lock')],
];

for (const [name, ok] of checks) {
  if (!ok) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}
