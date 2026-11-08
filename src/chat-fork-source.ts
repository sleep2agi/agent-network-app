import type { HubNode, Session } from './api';

/** Never use an alias, an opaque oses_, or a stale ChatScreen state as a native
 * session ID. Resolve a unique fresh scoped report and its authorized node. */
export function chatForkSource(sessions: readonly Session[], nodes: readonly HubNode[], networkId: string | undefined, alias: string) {
  if (!networkId) return { ok: false as const, error: 'fork_network_missing' };
  const matches = sessions.filter(row => row.alias === alias && row.network_id === networkId);
  if (matches.length !== 1) return { ok: false as const, error: matches.length ? 'fork_session_ambiguous' : 'fork_session_missing' };
  const session = matches[0];
  if (!session.node_id) return { ok: false as const, error: 'fork_node_id_missing' };
  const authorized = nodes.filter(node => node.node_id === session.node_id);
  if (authorized.length !== 1) return { ok: false as const, error: 'fork_node_not_unique' };
  if (authorized[0].runtime !== 'opencode-cli' || authorized[0].opencode_generation !== 'v2') return { ok: false as const, error: 'fork_requires_opencode_v2' };
  if (!session.session_id || !/^ses_[A-Za-z0-9]{1,190}$/.test(session.session_id)) return { ok: false as const, error: 'fork_native_session_missing' };
  return { ok: true as const, nodeId: session.node_id, sessionId: session.session_id, networkId,
    label: session.alias, path: session.project_dir ?? null };
}
