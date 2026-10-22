// Board #908 slice 1 — what the daemon management page may show and which actions it may enable.
//
// Data comes only from fields the Hub already returns:
//   GET /api/nodes            role, runtime, lifecycle_state, lifecycle_daemon_node_id, lifecycle_controllable
//   GET /api/status?light=1   session status / runtime / agent
//   GET /api/host-supervisors the daemon row used by the existing create-node wizard
// A child is "managed" only when its lifecycle_daemon_node_id points at this daemon.
// There is no separate scoped-type column yet. Type is the node's role when the Hub sent one;
// a known type token in runtime is used only when role is absent. Anything else is labeled
// unrecognized or not reported — never invented.
//
// Probe: Hub tool probe_provider_model (RFC-028) needs provider_id + model_name + daemon_node_id.
// This page does not choose a provider (that is provider setup, board #906), so Probe stays disabled.
// No new Hub route is added.
//
// Pure logic. No react-native.

import type { HostSupervisorDaemon, HostSupervisorListResult, HubNode, NodeLifecycleAction } from './api';
import { isHostSupervisorNode, nodeRole } from './daemon-node';
import { t } from './i18n';
import './i18n-daemon';
import { dangerActions } from './node-danger-actions';
import { nodeControlView } from './node-control-access';
import { adoptionError } from './node-adoption';

export const DAEMON_MGMT_COMPACT_WIDTH = 640;

export type DaemonMgmtLayout = 'stack' | 'split';

/** Phone-width stack; wide pane splits the list and the selected node's actions. */
export const daemonMgmtLayout = (width: number): DaemonMgmtLayout =>
  width < DAEMON_MGMT_COMPACT_WIDTH ? 'stack' : 'split';

/**
 * Phone (stack) layout: the settings menu and one opened section never share the screen.
 * Before this the menu (8 rows) sat above the section and pushed it below the fold, so tapping
 * SKILLS / 令牌 / Provider looked like nothing happened.
 */
export const stackShowsMenu = (layout: DaemonMgmtLayout, menuOpen: boolean): boolean =>
  layout === 'stack' && menuOpen;
export const stackShowsSection = (layout: DaemonMgmtLayout, menuOpen: boolean): boolean =>
  !stackShowsMenu(layout, menuOpen);

export type KnownNodeType = 'daemon' | 'agent' | 'worker' | 'skillsProvider';

export interface NodeTypeView {
  kind: 'known' | 'unrecognized' | 'unreported';
  key: KnownNodeType | null;
  /** Role string the Hub sent, when it sent one. */
  raw: string | null;
}

const TYPE_KEYS: Record<string, KnownNodeType> = {
  host_supervisor: 'daemon',
  agent: 'agent',
  worker: 'worker',
  skills_provider: 'skillsProvider',
};

