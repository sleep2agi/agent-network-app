// @ts-nocheck -- repository test scripts run directly under Bun; the app
// tsconfig intentionally excludes Node ambient types.
// #692 跟进 —— 守护节点(host_supervisor)的程序化回执不算未读:不进总数(托盘 / 侧栏)、不进「新消息」组。
// 这几处都从 agentUnreadCounts 取数,所以在那里排除一次,这里逐个出口验一遍。
import { readFileSync } from 'node:fs';
import { agentUnreadCounts } from './agent-unread-counts';
import { hydrateNodeRoles, resetNodeRoles } from './daemon-node';
import { railUnreadTotal } from './nav-chrome';
import { trayModelFrom } from './tray-menu-model';
import { buildSections, NEW_MESSAGES_TITLE } from './agents-list';
import { initialUnreadState } from './unread-ledger';

let passed = 0;
let total = 0;
const ck = (name: string, condition: boolean) => {
  total++;
  if (condition) { passed++; console.log('✅', name); }
  else console.log('❌', name);
};

const ledger = { ...initialUnreadState(), counts: { 'daemon-a': 4, 'worker-1': 2, 'worker-2': 1 } };
const localSnap = { serverBody: null, ledger, replyRows: [], replyUsername: '', replyWatermarks: {} };
// Hub 给了按 agent 的权威数(#1828)时走另一条路,也要排除。
const serverSnap = { serverBody: { unread_by_agent: { 'daemon-a': 9, 'worker-1': 3 } }, ledger: initialUnreadState(), replyRows: [], replyUsername: '', replyWatermarks: {} };
const nodes = [
  { node_id: 'node_d1', alias: 'daemon-a', role: 'host_supervisor' },
  { node_id: 'node_w1', alias: 'worker-1', role: 'agent', lifecycle_daemon_node_id: 'node_d1' },
  { node_id: 'node_w2', alias: 'worker-2', role: 'agent' },
];

resetNodeRoles();
ck('roles unknown (before /api/nodes): daemon still counted, as before', railUnreadTotal(agentUnreadCounts(localSnap)) === 7);

hydrateNodeRoles(nodes);
{
  const counts = agentUnreadCounts(localSnap);
  ck('daemon has no entry in the per-agent counts', !('daemon-a' in counts));
  ck('other agents keep their counts', counts['worker-1'] === 2 && counts['worker-2'] === 1);
  ck('total unread (rail) excludes the daemon: 2 + 1 = 3', railUnreadTotal(counts) === 3);
  ck('tray total excludes the daemon and lists no daemon row', trayModelFrom(counts).total === 3 && trayModelFrom(counts).items.every(i => i.alias !== 'daemon-a'));
}
{
  const counts = agentUnreadCounts(serverSnap);
  ck('authoritative hub counts: daemon excluded there too, others kept', !('daemon-a' in counts) && counts['worker-1'] === 3 && railUnreadTotal(counts) === 3);
}
{
  const counts = agentUnreadCounts(localSnap);
  const fleet = ['daemon-a', 'worker-1', 'worker-2', 'idle-x'].map(alias => ({ alias, status: 'idle' }));
  const secs = buildSections(fleet, '', { unread: { count: a => counts[a] ?? 0, lastMessageAt: () => 0 } });
  const fresh = secs.find(s => s.title === NEW_MESSAGES_TITLE);
  ck('「新消息」group exists for the real unread agents', !!fresh && fresh.data.some(s => s.alias === 'worker-1'));
  ck('daemon is not in the 「新消息」 group', !!fresh && fresh.data.every(s => s.alias !== 'daemon-a'));
  ck('daemon still listed in its normal group (only not floated)', secs.some(s => s.title !== NEW_MESSAGES_TITLE && s.data.some(x => x.alias === 'daemon-a')));
}

// 角色变化要触发重算(源码接线)。
const rail = readFileSync(new URL('./MobileNavRail.tsx', import.meta.url), 'utf8');
const tray = readFileSync(new URL('./desktop-tray.ts', import.meta.url), 'utf8');
const agents = readFileSync(new URL('./AgentsScreen.tsx', import.meta.url), 'utf8');
ck('rail total recomputes on role change', /useMemo\(\(\) => railUnreadTotal\(agentUnreadCounts\(snap\)\), \[snap, roles\]\)/.test(rail));
ck('tray re-syncs on role change', /subscribeNodeRoles\(sync\)/.test(tray));
ck('agent list 新消息 input recomputes on role change', /\[preview, unreadSnap, rolesVersion\]/.test(agents));

resetNodeRoles();
console.log(`\n${passed}/${total} passed`);
process.exit(passed === total ? 0 : 1);
