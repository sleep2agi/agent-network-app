// #4150 受管 source 独立 fork（gated preview）客户端契约。
// 合同来源：/tmp/opencode/anet-4150-create-adapter/docs/runbooks/session-source-transport.md（db2ea154），
// 只按文档字段编码，未凭消息 ID 猜。
//
// 关键约束：
// · POST /api/node-session-control/source，**恰好**这些字段：
//   network_id / source_node_id / session_id / mode='fork_independent' / child_name / intent_id；
//   **不接受** daemon id、裸 URL、项目路径、token、evidence、binding 或任何额外字段；
// · session_id 必须是 ses_[A-Za-z0-9]{1,190}；child_name 走既有节点名校验；intent_id 走 [A-Za-z0-9_-]{1,200}；
// · 404 = gate 未开启 → 显示「未开放」，**不得** fallback 到普通 create；
// · unknown / 超时 / 丢包：**不得**新生成 intent；用同一 intent + 同字段重试原始 POST 以恢复 receipt；
// · registration_confirmed 只表示**注册回执**，不是原生接受/存活；
// · 只有 managed source → independent fork 这一条，不做普通 create 复用。
// 纯逻辑，不 import react-native。

export const SOURCE_FORK_MODE = 'fork_independent' as const;

export interface SourceForkSelection {
  networkId: string;
  sourceNodeId: string;
  sessionId: string;
  childName: string;
  intentId: string;
}

export interface SourceForkReceipt {
  ok: true;
  requestId: string;
  intentId: string;
  networkId: string;
  sourceNodeId: string;
  daemonNodeId?: string;
  sessionId: string;
  mode: typeof SOURCE_FORK_MODE;
  childName: string;
  status: SourceForkStatus;
  expiresAt?: number;
  nativeAcceptance?: string;
  dispatchScope?: string;
  childSessionId?: string;
  childNodeId?: string;
}

export const SOURCE_FORK_STATUSES = [
  'evidence_pending', 'evidence_claimed', 'recheck_pending', 'recheck_claimed',
  'execute_pending', 'execute_claimed', 'deliver_pending', 'deliver_claimed',
  'registration_confirmed', 'refused', 'unknown', 'unknown_rotation_required',
] as const;
export type SourceForkStatus = (typeof SOURCE_FORK_STATUSES)[number];

const SESSION_RE = /^ses_[A-Za-z0-9]{1,190}$/;
const INTENT_RE = /^[A-Za-z0-9_-]{1,200}$/;
const NET_RE = /^net[_-][A-Za-z0-9_\-]{1,120}$/;
const NODE_RE = /^[A-Za-z0-9_.:-]{1,200}$/;
const NAME_RE = /^[^\s\x00-\x1f\x7f]{1,64}$/;

export type Validation = { ok: true } | { ok: false; error: string };

export function validateSelection(s: Partial<SourceForkSelection>): Validation {
  if (!s.networkId || !NET_RE.test(s.networkId)) return { ok: false, error: '缺少或非法的 network_id（必须用当前网络）' };
  if (!s.sourceNodeId || !NODE_RE.test(s.sourceNodeId)) return { ok: false, error: '缺少或非法的 source_node_id（必须是受管 source 节点）' };
  if (!s.sessionId || !SESSION_RE.test(s.sessionId)) return { ok: false, error: '缺少或非法的 session_id（ses_ 前缀）' };
  if (!s.childName || !NAME_RE.test(s.childName)) return { ok: false, error: 'child_name 非法（沿用既有节点名规则）' };
  if (!s.intentId || !INTENT_RE.test(s.intentId)) return { ok: false, error: 'intent_id 非法（[A-Za-z0-9_-]{1,200}）' };
  return { ok: true };
}

/** 请求体：**恰好**合同里的六个字段，顺序固定，杜绝额外字段泄漏（daemon/URL/path/token/binding）。 */
export function buildSourceForkBody(s: SourceForkSelection): Record<string, string> {
  return {
    network_id: s.networkId,
    source_node_id: s.sourceNodeId,
    session_id: s.sessionId,
    mode: SOURCE_FORK_MODE,
    child_name: s.childName,
    intent_id: s.intentId,
  };
}

/** 生成一次 intent（只在用户显式发起、且没有已知意图时调用）。 */
export function newIntentId(seed: string): string {
  const base = seed.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120) || 'fork';
  const tail = Math.random().toString(36).replace(/[^a-z0-9]/g, '').slice(0, 10) || 'x';
  return `${base}_${tail}`.slice(0, 200);
}