/** "SKILLS Provider" / "skills-provider" / "skills_provider" → one token. Other strings stay unrecognized. */
export function typeToken(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function knownType(raw: string): KnownNodeType | null {
  return TYPE_KEYS[typeToken(raw)] ?? null;
}

/**
 * Role wins. A non-empty role that is not a known token is unrecognized even if runtime
 * looks familiar. Runtime is consulted only when role was not reported, and only when the
 * runtime string itself is a known node-type token (not a runtime id such as claude-agent-sdk).
 */
export function nodeTypeView(role: string | null | undefined, runtime?: string | null): NodeTypeView {
  const roleRaw = role?.trim() ?? '';
  if (roleRaw) {
    const key = knownType(roleRaw);
    return key ? { kind: 'known', key, raw: roleRaw } : { kind: 'unrecognized', key: null, raw: roleRaw };
  }
  const runtimeRaw = runtime?.trim() ?? '';
  if (runtimeRaw) {
    const key = knownType(runtimeRaw);
    if (key) return { kind: 'known', key, raw: runtimeRaw };
  }
  return { kind: 'unreported', key: null, raw: null };
}

export function nodeTypeLabel(view: NodeTypeView): string {
  if (view.kind === 'known' && view.key) return t(`daemon.mgmt.type.${view.key}`);
  if (view.kind === 'unrecognized') return t('daemon.mgmt.unrecognized', { value: view.raw ?? '' });
  return t('daemon.mgmt.unreported');
}

export interface ManagedSessionInput {
  alias: string;
  status?: string | null;
  runtime?: string | null;
  agent?: string | null;
  node_id?: string | null;
}

export interface StatusView {
  kind: 'reported' | 'unreported';
  text: string;
  source: 'session' | 'lifecycle' | 'heartbeat' | 'unreported';
  /** null = the Hub did not say whether the process is up. Never treat that as offline. */
  online: boolean | null;
}

export function statusView(session: ManagedSessionInput | undefined, lifecycle: string | null | undefined): StatusView {
  const status = session?.status?.trim();
  if (status) return { kind: 'reported', text: status, source: 'session', online: status !== 'offline' };
  const life = lifecycle?.trim();
  if (life === 'stopped' || life === 'starting') return { kind: 'reported', text: life, source: 'lifecycle', online: false };
  if (life) return { kind: 'reported', text: life, source: 'lifecycle', online: null };
  return { kind: 'unreported', text: '', source: 'unreported', online: null };
}

/**
 * Header status for a daemon: /api/status (session.status, light) and /api/host-supervisors (`online` =
 * heartbeat within 5 min) are different clocks. A crashed daemon keeps status "idle" forever while its
 * heartbeat goes stale, and a cleanly stopped one writes "offline" while its heartbeat is still fresh.
 * Either one saying offline wins. `online` undefined = the Hub did not list it, which never means offline.
 */
export function daemonPresence(view: StatusView, supervisorOnline: boolean | undefined): StatusView {
  if (view.online === false) return view;
  if (supervisorOnline === false) return { kind: 'reported', text: 'offline', source: 'heartbeat', online: false };
  return view;
}

/** Offline for the overview banner. A daemon that is still starting is not "offline, last snapshot". */
export const isDaemonOffline = (view: StatusView): boolean => view.online === false && view.text !== 'starting';

export interface RuntimeView {
  kind: 'reported' | 'unreported';
  text: string;
  source: 'session' | 'node' | 'agent' | 'unreported';
}

/** Session runtime, then the node row's runtime, then the session agent. Never copied from role. */
export function runtimeView(session: ManagedSessionInput | undefined, nodeRuntime: string | null | undefined): RuntimeView {
  const fromSession = session?.runtime?.trim();
  if (fromSession) return { kind: 'reported', text: fromSession, source: 'session' };
  const fromNode = nodeRuntime?.trim();
  if (fromNode) return { kind: 'reported', text: fromNode, source: 'node' };
  const agent = session?.agent?.trim();
  if (agent) return { kind: 'reported', text: agent, source: 'agent' };
  return { kind: 'unreported', text: '', source: 'unreported' };
}

export const statusLabel = (view: StatusView): string => (view.kind === 'reported' ? view.text : t('daemon.mgmt.unreported'));
export const runtimeLabel = (view: RuntimeView): string => (view.kind === 'reported' ? view.text : t('daemon.mgmt.unreported'));

export interface ManagedNodeRow {
  nodeId: string;
  alias: string;
  name: string;
  node: HubNode;
  status: StatusView;
  runtime: RuntimeView;
  type: NodeTypeView;
}

export function matchSession(
  sessions: readonly ManagedSessionInput[] | null | undefined,
  node: { node_id: string; alias: string },
): ManagedSessionInput | undefined {
  if (!sessions) return undefined;
  return sessions.find(s => s.node_id && s.node_id === node.node_id) ?? sessions.find(s => s.alias === node.alias);
}

export function daemonNodeOf(nodes: readonly HubNode[] | null | undefined, daemonAlias: string): HubNode | null {
  if (!nodes) return null;
  return nodes.find(n => n.alias === daemonAlias && isHostSupervisorNode(n) && !!n.node_id) ?? null;
}

/** Nodes whose lifecycle_daemon_node_id is this daemon. Sorted by display name. No fabricated rows. */
export function managedRows(
  nodes: readonly HubNode[] | null | undefined,
  sessions: readonly ManagedSessionInput[] | null | undefined,
  daemonAlias: string,
): ManagedNodeRow[] {
  const daemon = daemonNodeOf(nodes, daemonAlias);
  if (!daemon?.node_id || !nodes) return [];
  const seen = new Set<string>();
  const rows: ManagedNodeRow[] = [];
  for (const node of nodes) {
    if (!node.node_id || !node.alias || node.node_id === daemon.node_id) continue;
    if (node.lifecycle_daemon_node_id !== daemon.node_id) continue;
    if (seen.has(node.node_id)) continue;
    seen.add(node.node_id);
    const session = matchSession(sessions, node);
    const runtime = runtimeView(session, node.runtime);
    rows.push({
      nodeId: node.node_id,
      alias: node.alias,
      name: node.node_name?.trim() || node.alias,
      node,
      status: statusView(session, node.lifecycle_state),
      runtime,
      type: nodeTypeView(nodeRole(node), runtime.kind === 'reported' ? runtime.text : null),
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true }) || a.alias.localeCompare(b.alias, 'en'));
  return rows;
}

export type MgmtActionId = 'create' | 'probe' | 'start' | 'restart' | 'stop' | 'delete';

export interface MgmtAction {
  id: MgmtActionId;
  enabled: boolean;
  visible: boolean;
  reasonKey: string | null;
  reasonValues?: Record<string, string | number>;
  /** Already-localized reason from an existing module (lifecycle / adoption). */
  reasonText?: string;
  /** Shown while the action stays enabled (create capability not reported). */
  hintKey: string | null;
}

export function actionReason(action: MgmtAction): string {
  if (!action.enabled) {
    if (action.reasonText) return action.reasonText;
    if (action.reasonKey) return t(action.reasonKey, action.reasonValues ?? {});
    return '';
  }
  return action.hintKey ? t(action.hintKey, action.reasonValues ?? {}) : '';
}

const off = (id: MgmtActionId, reasonKey: string, extra: Partial<MgmtAction> = {}): MgmtAction => ({
  id, enabled: false, visible: true, reasonKey, hintKey: null, ...extra,
});

export type SupervisorLookup =
  | { kind: 'loading' }
  | { kind: 'unsupported' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; daemon: HostSupervisorDaemon | null; ambiguous: boolean };

export function lookupSupervisor(
  result: HostSupervisorListResult | null,
  daemon: { node_id?: string; alias: string } | null,
): SupervisorLookup {
  if (!result) return { kind: 'loading' };
  if (!result.ok) return result.unconfirmed ? { kind: 'unsupported' } : { kind: 'error', message: result.error };
  if (!daemon) return { kind: 'ready', daemon: null, ambiguous: false };
  if (daemon.node_id) {
    const byId = result.daemons.find(d => d.daemon_node_id === daemon.node_id);
    if (byId) return { kind: 'ready', daemon: byId, ambiguous: false };
  }
  const byAlias = result.daemons.filter(d => d.alias === daemon.alias);
  if (byAlias.length > 1) return { kind: 'ready', daemon: null, ambiguous: true };
  return { kind: 'ready', daemon: byAlias[0] ?? null, ambiguous: false };
}

export function createAction(lookup: SupervisorLookup, hasHandler: boolean): MgmtAction {
  if (!hasHandler) return off('create', 'daemon.mgmt.createNoHandler');
  if (lookup.kind === 'loading') return off('create', 'daemon.mgmt.createLoading');
  if (lookup.kind === 'unsupported') return off('create', 'daemon.mgmt.createUpgrade');
  if (lookup.kind === 'error') return off('create', 'daemon.mgmt.unavailable', { reasonKey: null, reasonText: lookup.message });
  if (lookup.ambiguous) return off('create', 'daemon.mgmt.createAmbiguous');
  if (!lookup.daemon) return off('create', 'daemon.mgmt.createNoList');
  if (lookup.daemon.can_create_nodes === false) {
    return off('create', 'daemon.mgmt.createBlocked', {
      reasonValues: { reason: lookup.daemon.create_nodes_blocked_reason || 'anet_bin_unknown' },
    });
  }
  if (lookup.daemon.can_create_nodes !== true) {
    return { id: 'create', enabled: true, visible: true, reasonKey: null, hintKey: 'daemon.mgmt.createUnknown' };
  }
  return { id: 'create', enabled: true, visible: true, reasonKey: null, hintKey: null };
}

/** Provider probe needs a provider and a model. This slice does not collect either. */
export function probeAction(): MgmtAction {
  return off('probe', 'daemon.mgmt.probeReason');
}

export type NodeActionId = 'start' | 'restart' | 'stop' | 'delete';

function fromState(id: NodeActionId, state: { enabled: boolean; reason: string }, visible = true): MgmtAction {
  if (!visible) return { id, enabled: false, visible: false, reasonKey: null, hintKey: null };
  if (state.enabled) return { id, enabled: true, visible: true, reasonKey: null, hintKey: null };
  if (state.reason) return { id, enabled: false, visible: true, reasonKey: null, reasonText: state.reason, hintKey: null };
  return off(id, 'daemon.mgmt.unavailable');
}

export function nodeActions(input: {
  node: HubNode | null;
  status: StatusView;
  daemons: readonly HostSupervisorDaemon[] | undefined;
  networkId?: string | null;
}): MgmtAction[] {
  const ids: NodeActionId[] = ['start', 'restart', 'stop', 'delete'];
  if (!input.node) return ids.map(id => off(id, 'daemon.mgmt.selectNode'));
  if (!input.node.node_id) return ids.map(id => off(id, 'daemon.mgmt.noNodeId'));
  // Delete does not depend on online. When status is unknown, read only stopDelete from a
  // non-down snapshot so a missing session is not treated as "already stopped".
  if (input.status.online === null) {
    const danger = dangerActions({
      lifecycleControllable: input.node.lifecycle_controllable,
      online: true,
      configUpdateCapable: null,
      lifecycleState: 'active',
      alias: input.node.alias,
    });
    return [
      off('start', 'daemon.mgmt.statusUnknown'),
      off('restart', 'daemon.mgmt.statusUnknown'),
      off('stop', 'daemon.mgmt.statusUnknown'),
      fromState('delete', danger.stopDelete),
    ];
  }
  const danger = dangerActions({
    lifecycleControllable: input.node.lifecycle_controllable,
    online: input.status.online,
    configUpdateCapable: null,
    lifecycleState: input.node.lifecycle_state,
    alias: input.node.alias,
  });
  const control = nodeControlView({
    node: input.node,
    danger,
    online: input.status.online,
    hostname: input.node.hostname,
    daemons: input.daemons,
    networkId: input.networkId,
  });
  return [
    fromState('start', danger.start, danger.start.visible),
    fromState('restart', control.restart),
    fromState('stop', control.stop),
    fromState('delete', danger.stopDelete),
  ];
}

export function lifecycleTool(id: NodeActionId): NodeLifecycleAction {
  if (id === 'start') return 'start_node';
  if (id === 'restart') return 'restart_node';
  if (id === 'stop') return 'stop_node';
  return 'delete_node';
}

const START_ERROR_KEYS: Record<string, string> = {
  node_not_stopped: 'daemon.mgmt.startError.notStopped',
  node_already_starting: 'daemon.mgmt.startError.alreadyStarting',
  daemon_not_resolvable: 'daemon.mgmt.startError.noDaemon',
  daemon_not_found: 'daemon.mgmt.startError.noDaemon',
  daemon_child_mismatch: 'daemon.mgmt.startError.noDaemon',
  permission_denied: 'daemon.mgmt.startError.denied',
};

/** Known lifecycle failures get a translated sentence. Anything else is the Hub's own text. */
export function lifecycleErrorMessage(action: NodeActionId, error: string, inFlight?: number): string {
  if (error === 'node_busy_in_flight') return t('daemon.mgmt.busy', { count: inFlight ?? 1 });
  if (error === 'adopted_restart_requires_daemon' || error === 'lifecycle_identity_unavailable') return adoptionError(error);
  if (action === 'start' && START_ERROR_KEYS[error]) return t(START_ERROR_KEYS[error]);
  return error;
}
