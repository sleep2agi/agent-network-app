// Hub req #938 — 在同一台 Daemon 下复制一个节点：新名称 + 是否复制会话。
//
// 契约以 sleep2agi/agent-network main 5f8961c8（PR #2579，Hub #938 clone_node）为准。
// tools/call name: "clone_node"
// arguments:
//   source_node_id   源节点的 nodes.node_id（必填）
//   name             新别名，规则同 checkNodeName（必填）
//   copy_session     是否复制会话。缺省 true；这里总是显式传。
//   workdir_policy   new_empty（默认，源目录旁的新空目录）| share_source（显式共用源目录）
//   daemon_node_id   可选。传了就必须是源节点所属的 Daemon，否则 cross_daemon_refused。
//   network_id?      与 create_node 相同
// 成功 { ok:true, request_id, daemon_node_id, child_name, copy_session, workdir_policy,
//        session_contract, contract } 只表示 node_create_requests 插进了一行（status=pending），
//        门铃已推。子节点还没注册。
// 业务失败在工具 payload 里：{ ok:false, error, ...detail }。
//   node_name_conflict（reason: same_as_source | alias_taken | inflight_create）
//   node_name_invalid | workdir_policy_invalid | node_not_found | cross_network_node
//   source_alias_missing | cannot_clone_daemon | source_not_daemon_child | cross_daemon_refused
//   source_runtime_unknown | daemon_not_found | insufficient_role_for_create_node
//   auth_required | network_id_required | access_denied | permission_denied
// 工具不存在（仅此走演示）: JSON-RPC "Tool clone_node not found" / unknown tool，或 HTTP 404/501。

import { NODE_NAME_MAX_CHARS, checkNodeName, normalizeNodeName } from './node-name';

export const CLONE_NODE_TOOL = 'clone_node';

export const CLONE_WORKDIR_POLICIES = ['new_empty', 'share_source'] as const;
export type CloneWorkdirPolicy = (typeof CLONE_WORKDIR_POLICIES)[number];

export function isCloneWorkdirPolicy(value: unknown): value is CloneWorkdirPolicy {
  return value === 'new_empty' || value === 'share_source';
}

export interface CloneNodeArgs {
  daemon_node_id: string;
  source_node_id: string;
  name: string;
  copy_session: boolean;
  workdir_policy: CloneWorkdirPolicy;
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
  node_name_invalid: 'nodeClone.error.invalid',
  workdir_policy_invalid: 'nodeClone.error.workdir',
  node_not_found: 'nodeClone.error.source',
  cross_network_node: 'nodeClone.error.crossNetwork',
  source_alias_missing: 'nodeClone.error.alias',
  cannot_clone_daemon: 'nodeClone.error.daemonSelf',
  source_not_daemon_child: 'nodeClone.error.notChild',
  cross_daemon_refused: 'nodeClone.error.crossDaemon',
  source_runtime_unknown: 'nodeClone.error.runtime',
  daemon_not_found: 'nodeClone.error.noDaemon',
  insufficient_role_for_create_node: 'nodeClone.error.role',
  auth_required: 'nodeClone.error.auth',
  network_id_required: 'nodeClone.error.network',
  access_denied: 'nodeClone.error.access',
  permission_denied: 'nodeClone.error.permission',
};

/** JSON-RPC 说工具不存在。业务错误里的 "source not found" 不含 "tool … not found"，不算。 */
export function isCloneToolMissing(message: string): boolean {
  return /unknown tool/i.test(message) || /tool\s+\S+\s+not found/i.test(message);
}

/** 别名冲突看 reason。没列进表的 code 返回 null，界面照原样显示 Hub 的 error。 */
export function cloneErrorKey(error: string, reason?: string | null): string | null {
  if (error === 'node_name_conflict') {
    if (reason === 'same_as_source') return 'nodeClone.error.same';
    if (reason === 'inflight_create') return 'nodeClone.error.inflight';
    return 'nodeClone.error.taken';
  }
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
  workdirPolicy?: CloneWorkdirPolicy;
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
      workdir_policy: input.workdirPolicy ?? 'new_empty',
    },
  };
}

