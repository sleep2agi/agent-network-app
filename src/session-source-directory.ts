// #46bf69cd / #4150 现有 OpenCode 项目/Session 目录（**只读** preview）客户端契约。
// 合同：anet-4150-create-adapter docs/runbooks/session-source-directory.md（commit 46bf69cd）。
//
// 红线（合同原文）：
// · POST body **恰好** network_id / source_node_id / daemon_node_id；
// · ready.snapshot 只允许出网这些字段：snapshot_id / expires_at / lease_kind / completeness /
//   servers[{server_id,title}] / projects[{project_id,server_id,title}] /
//   sessions[{session_id,project_id,title,activity,binding,attach_authorized}]；
// · `oses_` 是**目录 ID**，不是原生 session、不是 source ref、**不是写许可** → 绝不能当 fork 的 session_id；
// · attach_authorized:false 一律不提供 attach；binding 恒为 unknown（不得说“确认空闲”）；
// · ready 之外没有 snapshot；failed 无 snapshot；404 = gate 未开放，绝不 fallback 普通 create。
// 纯逻辑，不 import react-native。

export const DIRECTORY_BASE = '/api/node-session-control/source/directory';

export interface DirectoryRequest {
  networkId: string;
  sourceNodeId: string;
  daemonNodeId: string;
}

const ID_RE = /^[A-Za-z0-9_.:-]{1,200}$/;

export function validateDirectoryRequest(r: Partial<DirectoryRequest>): { ok: true } | { ok: false; error: string } {
  if (!r.networkId || !ID_RE.test(r.networkId)) return { ok: false, error: '缺少或非法的 network_id' };
  if (!r.sourceNodeId || !ID_RE.test(r.sourceNodeId)) return { ok: false, error: '缺少或非法的 source_node_id' };
  if (!r.daemonNodeId || !ID_RE.test(r.daemonNodeId)) return { ok: false, error: '缺少或非法的 daemon_node_id' };
  return { ok: true };
}

/** body：**恰好**三个字段（不带 server_id；选 Server 是第二次 POST，单独构造）。 */
export function buildDirectoryBody(r: DirectoryRequest): Record<string, string> {
  return { network_id: r.networkId, source_node_id: r.sourceNodeId, daemon_node_id: r.daemonNodeId };
}

/** 合同：server_id 与 selection_scope 必须成对出现（Hub 缺一即 400）。 */
const SRCDIR_ID_RE = /^srcdir_[a-f0-9-]{36}$/;
const OSRV_ID_RE = /^osrv_[a-f0-9-]{36}$/;

export function validateDirectorySelect(serverId: string, selectionScope: string): { ok: true } | { ok: false; error: string } {
  if (!OSRV_ID_RE.test(serverId)) return { ok: false, error: '缺少或非法的 server_id' };
  if (!SRCDIR_ID_RE.test(selectionScope)) return { ok: false, error: 'selection_scope 必须是父 directory 请求 id（srcdir_）' };
  return { ok: true };
}

/** 选 Server 的第二次 POST：父请求 + server_id + selection_scope（合同：父请求 id）。 */
export function buildDirectorySelectBody(r: DirectoryRequest, serverId: string, selectionScope: string): Record<string, string> {
  return { ...buildDirectoryBody(r), server_id: serverId, selection_scope: selectionScope };
}

export type DirectoryStatus = 'pending' | 'claimed' | 'ready' | 'failed';

export interface DirectoryServer { serverId: string; title: string }
export interface DirectoryProject { projectId: string; serverId: string; title: string }
export interface DirectorySession {
  /** 目录 ID（oses_…）：**不是**原生 session，不能用于 fork/attach/create。 */
  sessionId: string;
  projectId: string;
  title: string;
  activity: 'running' | 'unknown';
  /** 合同恒定 unknown：UI 必须标「binding unknown / candidate」。 */
  binding: 'unknown';
  /** 合同恒定 false：不提供 attach 入口。 */
  attachAuthorized: false;
}