export type PollOutcome =
  | { kind: 'progress'; status: SourceForkStatus }
  | { kind: 'registration-receipt'; status: 'registration_confirmed' }
  | { kind: 'refused'; status: 'refused' }
  | { kind: 'unknown'; status: 'unknown' | 'unknown_rotation_required' };

/** 把状态映射成 UI 语义：registration_confirmed 是**注册回执**，不是原生接受/存活。 */
export function classifyStatus(status: SourceForkStatus): PollOutcome {
  if (status === 'registration_confirmed') return { kind: 'registration-receipt', status };
  if (status === 'refused') return { kind: 'refused', status };
  if (status === 'unknown' || status === 'unknown_rotation_required') return { kind: 'unknown', status };
  return { kind: 'progress', status };
}

/** 未知/超时：**不生成新 intent**，用同一 intent 重试原始 POST。 */
export function retryPlan(selection: SourceForkSelection, outcome: PollOutcome): { action: 'retry-same-intent' | 'stop'; reason: string } {
  if (outcome.kind === 'unknown') {
    return { action: 'retry-same-intent', reason: 'unknown 只收敛已发出的 intent：用同一 intent_id 与同字段重试原始 POST，禁止新开意图' };
  }
  return { action: 'stop', reason: '非 unknown 状态不需要重放' };
}

/** gate 未开启（404）：明确「未开放」，不得 fallback 普通 create。 */
export function gateClosedMessage(): string {
  return '独立 fork 未开放（Hub 未开启 gated preview）——不会退回普通创建';
}

export interface SourceSessionCandidate { sessionId: string; nodeId: string; title?: string | null }

/** 只允许「当前网络 + 已知 source 节点 + 真实 session」发起；无权限/目录未知一律禁提交。 */
export function canStartFork(input: {
  networkId?: string | null;
  session?: SourceSessionCandidate | null;
  hasPermission: boolean;
}): { ok: boolean; reason: string } {
  if (!input.hasPermission) return { ok: false, reason: '当前账号/网络没有创建节点权限，不能 fork' };
  if (!input.networkId) return { ok: false, reason: '没有当前网络，不能 fork' };
  const s = input.session;
  if (!s) return { ok: false, reason: '目录未知：没有选中的受管 source session，禁止提交' };
  if (!SESSION_RE.test(s.sessionId)) return { ok: false, reason: '选中的 session_id 非法（必须 ses_ 前缀）' };
  if (!NODE_RE.test(s.nodeId)) return { ok: false, reason: '选中的 source node 非法' };
  return { ok: true, reason: '可提交：受管 source 独立 fork' };
}

/**
 * Hub 拒绝 fork 时给人看的话。Hub（agent-network #3402 起）在核对完源节点权限后，
 * 409 会带 `reason`；旧 Hub 不带，就退回一句能让人行动的说明，而不是裸的「conflict」。
 */
export const SOURCE_FORK_REFUSAL_REASONS = [
  'daemon_offline', 'daemon_not_capable', 'hub_busy', 'evidence_unavailable', 'intent_reused',
] as const;
export type SourceForkRefusalReason = (typeof SOURCE_FORK_REFUSAL_REASONS)[number];

export function describeSourceForkRefusal(status: number, reason?: string | null): string {
  switch (reason) {
    case 'daemon_offline': return '管理这个节点的 daemon 离线。fork 需要它在线：请先在那台机器上启动 daemon，再重试。';
    case 'daemon_not_capable': return '管理这个节点的 daemon 版本不支持独立 fork，请升级 daemon 后重试。';
    case 'hub_busy': return 'Hub 当前正在处理的 fork 太多，请稍后重试。';
    case 'evidence_unavailable': return '暂时读不到源会话，请稍后重试；一直失败的话，检查源节点是否在线。';
    case 'intent_reused': return '这次 fork 已经用别的参数提交过。请关闭弹窗，重新发起一次。';
  }
  if (status === 401) return '登录已过期，请重新登录后再试。';
  if (status === 403) return '你没有 fork 这个节点的权限（需要对源节点有管理权限）。';
  if (status === 409) return '源节点当前无法 fork：可能没有被 daemon 管理、管理关系不唯一，或管理它的 daemon 离线。请检查节点的 daemon 状态后重试。';
  return `fork 失败（HTTP ${status}）`;
}

