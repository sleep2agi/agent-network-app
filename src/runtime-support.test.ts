// Runtime 支持：功能表对齐公开支持矩阵；本机探测只读 daemon 已经上报的字段。
import { readFileSync } from 'node:fs';
import { setLanguagePreference, t } from './i18n';
import './i18n-runtime-support';
import './i18n-backend-pending';
import {
  ANET_FEATURE_ORDER,
  RUNTIME_SUPPORT_ORDER,
  featureCell,
  featureMatrixSource,
  hostBadge,
  hostContextFromSupervisorList,
  hostProbe,
  rollupSupport,
  runtimeSupportEntries,
  type AnetFeatureId,
  type SupportLevel,
} from './runtime-support';

let passed = 0;
let total = 0;
const ck = (name: string, ok: boolean) => {
  total++;
  if (ok) passed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
};

const level = (runtime: string, feature: AnetFeatureId): SupportLevel => featureCell(runtime, feature).level;

ck('feature matrix is demo until a live API exists', featureMatrixSource() === 'demo');
ck('seven known runtimes, wizard order', RUNTIME_SUPPORT_ORDER.join(',') === 'claude-agent-sdk,codex-sdk,grok-build-acp,claude-code-cli,codex-app-server,grok-build-cli,opencode-cli');
ck('feature order leads with the product matrix', ANET_FEATURE_ORDER[0] === 'hub_chat' && ANET_FEATURE_ORDER.includes('tui_copresence') && ANET_FEATURE_ORDER.includes('steer') && ANET_FEATURE_ORDER.includes('long_task'));

ck('hub chat is never painted as supported', RUNTIME_SUPPORT_ORDER.every(id => level(id, 'hub_chat') === 'unverified'));
ck('tokens stay unverified', RUNTIME_SUPPORT_ORDER.every(id => level(id, 'tokens') === 'unverified'));

ck('TUI co-presence follows the support matrix',
  level('claude-agent-sdk', 'tui_copresence') === 'na'
  && level('claude-code-cli', 'tui_copresence') === 'na'
  && level('codex-sdk', 'tui_copresence') === 'na'
  && level('grok-build-acp', 'tui_copresence') === 'na'
  && level('codex-app-server', 'tui_copresence') === 'supported'
  && level('opencode-cli', 'tui_copresence') === 'supported'
  && level('grok-build-cli', 'tui_copresence') === 'partial');

ck('daemon create follows the support matrix',
  level('claude-agent-sdk', 'daemon_lifecycle') === 'supported'
  && level('codex-sdk', 'daemon_lifecycle') === 'supported'
  && level('grok-build-acp', 'daemon_lifecycle') === 'supported'
  && level('claude-code-cli', 'daemon_lifecycle') === 'unverified'
  && level('codex-app-server', 'daemon_lifecycle') === 'unverified'
  && level('grok-build-cli', 'daemon_lifecycle') === 'unverified'
  && level('opencode-cli', 'daemon_lifecycle') === 'unverified');

ck('steer is the Codex TUI lane only', level('codex-app-server', 'steer') === 'supported' && RUNTIME_SUPPORT_ORDER.filter(id => id !== 'codex-app-server').every(id => level(id, 'steer') === 'na'));
ck('provider form is Codex partial, OpenCode partial, others not applicable',
  level('codex-sdk', 'provider_config') === 'partial'
  && level('codex-app-server', 'provider_config') === 'partial'
  && level('opencode-cli', 'provider_config') === 'partial'
  && level('claude-agent-sdk', 'provider_config') === 'na');
ck('grok co-presence does not load skills; opencode long tasks are unsupported',
  level('grok-build-cli', 'skills') === 'unsupported' && level('opencode-cli', 'long_task') === 'unsupported');

const hubRows = runtimeSupportEntries({ kind: 'several' });
ck('more than one daemon does not attach a host badge', hubRows.every(row => row.hostBadge === null));
ck('claude code cli overall stays unverified', hubRows.find(row => row.id === 'claude-code-cli')?.overall === 'unverified');
ck('codex tui overall is partial', hubRows.find(row => row.id === 'codex-app-server')?.overall === 'partial');
ck('rollup ignores not-applicable cells', rollupSupport(['na', 'unverified', 'na']) === 'unverified' && rollupSupport(['supported', 'na']) === 'supported' && rollupSupport(['supported', 'unverified']) === 'partial');

const now = Date.parse('2026-10-10T00:00:00.000Z');
const blocked = hostProbe({
  kind: 'daemon',
  daemon: {
    daemon_node_id: 'd1',
    alias: 'box',
    can_create_nodes: false,
    create_nodes_blocked_reason: 'anet_bin_unsafe_path',
    create_capability_observed_ms_ago: 1000,
    last_seen_at: '2026-10-10T00:00:00.000Z',
    runtimes_supported: ['codex-sdk'],
    runtime_readiness: {
      'codex-sdk': { state: 'missing_cli', reason: '这台机器上没找到 codex' },
    },
    adopt_capable: true,
  },
}, 'codex-sdk', now);
ck('live readiness blocks this machine without rewriting the feature cell',
  blocked.status === 'daemon'
  && blocked.badge === 'blocked'
  && blocked.upgrade === null
  && blocked.createKind === 'blocked'
  && blocked.createReasonCode === 'anet_bin_unsafe_path'
  && blocked.adoptCapable === true
  && blocked.readinessNote === '这台机器上没找到 codex'
  && level('codex-sdk', 'daemon_lifecycle') === 'supported');

const legacy = hostProbe({
  kind: 'daemon',
  daemon: { daemon_node_id: 'old', alias: 'old-box' },
}, 'codex-app-server', now);
ck('missing readiness asks for the npm upgrade and does not mark the runtime blocked',
  legacy.status === 'daemon' && legacy.badge === null && legacy.upgrade === 'npm' && legacy.createKind === 'unknown');

