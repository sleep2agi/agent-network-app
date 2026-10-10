// @ts-nocheck
// Board #908 — daemon management page: real Hub fields only, existing actions only.
import { readFileSync } from 'node:fs';
import { setLanguagePreference } from './i18n';
import { chatTranslations } from './i18n-chat';
import {
  actionReason,
  createAction,
  daemonMgmtLayout,
  DAEMON_MGMT_COMPACT_WIDTH,
  lifecycleErrorMessage,
  lifecycleTool,
  lookupSupervisor,
  managedRows,
  nodeActions,
  nodeTypeLabel,
  nodeTypeView,
  probeAction,
  runtimeLabel,
  runtimeView,
  statusLabel,
  statusView,
  typeToken,
} from './daemon-management';

let passed = 0;
let total = 0;
const ck = (name: string, condition: boolean) => {
  total++;
  if (condition) { passed++; console.log('✅', name); }
  else console.log('❌', name);
};

setLanguagePreference('en');

ck('phone width stacks; wide pane splits', daemonMgmtLayout(390) === 'stack' && daemonMgmtLayout(DAEMON_MGMT_COMPACT_WIDTH) === 'split' && daemonMgmtLayout(1200) === 'split');
ck('SKILLS Provider tokens normalize', typeToken('SKILLS Provider') === 'skills_provider' && typeToken('skills-provider') === 'skills_provider');

const skills = nodeTypeView('skills_provider');
const titled = nodeTypeView('SKILLS Provider');
const dashed = nodeTypeView(null, 'skills-provider');
const unknown = nodeTypeView('custom_scope');
const runtimeOnly = nodeTypeView(null, 'claude-agent-sdk');
const missing = nodeTypeView(null, null);
const roleWins = nodeTypeView('custom_scope', 'skills_provider');
ck('known role skills_provider is SKILLS Provider', skills.kind === 'known' && skills.key === 'skillsProvider' && nodeTypeLabel(skills) === 'SKILLS Provider');
ck('spaced title is the same known type, not a new fact', titled.kind === 'known' && titled.key === 'skillsProvider');
ck('runtime type token is used only when role is absent', dashed.kind === 'known' && dashed.key === 'skillsProvider' && dashed.raw === 'skills-provider');
ck('unknown role is labeled unrecognized and keeps the raw value', unknown.kind === 'unrecognized' && nodeTypeLabel(unknown) === 'Unrecognized type: custom_scope');
ck('a runtime id is not turned into a type', runtimeOnly.kind === 'unreported' && nodeTypeLabel(runtimeOnly) === 'Not reported');
ck('missing role and runtime is not reported', missing.kind === 'unreported');
ck('a reported role wins over a type-shaped runtime', roleWins.kind === 'unrecognized' && roleWins.raw === 'custom_scope');

setLanguagePreference('zh');
ck('type labels have Chinese copy', nodeTypeLabel(skills) === 'SKILLS Provider' && nodeTypeLabel(unknown) === '未识别的类型：custom_scope' && nodeTypeLabel(missing) === '未上报');
setLanguagePreference('en');

const daemon = { node_id: 'node_d1', alias: 'daemon-a', role: 'host_supervisor', hostname: 'box-a' };
const nodes = [
  daemon,
  { node_id: 'node_w', alias: 'worker-1', node_name: 'Worker One', role: 'worker', runtime: 'claude-agent-sdk', lifecycle_state: 'active', lifecycle_controllable: true, lifecycle_daemon_node_id: 'node_d1' },
  { node_id: 'node_s', alias: 'skills-1', role: 'skills_provider', lifecycle_state: 'stopped', lifecycle_controllable: true, lifecycle_daemon_node_id: 'node_d1' },
  { node_id: 'node_u', alias: 'mystery', role: 'custom_scope', lifecycle_daemon_node_id: 'node_d1', lifecycle_controllable: true },
  { node_id: 'node_o', alias: 'other', role: 'agent', lifecycle_daemon_node_id: 'node_d9', lifecycle_controllable: true },
  { node_id: 'node_x', alias: 'no-link', role: 'worker' },
];
const sessions = [
  { alias: 'worker-1', node_id: 'node_w', status: 'working', runtime: 'codex' },
  { alias: 'skills-1', status: 'offline' },
];
const rows = managedRows(nodes, sessions, 'daemon-a');
ck('managed rows are only children of this daemon, sorted by name', rows.map(r => r.alias).join(',') === 'mystery,skills-1,worker-1');
ck('name prefers node_name; status and runtime come from the session when present', rows[2].name === 'Worker One' && rows[2].status.text === 'working' && rows[2].status.online === true && rows[2].runtime.text === 'codex' && rows[2].runtime.source === 'session');
ck('SKILLS Provider row uses the reported role and lifecycle when the session is offline', rows[1].type.key === 'skillsProvider' && rows[1].status.text === 'offline' && rows[1].status.source === 'session' && runtimeLabel(rows[1].runtime) === 'Not reported');
ck('unknown type stays on the row; a node with no lifecycle link is absent', rows[0].type.kind === 'unrecognized' && rows[0].type.raw === 'custom_scope' && !rows.some(r => r.alias === 'other' || r.alias === 'no-link' || r.alias === 'daemon-a'));
ck('no daemon row means no invented children', managedRows(nodes.filter(n => n.alias !== 'daemon-a'), sessions, 'daemon-a').length === 0);
ck('a failed node read is an empty list, not a placeholder', managedRows(undefined, sessions, 'daemon-a').length === 0);

