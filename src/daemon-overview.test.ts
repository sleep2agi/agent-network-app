// Daemon 设置 → 全览：真实遥测 / runtime 就绪优先；没有上报才用演示探测。缺项带安装或修复命令。
import { readFileSync } from 'node:fs';
import { setLanguagePreference, t } from './i18n';
import './i18n-daemon';
import './i18n-backend-pending';
import type { Session } from './api';
import {
  ANET_INSTALL_DOCS,
  ANET_RUNTIME_DOCS,
  buildDaemonOverview,
  daemonHostname,
  fixtureOverview,
  localScanMatches,
  parseDaemonOverviewFixture,
  RUNTIME_GUIDE,
  type DaemonOverviewInput,
} from './daemon-overview';
import type { LocalDaemonScan } from './local-daemon';

let passed = 0;
let total = 0;
const ck = (name: string, condition: boolean) => {
  total++;
  if (condition) { passed++; console.log('✅', name); }
  else console.log('❌', name);
};

const NOW = Date.parse('2026-10-10T15:00:30Z');
const base = (over: Partial<DaemonOverviewInput> = {}): DaemonOverviewInput => ({
  nowMs: NOW,
  hostsLoaded: true,
  sessions: [],
  alias: 'daemon-a',
  nodeId: 'node_d1',
  supervisor: { daemon_node_id: 'node_d1', alias: 'daemon-a', hostname: 'box-a', online: true },
  listing: 'listed',
  daemonVersion: null,
  localScan: null,
  scanned: false,
  ...over,
});

const hostSession = {
  alias: 'daemon-a',
  status: 'idle',
  hostname: 'box-a',
  updated_at: '2026-10-10 15:00:00',
  ip: '192.0.2.10',
  os_user: 'anet',
  cpu_load_1min: 3.2,
  cpu_cores: 8,
  mem_total_gb: 16,
  mem_used_gb: 9,
  disk_total_gb: 200,
  disk_used_gb: 40,
} as Session;

ck('hostname prefers the supervisor, then the node, then the daemon session', daemonHostname({ supervisor: { daemon_node_id: 'n', alias: 'a', hostname: ' from-sup ' }, nodeHostname: 'from-node', sessions: [{ alias: 'a', status: 'idle', hostname: 'from-session' }], alias: 'a' }) === 'from-sup');
ck('hostname falls back to the daemon session', daemonHostname({ supervisor: null, nodeHostname: null, sessions: [{ alias: 'a', status: 'idle', hostname: 'from-session' }], alias: 'a' }) === 'from-session');

ck('local scan matches node id and ignores a shared alias', localScanMatches({ nodeId: 'node_d1', daemonName: 'daemon-a' } as LocalDaemonScan, { nodeId: 'node_other', alias: 'daemon-a' }) === false);
ck('local scan matches when both ids agree', localScanMatches({ nodeId: 'node_d1', daemonName: 'other' } as LocalDaemonScan, { nodeId: 'node_d1', alias: 'daemon-a' }));
ck('local scan without an id can match the alias', localScanMatches({ nodeId: null, daemonName: 'daemon-a' } as LocalDaemonScan, { nodeId: null, alias: 'daemon-a' }));

const pending = buildDaemonOverview(base({ hostsLoaded: false }));
ck('host read still in flight does not flash the demo', pending.pending && !pending.demo && pending.resources.length === 0);

const live = buildDaemonOverview(base({ sessions: [hostSession], daemonVersion: '2.5.0' }));
const cpu = live.resources.find(row => row.key === 'cpu');
const ram = live.resources.find(row => row.key === 'ram');
const disk = live.resources.find(row => row.key === 'disk');
const net = live.resources.find(row => row.key === 'network');
ck('host telemetry is reported, not demo', !live.demo && !live.pending && cpu?.source === 'reported' && cpu.value === '40%' && cpu.cores === 8 && cpu.load === '3.2');
ck('memory and disk use the same meters as the server page', ram?.value === '56%' && ram?.usedGb === '9' && disk?.value === '20%' && disk?.totalGb === '200');
ck('network is the reported address, not a made-up throughput', net?.address === '192.0.2.10' && net?.pct == null);
ck('OS facts come from the host row; OS name stays unreported', live.os.find(row => row.key === 'hostname')?.value === 'box-a' && live.os.find(row => row.key === 'user')?.value === 'anet' && live.os.find(row => row.key === 'os')?.value == null);
ck('agent-node version from the daemon session is kept', live.tools.find(row => row.key === 'agentNode')?.version === '2.5.0' && live.tools.find(row => row.key === 'anet')?.state === 'unreported');

