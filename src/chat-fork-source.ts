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
  // The Hub reports a co-presence node either as `opencode-cli` (hand-started TUI node) or
  // `opencode-sdk` (node whose OpenCode V2 server is attached); both are the same generation.
  // Pinning the exact runtime string rejected a live v2 node and the palette only said
  // "fork_requires_opencode_v2". Generation is still required: v1 cannot be forked here.
  const runtime = authorized[0].runtime;
  const isOpencode = typeof runtime === 'string' && runtime.startsWith('opencode-');
  if (!isOpencode || authorized[0].opencode_generation !== 'v2') return { ok: false as const, error: 'fork_requires_opencode_v2' };
  // The Hub forks only a source that exactly one daemon manages (created or adopted). A node
  // started by hand (`managed: 'none'`) is always refused with a bare 409 before any reason
  // can be attached — say so up front instead of letting the user submit into "conflict".
  // Older Hubs omit `managed` ⇒ undefined ⇒ unchanged behaviour (the Hub still decides).
  if (authorized[0].managed === 'none') return { ok: false as const, error: 'fork_source_not_managed' };
  if (!session.session_id || !/^ses_[A-Za-z0-9]{1,190}$/.test(session.session_id)) return { ok: false as const, error: 'fork_native_session_missing' };
  return { ok: true as const, nodeId: session.node_id, sessionId: session.session_id, networkId,
    label: session.alias, path: session.project_dir ?? null };
}

const FORK_SOURCE_ERROR_TEXT: Record<string, string> = {
  fork_network_missing: '还没选定网络，无法 fork。',
  fork_session_missing: '没有读到这个节点的实时会话上报，等它上线后再试。',
  fork_session_ambiguous: '同名节点在这个网络里有多条会话上报，无法确定 fork 哪一个。',
  fork_node_id_missing: '这个会话没有上报节点 ID，无法 fork。',
  fork_node_not_unique: '在节点列表里找不到唯一对应的节点，无法 fork。',
  fork_requires_opencode_v2: '只有 OpenCode V2 节点支持独立 fork。',
  fork_native_session_missing: '这个节点还没有 OpenCode 会话（ses_），无法 fork。',
  fork_source_not_managed: '这个节点是手动启动的，没有 daemon 管理，Hub 不允许 fork。请先在节点信息里把它收编到所在机器的 daemon，再 fork。',
};

/** Human text for a chatForkSource error code; unknown codes are shown as-is. */
export function describeForkSourceError(code: string): string {
  return FORK_SOURCE_ERROR_TEXT[code] ?? code;
}
