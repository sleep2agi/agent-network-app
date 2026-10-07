// @ts-nocheck -- repository test scripts run directly under Bun; the app
// tsconfig intentionally excludes Node ambient types.
// 看板 #692 —— 守护节点(host_supervisor)没有 AI 对话:会话页输入框换成说明条,列表不画红点。
import { readFileSync } from 'node:fs';
import {
  agentRowBadge,
  chatComposerKind,
  daemonHostnameOf,
  hydrateNodeRoles,
  isHostSupervisorAlias,
  isHostSupervisorNode,
  managedAliasesOf,
  managedNodeAliases,
  managedNodesFilter,
  nodeRolesVersion,
  resetNodeRoles,
  subscribeNodeRoles,
} from './daemon-node';
import { applyAgentFilter, isFilterActive } from './server-stats';
import { chatTranslations } from './i18n-chat';

let passed = 0;
let total = 0;
const ck = (name: string, condition: boolean) => {
  total++;
  if (condition) { passed++; console.log('✅', name); }
  else console.log('❌', name);
};

const nodes = [
  { node_id: 'node_d1', alias: 'daemon-a', role: 'host_supervisor', hostname: 'host-a' },
  { node_id: 'node_c1', alias: 'worker-2', role: 'agent', lifecycle_daemon_node_id: 'node_d1' },
  { node_id: 'node_c2', alias: 'worker-1', role: null, config_snapshot: { role: 'agent' }, lifecycle_daemon_node_id: 'node_d1' },
  { node_id: 'node_c3', alias: 'other', role: 'agent', lifecycle_daemon_node_id: 'node_d9' },
  // 只有快照里写了 role 的守护节点(列表投影没带顶层 role 时)
  { node_id: 'node_d2', alias: 'daemon-b', config_snapshot: { role: 'host_supervisor' } },
];

// ── 判据 ──────────────────────────────────────────────────────────────────────────────────
ck('role=host_supervisor is a daemon', isHostSupervisorNode(nodes[0]));
ck('config_snapshot.role=host_supervisor is a daemon too', isHostSupervisorNode(nodes[4]));
ck('an agent node is not a daemon', !isHostSupervisorNode(nodes[1]) && !isHostSupervisorNode(nodes[2]));
ck('unknown node (not loaded yet) is not a daemon', !isHostSupervisorNode(undefined) && !isHostSupervisorNode({}));

// ── 会话页:按角色换输入框 ─────────────────────────────────────────────────────────────────
ck('daemon → composer kind is the notice', chatComposerKind(true) === 'daemon');
ck('normal node → composer kind is the chat input', chatComposerKind(false) === 'chat');

resetNodeRoles();
ck('before /api/nodes arrives, nobody is a daemon (normal composer, as before)', !isHostSupervisorAlias('daemon-a') && chatComposerKind(isHostSupervisorAlias('daemon-a')) === 'chat');
let notified = 0;
const off = subscribeNodeRoles(() => { notified++; });
const v0 = nodeRolesVersion();
hydrateNodeRoles(nodes);
ck('hydrate marks the daemons by alias', isHostSupervisorAlias('daemon-a') && isHostSupervisorAlias('daemon-b') && !isHostSupervisorAlias('worker-1'));
ck('hydrate swaps the composer for the daemon and only the daemon', chatComposerKind(isHostSupervisorAlias('daemon-a')) === 'daemon' && chatComposerKind(isHostSupervisorAlias('worker-1')) === 'chat');
ck('hydrate notifies subscribers and bumps the version', notified === 1 && nodeRolesVersion() !== v0);
hydrateNodeRoles(nodes.map(n => ({ ...n })));
ck('same content again does not re-notify (cheap to call every poll)', notified === 1);
hydrateNodeRoles(undefined);
ck('a failed read (undefined) keeps the last snapshot', isHostSupervisorAlias('daemon-a'));
hydrateNodeRoles(nodes.filter(n => n.alias !== 'daemon-a'));
ck('a node that stops being a daemon gets its composer back', !isHostSupervisorAlias('daemon-a') && notified === 2);
off();

