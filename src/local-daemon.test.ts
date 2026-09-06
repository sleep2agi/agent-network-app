import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const { daemonChecklist, installBlocker, nodeVersionOk } = await import('./local-daemon');
let ck = 0;
const check = (cond: boolean, msg: string) => { assert.ok(cond, msg); ck++; };

const base = { supported: true, shell: '/bin/zsh', daemonDir: '/Users/x/.anet/app/local-daemon', daemonName: 'local-daemon', profileExists: false, hubEndpoint: 'http://127.0.0.1:9201' };

check(nodeVersionOk('v22.13.0') && nodeVersionOk('24.0.1') && !nodeVersionOk('v22.12.0') && !nodeVersionOk('v20.20.0') && !nodeVersionOk(null), 'node gate = engines.node >= 22.13');

// 全缺:node 缺 → 不能装,清单四行都是 ✗
{
  const scan = { ...base };
  const rows = daemonChecklist(scan);
  check(rows.map(r => r.state).join(',') === 'missing,missing,missing,missing', 'all missing');
  check(rows[0].detail.includes('nodejs.org'), 'node row points at nodejs.org');
  check(installBlocker(scan)?.includes('Node.js') === true, 'blocked on Node');
}
// node 太低
{
  const scan = { ...base, node: { path: '/usr/local/bin/node', version: '20.20.0' }, npm: { path: '/usr/local/bin/npm', version: '10' } };
  check(daemonChecklist(scan)[0].state === 'bad', 'old node → bad');
  check(installBlocker(scan)?.includes('太低') === true, 'blocked on old node');
}
// node+npm 在、anet 缺:可以装,anet 行说明会 npm install
{
  const scan = { ...base, node: { path: '/opt/homebrew/bin/node', version: '22.14.0' }, npm: { path: '/opt/homebrew/bin/npm', version: '10.9.0' } };
  check(installBlocker(scan) === null, 'installable');
  const rows = daemonChecklist(scan);
  check(rows[2].state === 'missing' && rows[2].detail.includes('npm install -g @sleep2agi/agent-network'), 'anet row explains the install');
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