ck('undeclared runtime is not the same as blocked',
  hostBadge({ runtimes_supported: ['codex-sdk'], runtime_readiness: { 'codex-sdk': { state: 'ready' } } }, 'opencode-cli') === 'undeclared'
  && hostBadge({ runtimes_supported: ['codex-sdk'] }, 'codex-sdk') === null);

const extras = runtimeSupportEntries({
  kind: 'daemon',
  daemon: { runtimes_supported: ['codex-sdk', 'future-runtime'] },
});
const extra = extras.find(row => row.id === 'future-runtime');
ck('unknown runtime stays unverified', !!extra && extra.known === false && extra.overall === 'unverified' && extra.features.every(cell => cell.level === 'unverified' && cell.noteKey === 'runtimeSupport.note.unknownFeature'));

ck('hub without host-supervisors points at a hub upgrade', hostProbe({ kind: 'unsupported' }, 'codex-sdk', now).status === 'unsupported');
ck('several daemons are not probed and not turned into a list', hostProbe({ kind: 'several' }, 'codex-sdk', now).status === 'several' && !('daemon' in hostContextFromSupervisorList({ ok: true, daemons: [{ alias: 'a' }, { alias: 'b' }] })));
const one = hostContextFromSupervisorList({ ok: true, daemons: [{ alias: 'only', can_create_nodes: true }] });
const none = hostContextFromSupervisorList({ ok: true, daemons: [] });
ck('one host uses that single daemon', one.kind === 'daemon' && one.daemon.alias === 'only' && none.kind === 'missing');
ck('an old hub stays an upgrade, not an empty daemon', hostContextFromSupervisorList({ ok: false, unconfirmed: true }).kind === 'unsupported');

setLanguagePreference('zh');
ck('zh tab and banner stay the agreed words', t('backendPending.tab.runtime') === 'Runtime 支持' && t('server.pendingTitle.runtime') === 'Runtime 支持' && t('backendPending.banner') === '演示数据 · 后端开发中');
ck('zh npm upgrade names the package', t('runtimeSupport.upgrade.npm').includes('npm install -g @sleep2agi/agent-node@preview') && t('runtimeSupport.upgrade.npm').includes('重启 daemon'));
ck('zh feature title is the product matrix', t('runtimeSupport.section.features') === 'ANet 功能支持' && t('runtimeSupport.feature.daemon_lifecycle') === 'Daemon 建节点/生命周期');
setLanguagePreference('en');
ck('en tab is Runtime support', t('backendPending.tab.runtime') === 'Runtime support' && t('runtimeSupport.level.partial') === 'Partial' && t('runtimeSupport.upgrade.npm').includes('npm install -g @sleep2agi/agent-node@preview'));
const noteKeys = new Set(runtimeSupportEntries({ kind: 'missing' }).flatMap(row => row.features.map(cell => cell.noteKey)));
ck('every catalog note translates', [...noteKeys].every(key => t(key) !== key && !t(key).includes('{')));
setLanguagePreference('system');

const screen = readFileSync(new URL('./RuntimeSupportScreen.tsx', import.meta.url), 'utf8');
const daemonPage = readFileSync(new URL('./DaemonManagementScreen.tsx', import.meta.url), 'utf8');
const hubPage = readFileSync(new URL('./HubPendingScreen.tsx', import.meta.url), 'utf8');
const sidebar = readFileSync(new URL('./ServerSidebar.tsx', import.meta.url), 'utf8');
const pendingUi = readFileSync(new URL('./backend-pending-ui.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const nodePage = readFileSync(new URL('./node-page-model.ts', import.meta.url), 'utf8');
const nodeDetail = readFileSync(new URL('./NodeDetailScreen.tsx', import.meta.url), 'utf8');
ck('daemon nav opens the runtime pane instead of the pending form', daemonPage.includes("pendingSection === 'runtime'") && daemonPage.includes('<RuntimeSupportPane layer="daemon"') && daemonPage.indexOf("pendingSection === 'runtime'") < daemonPage.indexOf('<BackendPendingIntegration'));
ck('hub sidebar and screen include the runtime tab', sidebar.includes("'runtime'") && hubPage.includes("tab === 'runtime'") && hubPage.includes('<RuntimeSupportPane layer="hub"') && pendingUi.includes("key: 'runtime'"));
ck('desktop hub routes every pending tab, including runtime', app.includes('isHubPendingSection(section)') && app.includes("setScreen({ name: 'serverPending', tab: section })"));
ck('hub runtime reads the one daemon and does not render a picker', hubPage.includes('hostContextFromSupervisorList') && hubPage.includes('fetchHostSupervisors') && !hubPage.includes('daemons.map') && !screen.includes('daemon-picker'));
ck('an ambiguous daemon alias is not a picker', daemonPage.includes("lookup.ambiguous") && daemonPage.includes("{ kind: 'several' }"));
ck('node layer does not grow a runtime support tab', !nodePage.includes('runtime') && !nodeDetail.includes('RuntimeSupport') && !nodeDetail.includes('runtime-support'));
ck('demo banner is the shared pending banner', screen.includes('PendingDemoBanner') && screen.includes("featureMatrixSource() === 'demo'"));
ck('providers stay secondary to the feature matrix', screen.indexOf('runtime-support-matrix') < screen.indexOf('runtime-support-providers') && screen.includes('<DaemonRuntimeProviders'));
ck('runtime screen does not hard-code colors', !/["'](?:#[0-9a-f]{3,8}|rgba?\()[^"']*["']/i.test(screen));

console.log(`${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
