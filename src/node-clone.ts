// Hub req #938 — 在同一台 Daemon 下复制一个节点：新名称 + 是否复制会话。
//
// 后端契约（与 create_node 同一条 MCP 路，snake_case）。2026-10-11 核对过
// sleep2agi/agent-network 的 main 和当时的 draft PR：还没有 clone_node。
// 工具一落地，这里的参数不用改；Hub 回「没有这个工具」时 UI 标成演示，不假装已经建出节点。
//
// tools/call name: "clone_node"
// arguments:
//   daemon_node_id  已经托管源节点的 host_supervisor（复制品留在这台 Daemon 上）
//   source_node_id  源节点的 nodes.node_id
//   name            新别名，规则同 checkNodeName
//   copy_session    是否把源节点当前可恢复的 sessions.session_id 交给新节点。缺省视为 true。
//   network_id?     与 create_node 相同
// 成功: { ok: true, request_id }
// 业务失败（必须放在工具 payload 里，不要用 JSON-RPC 的 "not found"，那句话留给「工具不存在」）:
//   name_taken | invalid_name | node_name_invalid | source_not_found | source_not_on_daemon
//   daemon_not_found | daemon_cannot_create_nodes | insufficient_role_for_clone_node
//   copy_session_unavailable
// 工具不存在: JSON-RPC "Tool clone_node not found" / unknown tool，或 HTTP 404/501。

import { NODE_NAME_MAX_CHARS, checkNodeName, normalizeNodeName } from './node-name';

export const CLONE_NODE_TOOL = 'clone_node';

export interface CloneNodeArgs {
  daemon_node_id: string;
  source_node_id: string;
  name: string;
  copy_session: boolean;
  network_id?: string;
}

export interface CloneSource {
  nodeId: string;
  alias: string;
  name: string;
  daemonNodeId: string;
}

export const CLONE_NOTE_KEYS = [
  'nodeClone.note.identity',
  'nodeClone.note.secrets',
  'nodeClone.note.session',
] as const;

const ERROR_KEYS: Record<string, string> = {
  name_taken: 'nodeClone.error.taken',
  invalid_name: 'nodeClone.error.invalid',
  node_name_invalid: 'nodeClone.error.invalid',
  source_not_found: 'nodeClone.error.source',
  source_not_on_daemon: 'nodeClone.error.daemonMismatch',
  daemon_not_found: 'nodeClone.error.noDaemon',
  daemon_cannot_create_nodes: 'nodeClone.error.daemonBlocked',
  insufficient_role_for_clone_node: 'nodeClone.error.role',
  copy_session_unavailable: 'nodeClone.error.noSession',
};

/** JSON-RPC 说工具不存在。业务错误里的 "source not found" 不含 "tool … not found"，不算。 */
export function isCloneToolMissing(message: string): boolean {
  return /unknown tool/i.test(message) || /tool\s+\S+\s+not found/i.test(message);
}

export function cloneErrorKey(error: string): string | null {
  return ERROR_KEYS[error] ?? null;
}

export interface CloneAvailability {
  enabled: boolean;
  reasonKey: string | null;
}

export function cloneAvailability(input: {
  nodeId?: string | null;
  daemonNodeId?: string | null;
  hostSupervisor?: boolean;
  pending?: boolean;
} | null): CloneAvailability {
  if (!input || input.pending) return { enabled: false, reasonKey: 'nodeClone.reason.loading' };
  if (!input.nodeId) return { enabled: false, reasonKey: 'nodeClone.reason.noNode' };
  if (input.hostSupervisor) return { enabled: false, reasonKey: 'nodeClone.reason.daemonSelf' };
  if (!input.daemonNodeId) return { enabled: false, reasonKey: 'nodeClone.reason.needsDaemon' };
  return { enabled: true, reasonKey: null };
}

function fitName(base: string, suffix: string): string | null {
  const budget = NODE_NAME_MAX_CHARS - [...suffix].length;
  if (budget < 1) return null;
  let stem = [...base].slice(0, budget).join('');
  while (stem.length > 0 && !checkNodeName(stem + suffix).ok) stem = [...stem].slice(0, -1).join('');
  if (!stem) return null;
  const checked = checkNodeName(stem + suffix);
  return checked.ok ? checked.name : null;
}