const readiness = buildDaemonOverview(base({
  supervisor: {
    daemon_node_id: 'node_d1',
    alias: 'daemon-a',
    hostname: 'box-a',
    runtimes_supported: ['codex-sdk', 'opencode-cli', 'claude-agent-sdk'],
    runtime_readiness: {
      'codex-sdk': { ok: false, state: 'not_logged_in', version: '0.98.0', cli: 'found', reason: 'codex login has not been completed' },
      'opencode-cli': { ok: false, state: 'missing_cli', cli: 'missing', reason: 'opencode was not found on PATH' },
      'claude-agent-sdk': { ok: true, state: 'ready', version: '2.5.0', cli: 'bundled' },
    },
  },
}));
const opencode = readiness.runtimes.find(row => row.id === 'opencode-cli');
const codex = readiness.runtimes.find(row => row.id === 'codex-sdk');
const claude = readiness.runtimes.find(row => row.id === 'claude-agent-sdk');
const opencodeGap = readiness.gaps.find(row => row.id === 'opencode-cli');
const codexGap = readiness.gaps.find(row => row.id === 'codex-sdk');
ck('readiness is not replaced by the demo', !readiness.demo && readiness.readinessReported);
ck('missing CLI keeps the hub reason and the documented install command', opencode?.installed === 'no' && opencode?.reason === 'opencode was not found on PATH' && opencodeGap?.command === 'npm install -g opencode-ai' && opencodeGap?.docsUrl === ANET_RUNTIME_DOCS && opencodeGap?.primary === 'copy-install');
ck('not signed in copies the login command, not an install', codex?.installed === 'yes' && codex?.version === '0.98.0' && codexGap?.command === 'codex login' && codexGap?.primary === 'copy-fix');
ck('a ready runtime is not a gap', claude?.state === 'ready' && !readiness.gaps.some(row => row.id === 'claude-agent-sdk'));
ck('blocked runtimes sort ahead of ready ones', readiness.runtimes[0].state !== 'ready');

const declared = buildDaemonOverview(base({
  supervisor: { daemon_node_id: 'node_d1', alias: 'daemon-a', runtimes_supported: ['codex-sdk'] },
}));
ck('a supported runtime without readiness stays unchecked, not missing', !declared.demo && declared.runtimes.length === 1 && declared.runtimes[0].state === 'unknown' && declared.runtimes[0].noteKey === 'daemon.overview.declared' && declared.gaps.length === 0);

const partial = buildDaemonOverview(base({
  supervisor: { daemon_node_id: 'node_d1', alias: 'daemon-a', hostname: 'box-a', host_telemetry: { cpu_cores: 4, mem_gb: 8, ip_internal: '10.0.0.8' } },
}));
ck('partial host_telemetry is reported without inventing usage', !partial.demo && partial.resources.find(row => row.key === 'cpu')?.cores === 4 && partial.resources.find(row => row.key === 'cpu')?.pct == null && partial.resources.find(row => row.key === 'ram')?.totalGb === '8' && partial.resources.find(row => row.key === 'network')?.address === '10.0.0.8' && partial.resources.find(row => row.key === 'disk')?.source === 'unreported');

const blocked = buildDaemonOverview(base({
  sessions: [hostSession],
  supervisor: { daemon_node_id: 'node_d1', alias: 'daemon-a', hostname: 'box-a', can_create_nodes: false, create_nodes_blocked_reason: 'anet_bin_source' },
}));
const cap = blocked.gaps.find(row => row.id === 'capability');
ck('create-capability block points at anet doctor and keeps the reason code', cap?.command === 'anet doctor' && cap?.reason === 'anet_bin_source' && cap?.docsUrl === ANET_INSTALL_DOCS && cap?.stateKey === 'daemon.overview.state.blocked');

const demo = buildDaemonOverview(base({ supervisor: { daemon_node_id: 'node_d1', alias: 'daemon-a', hostname: 'vm-demo', online: true } }));
ck('no telemetry and no readiness uses the demo probe', demo.demo && !demo.pending && demo.resources.every(row => row.source === 'demo') && demo.gaps.some(row => row.id === 'opencode-cli') && demo.gaps.some(row => row.command === 'npm install -g @sleep2agi/agent-network'));
ck('demo does not offer the local installer', !demo.localInstall);
ck('a daemon missing from the supervisor list is called out beside the demo', buildDaemonOverview(base({ supervisor: null, listing: 'missing' })).notListed);