export interface DirectorySnapshot {
  snapshotId: string;
  expiresAt: number | null;
  /** 合同：只有带该字段的 ready 快照才能授权「新会话」（约 10 分钟选择窗口）。 */
  selectionExpiresAt: number | null;
  leaseKind: string | null;
  completeness: string | null;
  servers: DirectoryServer[];
  projects: DirectoryProject[];
  sessions: DirectorySession[];
}

export type DirectoryResult =
  | { kind: 'pending'; requestId: string }
  | { kind: 'claimed'; requestId: string }
  | { kind: 'ready'; requestId: string; snapshot: DirectorySnapshot }
  | { kind: 'failed'; requestId: string; error: string }
  | { kind: 'unavailable'; error: string }
  | { kind: 'denied'; error: string }
  | { kind: 'invalid'; error: string };

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** 严格白名单：只保留合同字段，任何私有/原生字段一律丢弃。 */
export function pickSnapshot(raw: unknown): DirectorySnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const servers = Array.isArray(s.servers)
    ? s.servers.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
        .map(x => ({ serverId: str(x.server_id), title: str(x.title) }))
        .filter(x => x.serverId)
    : [];
  const projects = Array.isArray(s.projects)
    ? s.projects.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
        .map(x => ({ projectId: str(x.project_id), serverId: str(x.server_id), title: str(x.title) }))
        .filter(x => x.projectId)
    : [];
  const sessions = Array.isArray(s.sessions)
    ? s.sessions.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
        .map(x => ({
          sessionId: str(x.session_id),
          projectId: str(x.project_id),
          title: str(x.title),
          activity: x.activity === 'running' ? 'running' as const : 'unknown' as const,
          binding: 'unknown' as const,
          attachAuthorized: false as const,
        }))
        .filter(x => x.sessionId)
    : [];
  const snapshotId = str(s.snapshot_id);
  if (!snapshotId) return null;
  return {
    snapshotId,
    expiresAt: typeof s.expires_at === 'number' ? s.expires_at : null,
    selectionExpiresAt: typeof s.selection_expires_at === 'number' ? s.selection_expires_at : null,
    leaseKind: typeof s.lease_kind === 'string' ? s.lease_kind : null,
    completeness: typeof s.completeness === 'string' ? s.completeness : null,
    servers, projects, sessions,
  };
}

/** 解析 GET 响应：ready 之外没有 snapshot；failed 明确失败，不给空目录。 */
export function parseDirectoryResponse(d: unknown, requestId: string): DirectoryResult {
  const o = (d ?? {}) as Record<string, unknown>;
  if (o.ok !== true) {
    const err = str(o.error);
    if (/unavailable/i.test(err)) return { kind: 'unavailable', error: err || 'source_directory_unavailable' };
    return { kind: 'failed', requestId, error: err || 'directory_read_failed' };
  }
  const status = str(o.status) as DirectoryStatus;
  if (status === 'ready') {
    const snapshot = pickSnapshot(o.snapshot);
    if (!snapshot) return { kind: 'failed', requestId, error: 'directory_read_failed' };
    return { kind: 'ready', requestId, snapshot };
  }
  if (status === 'failed') return { kind: 'failed', requestId, error: str(o.error) || 'directory_read_failed' };
  if (status === 'claimed') return { kind: 'claimed', requestId };
  return { kind: 'pending', requestId };
}

/** 红线守卫：目录 ID（oses_）**永远**不能被当成 fork 的 session_id。 */
export function canUseAsForkSession(sessionId: string): boolean {
  if (sessionId.startsWith('oses_')) return false;
  return /^ses_[A-Za-z0-9]{1,190}$/.test(sessionId);
}

/** UI 展示口径：activity 只有 running 是采样到的忙；其余与 binding 都必须标 unknown/candidate。 */
export function sessionBadge(s: DirectorySession): string {
  if (s.activity === 'running') return '活动：running（采样） · binding unknown · candidate';
  return '活动：unknown · binding unknown · candidate';
}

export function gateClosedDirectoryMessage(): string {
  return '目录读取未开放（Hub 未开启 read-only preview）——不会退回普通创建';
}