ck('session status offline is down', statusView({ alias: 'a', status: 'offline' }, 'active').online === false && statusLabel(statusView({ alias: 'a', status: 'offline' }, 'active')) === 'offline');
ck('lifecycle stopped is down without a session', statusView(undefined, 'stopped').online === false && statusView(undefined, 'stopped').source === 'lifecycle');
ck('lifecycle active without a session is not treated as online or offline', statusView(undefined, 'active').online === null && statusView(undefined, 'active').text === 'active');
ck('nothing reported stays unreported', statusView(undefined, null).kind === 'unreported' && statusLabel(statusView(undefined, '  ')) === 'Not reported');
ck('runtime falls back node then agent, never role', runtimeView(undefined, 'grok').text === 'grok' && runtimeView({ alias: 'a', agent: 'codex-sdk' }, null).source === 'agent' && runtimeView(undefined, null).kind === 'unreported');

const sup = (over = {}) => ({ daemon_node_id: 'node_d1', alias: 'daemon-a', ...over });
const ready = (daemonRow) => ({ ok: true, count: daemonRow ? 1 : 0, daemons: daemonRow ? [daemonRow] : [] });
ck('create stays off while the supervisor list is loading', !createAction({ kind: 'loading' }, true).enabled && actionReason(createAction({ kind: 'loading' }, true)).includes('still loading'));
ck('create stays off when this window cannot open the wizard', !createAction({ kind: 'ready', daemon: sup({ can_create_nodes: true }), ambiguous: false }, false).enabled);
ck('create stays off on a hub with no host-supervisor API', !createAction(lookupSupervisor({ ok: false, unconfirmed: true, error: 'upgrade' }, daemon), true).enabled);
ck('create stays off when the daemon is missing from the list', !createAction(lookupSupervisor(ready(null), daemon), true).enabled && actionReason(createAction(lookupSupervisor(ready(null), daemon), true)).includes('not in the Hub'));
ck('create stays off when can_create_nodes is false and shows the reported code', (() => {
  const action = createAction(lookupSupervisor(ready(sup({ can_create_nodes: false, create_nodes_blocked_reason: 'anet_bin_source' })), daemon), true);
  return !action.enabled && actionReason(action).includes('anet_bin_source');
})());
ck('can_create_nodes omitted is not treated as false', createAction(lookupSupervisor(ready(sup({})), daemon), true).enabled && actionReason(createAction(lookupSupervisor(ready(sup({})), daemon), true)).includes('has not reported'));
ck('can_create_nodes true enables create with no hint', createAction(lookupSupervisor(ready(sup({ can_create_nodes: true })), daemon), true).enabled && actionReason(createAction(lookupSupervisor(ready(sup({ can_create_nodes: true })), daemon), true)) === '');
ck('two daemons with the same alias and no id match do not pick one', lookupSupervisor({ ok: true, count: 2, daemons: [sup({ daemon_node_id: 'node_a' }), sup({ daemon_node_id: 'node_b' })] }, { alias: 'daemon-a' }).ambiguous === true);
ck('probe is visible and disabled: provider probe is not on this page', !probeAction().enabled && probeAction().visible && actionReason(probeAction()).includes('probe_provider_model'));

