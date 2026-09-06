import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const { daemonChecklist, installBlocker, nodeVersionOk } = await import('./local-daemon');
let ck = 0;
const check = (cond: boolean, msg: string) => { assert.ok(cond, msg); ck++; };

const base = { supported: true, shell: '/bin/zsh', daemonDir: '/Users/x/.anet/app/local-daemon', daemonName: 'local-daemon', profileExists: false, hubEndpoint: 'http://127.0.0.1:9201' };

check(nodeVersionOk('v22.13.0') && nodeVersionOk('24.0.1') && !nodeVersionOk('v22.12.0') && !nodeVersionOk('v20.20.0') && !nodeVersionOk(null), 'node gate = engines.node >= 22.13');

// 全缺:清单四行都是 ✗,但**不阻塞**——安装会自动下载私有 Node 22
{
  const scan = { ...base };
  const rows = daemonChecklist(scan);
  check(rows.map(r => r.state).join(',') === 'missing,missing,missing,missing', 'all missing');
  check(rows[0].detail.includes('私有 Node 22') && rows[0].detail.includes('不动系统'), 'node row explains the private download');
  check(installBlocker(scan) === null, 'missing node is not a blocker any more');
}
// node 太低(Vincent 的 v20.12.2):bad 但不阻塞
{
  const scan = { ...base, node: { path: '/Users/v/.nvm/versions/node/v20.12.2/bin/node', version: '20.12.2' }, npm: { path: '/Users/v/.nvm/versions/node/v20.12.2/bin/npm', version: '10.5.0' } };
  const rows = daemonChecklist(scan);
  check(rows[0].state === 'bad' && rows[0].detail.includes('版本太低') && rows[0].detail.includes('私有 Node 22'), 'old node → bad with private-node hint');
  check(installBlocker(scan) === null, 'old node is not a blocker');
}
// 已有私有 Node:node/npm 两行 ✓
{
  const scan = { ...base, node: { path: '/usr/local/bin/node', version: '20.20.0' }, privateNode: { path: '/Users/v/.anet/app/local-daemon/node/bin/node', version: '22.23.2' } };
  const rows = daemonChecklist(scan);
  check(rows[0].state === 'ok' && rows[0].detail.startsWith('私有'), 'private node satisfies the node row');
  check(rows[1].state === 'ok' && rows[1].detail.includes('私有 Node 自带'), 'npm row satisfied by private node');
}
// node+npm 在、anet 缺:可以装,anet 行说明会 npm install
{
  const scan = { ...base, node: { path: '/opt/homebrew/bin/node', version: '22.14.0' }, npm: { path: '/opt/homebrew/bin/npm', version: '10.9.0' } };
  check(installBlocker(scan) === null, 'installable');
  const rows = daemonChecklist(scan);
  check(rows[2].state === 'missing' && rows[2].detail.includes('local-daemon/anet'), 'anet row explains the private-prefix install');
  check(rows[3].detail.includes(base.daemonDir), 'daemon row names the target dir');
}
// 已装 + 已注册
{
  const scan = { ...base, node: { path: '/n', version: '22.14.0' }, npm: { path: '/m', version: '10' }, anet: { path: '/a', version: '2.3.0-preview.76' }, profileExists: true, nodeId: 'node_daemon_abc' };
  const rows = daemonChecklist(scan);
  check(rows.every(r => r.state === 'ok'), 'all ok');
  check(rows[3].detail.includes('node_daemon_abc'), 'daemon row shows node_id');
}
// Windows / 本地 Hub 没起
check(installBlocker({ ...base, supported: false, reason: '只支持 macOS / Linux' })?.includes('macOS') === true, 'unsupported platform blocks with the Rust reason');
check(installBlocker({ ...base, node: { path: '/n', version: '22.14.0' }, npm: { path: '/m' }, hubEndpoint: null })?.includes('Local workspace') === true, 'no local hub → blocked');

// 接线契约:只在桌面端 Local workspace 的空状态里出现;Rust 命令已注册;smoke 只在 macOS 跑
const picker = readFileSync(new URL('./HostSupervisorPickerScreen.tsx', import.meta.url), 'utf8');
check(picker.includes("cfg.profileId === LOCAL_HUB_PROFILE_ID && isTauriDesktop() ? <LocalDaemonSetupCard"), 'picker gates the card on desktop + local profile');
const lib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
check(lib.includes('local_daemon_scan,') && lib.includes('local_daemon_install,') && lib.includes('async fn local_daemon_install()') && lib.includes('spawn_blocking'), 'Rust commands registered; install runs off the main thread');
const wf = readFileSync(new URL('../.github/workflows/release-desktop-auto-update.yml', import.meta.url), 'utf8');
check(wf.includes('--smoke-local-daemon-install') && wf.includes('if [ "$RUNNER_OS" = "macOS" ]; then'), 'release gate runs the daemon install smoke on macOS');
console.log(`local daemon: ${ck} checks passed`);