// ── 托管的节点入口 ─────────────────────────────────────────────────────────────────────────
ck('managed nodes = rows whose lifecycle_daemon_node_id points at the daemon, sorted', JSON.stringify(managedNodeAliases(nodes, 'daemon-a')) === JSON.stringify(['worker-1', 'worker-2']));
ck('a daemon with nothing under it manages nothing', managedNodeAliases(nodes, 'daemon-b').length === 0);
ck('a non-daemon alias manages nothing', managedNodeAliases(nodes, 'worker-1').length === 0);
hydrateNodeRoles(nodes);
ck('store exposes managed aliases + hostname per daemon', managedAliasesOf('daemon-a').join(',') === 'worker-1,worker-2' && daemonHostnameOf('daemon-a') === 'host-a' && daemonHostnameOf('daemon-b') === null);
{
  const filter = managedNodesFilter('daemon-a', managedAliasesOf('daemon-a'), daemonHostnameOf('daemon-a'));
  const sessions = ['daemon-a', 'worker-1', 'worker-2', 'other'].map(alias => ({ alias, status: 'idle' }));
  const shown = applyAgentFilter(sessions, filter).map(s => s.alias);
  ck('managed-nodes filter is an active 机器 filter labelled with the daemon', isFilterActive(filter) && filter.hostLabel === 'daemon-a');
  ck('managed-nodes filter shows exactly the managed nodes', shown.join(',') === 'worker-1,worker-2');
  const noHost = managedNodesFilter('daemon-b', ['x'], null);
  ck('no hostname → filter keyed by the daemon alias (still active)', noHost.host === 'daemon-b' && isFilterActive(noHost));
}

// ── 列表:不画红点 ─────────────────────────────────────────────────────────────────────────
{
  const badge = { text: '3', a11yLabel: '3 条未读消息' };
  ck('daemon row: unread badge suppressed', agentRowBadge(badge, true) === null);
  ck('daemon row: manual-unread dot suppressed too', agentRowBadge({ text: '', a11yLabel: '标为未读', dot: true }, true) === null);
  ck('normal row: badge unchanged', agentRowBadge(badge, false) === badge);
}

// ── 接线(源码):两种布局都换掉、历史照常、列表用 agentRowBadge ─────────────────────────────
const chat = readFileSync(new URL('./ChatScreen.tsx', import.meta.url), 'utf8');
const agents = readFileSync(new URL('./AgentsScreen.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const notice = readFileSync(new URL('./DaemonComposerNotice.tsx', import.meta.url), 'utf8');
{
  const swap = chat.indexOf("{composerKind === 'daemon' ? (");
  const desktopBranch = chat.indexOf(') : desktop ? (', swap);
  const desktopInput = chat.indexOf('testID="desktop-composer-card"', swap);
  const phoneInput = chat.indexOf('styles.inputRow', swap);
  ck('ChatScreen picks the composer by role', /composerKind = chatComposerKind\(isHostSupervisorAlias\(alias\)\)/.test(chat));
  ck('daemon branch wraps BOTH the desktop card and the phone input row', swap > 0 && desktopBranch > swap && desktopInput > desktopBranch && phoneInput > desktopBranch);
  ck('daemon branch renders DaemonComposerNotice', /composerKind === 'daemon' \? \(\s*<DaemonComposerNotice/.test(chat));
  ck('run-logs entry opens the node page on the logs section', /requestNodeSection\(nodeInfoSectionKey\([^)]*\), 'logs'\); onOpenNodeSettings\(\)/.test(chat));
  ck('history list is not gated by role', !/composerKind[^\n]*FlatList|composerKind[^\n]*InvertedList/.test(chat) && (chat.match(/composerKind/g) ?? []).length === 3);
  ck('ChatScreen re-renders when roles change', /useSyncExternalStore\(subscribeNodeRoles, nodeRolesVersion/.test(chat));
  ck('agent list rows go through agentRowBadge(…, isHostSupervisorAlias(alias))', /agentRowBadge\(rowBadgeWithManual\([^\n]*isHostSupervisorAlias\(alias\)\)/.test(agents));
  ck('App feeds the same /api/nodes poll into the role store', (app.match(/hydrateNodeRoles\(r\.nodes\)/g) ?? []).length === 2);
  ck('App wires the managed-nodes entry on phone and desktop', /onOpenAgents=\{filter => setScreen\(agentListScreen\(filter, 'mobile'\)/.test(app) && /onOpenAgents=\{filter => setScreen\(agentListScreen\(filter, 'desktop'\)/.test(app));
  ck('notice uses the i18n key for the one-line copy', notice.includes("t('chat.daemon.notice')"));
}
ck('notice copy is the agreed sentence (zh) and has an English column', chatTranslations['chat.daemon.notice'][0] === '守护节点只执行创建 / 停止 / 重启 / 删除等结构化命令，不能对话' && !!chatTranslations['chat.daemon.notice'][1] && !!chatTranslations['chat.daemon.managed'][1]);

resetNodeRoles();
console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