const scan: LocalDaemonScan = {
  supported: true,
  shell: 'zsh',
  node: { path: '/usr/local/bin/node', version: 'v22.14.0' },
  npm: { path: '/usr/local/bin/npm', version: '10.9.2' },
  anet: null,
  daemonDir: '/tmp/anet',
  daemonName: 'daemon-a',
  profileExists: true,
  nodeId: 'node_d1',
  hubEndpoint: 'http://127.0.0.1:1',
};
const local = buildDaemonOverview(base({ sessions: [hostSession], localScan: scan, scanned: true }));
ck('a matching local scan can install the toolchain and records anet as missing', local.localInstall && local.tools.find(row => row.key === 'anet')?.state === 'missing' && local.tools.find(row => row.key === 'node')?.state === 'ok' && local.gaps.some(row => row.id === 'toolchain' && row.primary === 'install-local'));

const otherScan = { ...scan, nodeId: 'node_other' };
const mismatch = buildDaemonOverview(base({ sessions: [hostSession], daemonVersion: '2.5.0', localScan: otherScan, scanned: true }));
ck('a scan of a different daemon is not applied', mismatch.scanMismatch && !mismatch.localInstall && mismatch.tools.find(row => row.key === 'anet')?.state === 'unreported' && mismatch.tools.find(row => row.key === 'agentNode')?.version === '2.5.0');

ck('install and runtime docs are the anet.sh guides', RUNTIME_GUIDE['claude-code-cli'].install === 'npm install -g @anthropic-ai/claude-code' && RUNTIME_GUIDE['claude-code-cli'].login === 'claude auth login' && RUNTIME_GUIDE['grok-build-acp'].install === null && RUNTIME_GUIDE['grok-build-acp'].docsUrl === ANET_RUNTIME_DOCS);

const reportedFixture = fixtureOverview('reported');
const demoFixture = fixtureOverview('demo');
ck('fixtures come from the same builder', !reportedFixture.demo && reportedFixture.runtimes.some(row => row.id === 'opencode-cli' && row.state === 'missing_cli') && demoFixture.demo);

ck('fixture query parses theme and mode', parseDaemonOverviewFixture('?fixture=daemon-overview&theme=light&mode=reported')?.theme === 'light' && parseDaemonOverviewFixture('?fixture=daemon-overview&theme=light&mode=reported')?.mode === 'reported');
ck('other fixtures are ignored and demo is the default mode', parseDaemonOverviewFixture('?fixture=hub-scope') === null && parseDaemonOverviewFixture('?fixture=daemon-overview')?.mode === 'demo');

setLanguagePreference('zh');
ck('zh copy names the probe and the demo banner', t('daemon.overview.nav') === '全览' && t('daemon.overview.probe') === '探测环境' && t('backendPending.banner') === '演示数据 · 后端开发中' && t('daemon.settings') === '设置');
setLanguagePreference('en');
ck('en copy names the probe and the demo banner', t('daemon.overview.nav') === 'Overview' && t('daemon.overview.probe') === 'Probe environment' && t('backendPending.banner') === 'Demo data · Backend in development' && t('daemon.overview.gaps', { count: 2 }) === 'Needs attention (2)');
setLanguagePreference('system');

const screen = readFileSync(new URL('./DaemonManagementScreen.tsx', import.meta.url), 'utf8');
const section = readFileSync(new URL('./DaemonOverviewSection.tsx', import.meta.url), 'utf8');
const nodePage = readFileSync(new URL('./NodeDetailScreen.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
ck('daemon settings open on overview', /initialSection = 'overview'/.test(screen) && screen.includes('testID="daemon-section-overview"') && screen.includes("t('daemon.settings')"));
ck('overview stays inside the management screen and does not call a new probe route', screen.includes('<DaemonOverviewSection') && !/probe_provider_model|\/api\/probe/.test(section));
ck('probe reads full status and the local scan, and install reuses the local daemon installer', section.includes('fetchNodeStatus(cfg)') && section.includes('scanLocalDaemon()') && section.includes('installLocalDaemon()') && section.includes('isTauriDesktop()'));
ck('the node page does not get this overview', !nodePage.includes('DaemonOverview'));
ck('the web fixture is wired', app.includes('readDaemonOverviewFixture') && app.includes('<DaemonOverviewFixtureScreen'));

const quiet = JSON.stringify(readiness);
ck('readiness result does not echo a secret-shaped field', !quiet.includes('apiKey') && !quiet.includes('sk-'));

console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
