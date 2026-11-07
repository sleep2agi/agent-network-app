// #4150 现有项目 → 新空 Session → 独立 child（gated preview）客户端契约。
// 合同：anet-4150-create-adapter docs/runbooks/session-project-create.md。
//
// 红线：
// · POST 只接受**五个字段**：selection_scope(srcdir_) / snapshot_id(snap_) / project_id(oprj_) / child_name / intent_id；
//   客户端不能带 network/daemon/native project 或 Session id/server id/URL/path/model/token/headers；
// · selection_scope 必须是「选过 Server 并返回 projects」的那次请求，不能是 Server-only 列表；
// · 目录快照必须带 selection_expires_at（旧快照没有该字段 → **不能**授权新会话）；
// · 这**不是** fork 也不是 attach：不选已有 Session、不伪造 source evidence，`oses_` 绝不能当 managed fork 的 `ses_`；
// · session_creation:"unknown" 包含「成功体丢失」——不能当成「没创建」；
// · registration_confirmed 只是注册回执，不得写成 online/healthy/TUI ready。
// 纯逻辑，不 import react-native。

export const PROJECT_CREATE_BASE = '/api/node-session-control/source/project-create';

export type ProjectCreateStatus =
  | 'create_pending' | 'create_claimed' | 'delivery_pending' | 'delivery_claimed'
  | 'registration_confirmed' | 'unknown_rotation_required';

export interface ProjectCreateSelection {
  /** 选中 Server 后返回 projects 的那次 directory 请求 id（srcdir_…）。 */
  selectionScope: string;
  snapshotId: string;
  projectId: string;
  childName: string;
  intentId: string;
}

const SCOPED = /^srcdir_[A-Za-z0-9-]{1,80}$/;
const SNAP = /^snap_[A-Za-z0-9-]{1,80}$/;
const PROJ = /^oprj_[A-Za-z0-9-]{1,80}$/;
const NAME = /^[^\s\x00-\x1f\x7f]{1,64}$/;
const INTENT = /^[A-Za-z0-9_-]{1,200}$/;

export type Check = { ok: true } | { ok: false; error: string };

export function validateProjectCreateSelection(s: Partial<ProjectCreateSelection>): Check {
  if (!s.selectionScope || !SCOPED.test(s.selectionScope)) return { ok: false, error: 'selection_scope 必须来自「选过 Server 并返回 projects」的目录请求（srcdir_…）' };
  if (!s.snapshotId || !SNAP.test(s.snapshotId)) return { ok: false, error: 'snapshot_id 非法（snap_…）' };
  if (!s.projectId || !PROJ.test(s.projectId)) return { ok: false, error: 'project_id 非法（oprj_…）' };
  if (!s.childName || !NAME.test(s.childName)) return { ok: false, error: 'child_name 非法（沿用节点名校验）' };
  if (!s.intentId || !INTENT.test(s.intentId)) return { ok: false, error: 'intent_id 非法（[A-Za-z0-9_-]{1,200}）' };
  return { ok: true };
}

/** 请求体：**恰好**五个字段（顺序固定），杜绝 network/daemon/native id/token 泄漏。 */
export function buildProjectCreateBody(s: ProjectCreateSelection): Record<string, string> {
  return {
    selection_scope: s.selectionScope,
    snapshot_id: s.snapshotId,
    project_id: s.projectId,
    child_name: s.childName,
    intent_id: s.intentId,
  };
}

/** 目录快照是否可用于「新会话」：必须带 selection_expires_at 且未过期（旧快照一律不行）。 */
export function canUseSnapshotForNewSession(input: {
  snapshot?: { expiresAt?: number | null; selectionExpiresAt?: number | null } | null;
  hasProjectCreateCapability: boolean;
  now?: number;
}): { ok: boolean; reason: string } {
  const now = input.now ?? Date.now();
  if (!input.hasProjectCreateCapability) return { ok: false, reason: '该节点未声明 project_new_session 能力，不能新建会话' };
  const snap = input.snapshot;
  if (!snap) return { ok: false, reason: '没有目录快照，先刷新目录' };
  const sel = snap.selectionExpiresAt;
  if (typeof sel !== 'number') return { ok: false, reason: '目录快照未提供 selection_expires_at（旧快照不能授权新建会话）' };
  if (sel <= now) return { ok: false, reason: '项目选择已过期：请刷新目录后重新选择（不会自动重放）' };
  return { ok: true, reason: '可用：选择在有效期内（约 10 分钟）' };
}

export type ProjectCreateOutcome =
  | { kind: 'progress'; status: ProjectCreateStatus }
  | { kind: 'registered'; status: 'registration_confirmed'; childNodeId?: string }
  | { kind: 'unknown'; status: 'unknown_rotation_required'; sessionCreation: 'unknown' }
  | { kind: 'failed'; error: string };

/** 状态语义：registration_confirmed 只是注册回执；unknown_rotation_required 表示不可重放。 */
export function classifyProjectCreate(status: ProjectCreateStatus, sessionCreation?: string, childNodeId?: string): ProjectCreateOutcome {
  if (status === 'registration_confirmed') return { kind: 'registered', status, childNodeId };
  if (status === 'unknown_rotation_required') return { kind: 'unknown', status, sessionCreation: 'unknown' };
  if (sessionCreation === 'unknown') {
    return { kind: 'unknown', status: 'unknown_rotation_required', sessionCreation: 'unknown' };
  }
  return { kind: 'progress', status };
}

/** 回执展示文案：绝不写 online/healthy/TUI ready。 */
export function projectCreateLabel(outcome: ProjectCreateOutcome): string {
  if (outcome.kind === 'registered') return `已注册（registration_confirmed）${outcome.childNodeId ? ` · child ${outcome.childNodeId}` : ''}——注册回执不等于在线/健康/TUI 就绪`;
  if (outcome.kind === 'unknown') return '结果未知（session_creation=unknown）：可能已创建，禁止自动重放或更换 intent';
  if (outcome.kind === 'failed') return `失败：${outcome.error}`;
  return `进行中：${outcome.status}`;
}