const child = rows[2].node;
const up = nodeActions({ node: child, status: rows[2].status, daemons: undefined, networkId: 'net' });
const byId = Object.fromEntries(up.map(a => [a.id, a]));
ck('a running managed node can restart, stop, and delete; start is hidden', byId.restart.enabled && byId.stop.enabled && byId.delete.enabled && !byId.start.visible);
const stoppedNode = rows[1].node;
const down = nodeActions({ node: stoppedNode, status: statusView(undefined, 'stopped'), daemons: undefined, networkId: 'net' });
const downBy = Object.fromEntries(down.map(a => [a.id, a]));
ck('a stopped managed node can start and delete; restart and stop stay off', downBy.start.visible && downBy.start.enabled && downBy.delete.enabled && !downBy.restart.enabled && !downBy.stop.enabled);
const unknownStatus = nodeActions({ node: child, status: statusView(undefined, 'active'), daemons: undefined, networkId: 'net' });
const unknownBy = Object.fromEntries(unknownStatus.map(a => [a.id, a]));
ck('active lifecycle without a session does not enable start, stop, or restart', !unknownBy.start.enabled && !unknownBy.stop.enabled && !unknownBy.restart.enabled && unknownBy.delete.enabled && actionReason(unknownBy.start).includes('not reported'));
ck('no selection disables every node action', nodeActions({ node: null, status: statusView(undefined, null), daemons: undefined }).every(a => !a.enabled && a.visible));
const hand = { ...child, lifecycle_controllable: false };
const handActions = nodeActions({ node: hand, status: rows[2].status, daemons: [], networkId: 'net' });
ck('a hand-started node cannot be stopped or deleted here', !handActions.find(a => a.id === 'stop').enabled && !handActions.find(a => a.id === 'delete').enabled);
ck('lifecycle tools are the existing Hub names', lifecycleTool('start') === 'start_node' && lifecycleTool('restart') === 'restart_node' && lifecycleTool('stop') === 'stop_node' && lifecycleTool('delete') === 'delete_node');
ck('a known start error is translated; an unknown error stays the Hub text', lifecycleErrorMessage('start', 'permission_denied') === 'You do not have permission to start this node.' && lifecycleErrorMessage('stop', 'HTTP 500') === 'HTTP 500');
ck('in-flight refusal is translated', lifecycleErrorMessage('stop', 'node_busy_in_flight', 2).includes('2'));

const screen = readFileSync(new URL('./DaemonManagementScreen.tsx', import.meta.url), 'utf8');
const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
ck('management screen calls the existing lifecycle helper and the create callback', screen.includes('runNodeLifecycleAction(cfg, lifecycleTool(id), selected.node)') && screen.includes('onCreate(lookup.daemon)'));
ck('management screen does not invent a probe call', !/probe_provider_model|probe_node|\/api\/probe/.test(screen));
ck('logs entry is on the management page', screen.includes('testID="daemon-mgmt-logs"') && screen.includes('onOpenLogs'));
ck('back affordance is hidden on desktop and in the two-pane', /const showBack = !desktop && !hideBack;/.test(screen) && screen.includes('testID={PANE_BACK_TEST_ID}'));
ck('ChatScreen replaces the daemon chat with the management page', /if \(composerKind === 'daemon'\) \{\s*return \(\s*<DaemonManagementScreen/.test(chat));
ck('daemon logs still open the node page on the logs section', /requestNodeSection\(nodeInfoSectionKey\([^)]*\), 'logs'\);\s*onOpenNodeSettings\(\)/.test(chat));
ck('the chat composer notice is no longer the daemon view', !chat.includes('DaemonComposerNotice'));
ck('phone, two-pane, and desktop chats can open the existing wizard and return here', (app.match(/onCreateNode=\{daemon => setScreen\(\{ name: 'wizard', daemon, back: \{ name: 'chat', alias:/g) ?? []).length === 3);
ck('wizard back returns to whoever opened it', app.includes('screen.back ?? { name: \'picker\' }') && app.includes("if (screen.name === 'wizard' && screen.back)"));
ck('the old notice sentence remains translated', chatTranslations['chat.daemon.notice'][0].includes('不能对话') && !!chatTranslations['chat.daemon.notice'][1]);

setLanguagePreference('system');
console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