/** 预填一个还没被占用的名字。含汉字用「副本」，否则用 `-copy`。 */
export function suggestCloneName(sourceName: string, taken: readonly string[] = []): string {
  const base = normalizeNodeName(sourceName);
  const used = new Set(taken.map(name => normalizeNodeName(name)).filter(Boolean));
  const cjk = /\p{Script=Han}/u.test(base);
  const suffixes = cjk
    ? ['副本', ...Array.from({ length: 19 }, (_, i) => `副本${i + 2}`)]
    : ['-copy', ...Array.from({ length: 19 }, (_, i) => `-copy-${i + 2}`)];
  for (const suffix of suffixes) {
    const candidate = base ? fitName(base, suffix) : null;
    if (candidate && !used.has(candidate)) return candidate;
  }
  const fallback = fitName('node', '-copy');
  return fallback && !used.has(fallback) ? fallback : 'node-copy';
}

export type CloneDraft =
  | { ok: true; request: Omit<CloneNodeArgs, 'network_id'> }
  | { ok: false; field: 'name'; error: 'empty' | 'invalid' | 'same' | 'taken'; messageKey: string };

export function cloneDraft(input: {
  source: CloneSource;
  name: string;
  copySession: boolean;
  taken: readonly string[];
}): CloneDraft {
  const checked = checkNodeName(input.name);
  if (!checked.ok) {
    return {
      ok: false,
      field: 'name',
      error: checked.error === 'empty' ? 'empty' : 'invalid',
      messageKey: checked.error === 'empty' ? 'nodeClone.error.empty' : 'nodeClone.error.invalid',
    };
  }
  const sourceNames = new Set([input.source.alias, input.source.name].map(name => normalizeNodeName(name)).filter(Boolean));
  if (sourceNames.has(checked.name)) return { ok: false, field: 'name', error: 'same', messageKey: 'nodeClone.error.same' };
  const used = new Set(input.taken.map(name => normalizeNodeName(name)).filter(Boolean));
  if (used.has(checked.name)) return { ok: false, field: 'name', error: 'taken', messageKey: 'nodeClone.error.taken' };
  return {
    ok: true,
    request: {
      daemon_node_id: input.source.daemonNodeId,
      source_node_id: input.source.nodeId,
      name: checked.name,
      copy_session: input.copySession,
    },
  };
}

export type CloneToolReply =
  | { kind: 'payload'; payload: unknown }
  | { kind: 'unsupported' }
  | { kind: 'error'; error: string };

export type CloneOutcome =
  | { ok: true; demo: false; request_id?: string }
  | { ok: false; demo: true; unsupported: true; preview: CloneNodeArgs; errorKey: 'nodeClone.demoBody' }
  | { ok: false; demo: false; error: string; errorKey: string | null; field?: string };

export function interpretCloneReply(reply: CloneToolReply, preview: CloneNodeArgs): CloneOutcome {
  if (reply.kind === 'unsupported') return { ok: false, demo: true, unsupported: true, preview, errorKey: 'nodeClone.demoBody' };
  if (reply.kind === 'error') {
    if (isCloneToolMissing(reply.error)) return { ok: false, demo: true, unsupported: true, preview, errorKey: 'nodeClone.demoBody' };
    return { ok: false, demo: false, error: reply.error, errorKey: null };
  }
  const payload = reply.payload && typeof reply.payload === 'object'
    ? reply.payload as { ok?: boolean; error?: unknown; field?: unknown; request_id?: unknown }
    : null;
  if (!payload) return { ok: false, demo: false, error: 'empty hub response', errorKey: null };
  if (payload.ok === false) {
    const error = typeof payload.error === 'string' && payload.error ? payload.error : 'clone_node failed';
    return {
      ok: false,
      demo: false,
      error,
      errorKey: cloneErrorKey(error),
      ...(typeof payload.field === 'string' ? { field: payload.field } : {}),
    };
  }
  return { ok: true, demo: false, ...(typeof payload.request_id === 'string' ? { request_id: payload.request_id } : {}) };
}

export function cloneResultMessageKey(outcome: { demo: boolean; copySession: boolean }): string {
  if (outcome.demo) return 'nodeClone.demoAck';
  return outcome.copySession ? 'nodeClone.submitted.copy' : 'nodeClone.submitted.fresh';
}