export type CloneToolReply =
  | { kind: 'payload'; payload: unknown }
  | { kind: 'unsupported' }
  | { kind: 'error'; error: string };

export type CloneSuccess = {
  ok: true;
  demo: false;
  pending: true;
  request_id: string;
  child_name: string;
  copy_session: boolean;
  workdir_policy: CloneWorkdirPolicy;
  sessionDetail: string | null;
};

export type CloneOutcome =
  | CloneSuccess
  | { ok: false; demo: true; unsupported: true; preview: CloneNodeArgs; errorKey: 'nodeClone.demoBody' }
  | { ok: false; demo: false; error: string; errorKey: string | null; field?: string };

function sessionDetailOf(payload: { session_contract?: unknown }): string | null {
  const contract = payload.session_contract;
  if (!contract || typeof contract !== 'object') return null;
  const detail = (contract as { detail?: unknown }).detail;
  return typeof detail === 'string' && detail.trim() ? detail.trim() : null;
}

export function interpretCloneReply(reply: CloneToolReply, preview: CloneNodeArgs): CloneOutcome {
  if (reply.kind === 'unsupported') return { ok: false, demo: true, unsupported: true, preview, errorKey: 'nodeClone.demoBody' };
  if (reply.kind === 'error') {
    if (isCloneToolMissing(reply.error)) return { ok: false, demo: true, unsupported: true, preview, errorKey: 'nodeClone.demoBody' };
    return { ok: false, demo: false, error: reply.error, errorKey: null };
  }
  const payload = reply.payload && typeof reply.payload === 'object'
    ? reply.payload as {
      ok?: boolean;
      error?: unknown;
      field?: unknown;
      reason?: unknown;
      request_id?: unknown;
      child_name?: unknown;
      copy_session?: unknown;
      workdir_policy?: unknown;
      session_contract?: unknown;
    }
    : null;
  if (!payload) return { ok: false, demo: false, error: 'empty hub response', errorKey: null };
  if (payload.ok === false) {
    const error = typeof payload.error === 'string' && payload.error ? payload.error : 'clone_node failed';
    const reason = typeof payload.reason === 'string' ? payload.reason : null;
    return {
      ok: false,
      demo: false,
      error,
      errorKey: cloneErrorKey(error, reason),
      ...(typeof payload.field === 'string' ? { field: payload.field } : {}),
    };
  }
  const requestId = typeof payload.request_id === 'string' ? payload.request_id.trim() : '';
  if (payload.ok !== true || !requestId) {
    return { ok: false, demo: false, error: 'clone_node ok without request_id', errorKey: 'nodeClone.error.unconfirmed' };
  }
  return {
    ok: true,
    demo: false,
    pending: true,
    request_id: requestId,
    child_name: typeof payload.child_name === 'string' && payload.child_name.trim() ? payload.child_name.trim() : preview.name,
    copy_session: typeof payload.copy_session === 'boolean' ? payload.copy_session : preview.copy_session,
    workdir_policy: isCloneWorkdirPolicy(payload.workdir_policy) ? payload.workdir_policy : preview.workdir_policy,
    sessionDetail: sessionDetailOf(payload),
  };
}

export interface CloneDialogResult {
  demo: boolean;
  pending: boolean;
  name: string;
  copySession: boolean;
  workdirPolicy: CloneWorkdirPolicy;
  sessionDetail: string | null;
}

export function cloneNoticeMessage(
  outcome: Pick<CloneDialogResult, 'demo' | 'name' | 'workdirPolicy' | 'sessionDetail'>,
  translate: (key: string, values?: Record<string, string | number>) => string,
): string {
  if (outcome.demo) return translate('nodeClone.demoAck');
  const lines = [
    translate('nodeClone.submitted.pending', { name: outcome.name }),
    translate(outcome.workdirPolicy === 'share_source' ? 'nodeClone.submitted.noteShare' : 'nodeClone.submitted.noteEmpty'),
  ];
  const detail = outcome.sessionDetail?.trim();
  if (detail) lines.push(detail);
  return lines.join('\n');
}
