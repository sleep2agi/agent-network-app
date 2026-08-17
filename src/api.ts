// Thin CommHub API client. The app talks to the same hub the dashboard
// proxies (status / tasks / messages); auth is the network token sent
// as a Bearer header. Server URL + token live in app state (Settings).

export interface Session {
  alias: string;
  status: string;
  agent?: string;
  task?: string;
  server?: string;
  updated_at?: string;
}

export interface HubTask {
  task_id?: string;
  from_name?: string;
  to_name?: string;
  content?: string;
  /** Agent replies live in `result` on the hub's task rows. */
  result?: string;
  reply?: string;
  status?: string;
  priority?: string;
  created_at?: string;
  updated_at?: string;
  delivered_at?: string;
  started_at?: string;
  completed_at?: string;
  expires_at?: string;
}

export interface HubConfig {
  serverUrl: string; // e.g. https://hub.example.com
  token: string;
  networkId?: string; // hub scopes sends by network (#220 round 18)
}

const headers = (cfg: HubConfig) => ({
  Authorization: `Bearer ${cfg.token}`,
  'Content-Type': 'application/json',
});

// RN's fetch has no timeout: on flaky mobile networks a request can hang
// forever and the UI spins with no way out (Vincent tg 841). Abort hard.
const TIMEOUT_MS = 12000;

const withTimeout = (run: (signal: AbortSignal) => Promise<Response>): Promise<Response> => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return run(ctrl.signal).finally(() => clearTimeout(timer));
};

// 连接状态横幅(通信龙 App战线①):共享读路径上每次请求结局都上报 connectivity——
// 成功=拿到并解析出数据;失败=网络错/超时/非2xx/解析错(数据没到,UI 是陈旧的)。
// 只挂在 get()(全部轮询读)上;写路径有各自显式失败 UI,不进此口径。
import { reportReadFailure, reportReadSuccess } from './connectivity';
import { classifyLoginFailure, type LoginFailureKind } from './login-flow';

async function get<T>(cfg: HubConfig, path: string): Promise<T> {
  try {
    const res = await withTimeout(signal =>
      fetch(`${cfg.serverUrl}${path}`, { headers: headers(cfg), signal }),
    );
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
    const data = (await res.json()) as T;
    reportReadSuccess();
    return data;
  } catch (e) {
    reportReadFailure();
    throw e;
  }
}

// `?light=1` (commhub-server ≥0.8.6) returns a narrow per-session
// projection — exactly the 6 fields the Session type uses, plus runtime +
// network_id. On a 150-agent network the response shrinks ~5x (e.g.
// 186 KB → 39 KB on a synthetic 160-row dataset), keeping cold open well
// inside the 12 s timeout on flaky cellular. Older hubs ignore the param
// and return the full payload, so the call is safe regardless of server
// version.
export const fetchStatus = (cfg: HubConfig) =>
  get<{ sessions: Session[] }>(cfg, '/api/status?light=1');

/** A registered node row (subset we consume). The hub's GET /api/nodes
 *  returns `{ ok, nodes, count }`; hub #462 added `avatar_url` to the
 *  projection (server.ts:2784) — nullable, `/avatars/<name>.(webp|png|svg)`
 *  or an absolute http(s) URL (avatar-validate.ts). */
export interface HubNode {
  node_id: string;
  alias: string;
  node_name?: string | null;
  avatar_url?: string | null;
}

/** GET /api/nodes — the registered-node list, used for avatar resolution.
 *  Two things matter to the avatar chain: (1) a node's `avatar_url` is the
 *  CROSS-DEVICE truth (sits above any local layer), (2) an alias *appearing
 *  here at all* means it is "node-backed" — hub is its whole avatar truth,
 *  including when avatar_url is null (cleared). Aliases NOT in this list are
 *  session-only. Network-scoped like the rest; older hubs without the column
 *  simply omit `avatar_url` (→ alias falls through to the pool), so it's safe
 *  regardless of server version. */
export const fetchHubNodes = (cfg: HubConfig): Promise<{ nodes: HubNode[] }> => {
  const q = cfg.networkId ? `?network_id=${encodeURIComponent(cfg.networkId)}` : '';
  return get<{ nodes: HubNode[] }>(cfg, `/api/nodes${q}`);
};

export type HubScheduleSpec =
  | { type: 'once'; run_at: string }
  | { type: 'interval'; every_seconds: number }
  | { type: 'daily'; time: string }
  | { type: 'weekly'; time: string; weekdays: number[] };

export type HubMisfirePolicy = 'catch_up_once' | 'skip';

export interface HubScheduledTask {
  schedule_id: string;
  network_id: string;
  name: string;
  target_node_id: string;
  target_alias: string;
  task_content: string;
  priority: 'high' | 'normal' | 'low';
  schedule: HubScheduleSpec;
  timezone: string;
  misfire_policy?: HubMisfirePolicy;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  next_run_at?: string | null;
  last_run_at?: string | null;
  revision: number;
}

export interface HubScheduledRun {
  run_id: string;
  schedule_id: string;
  scheduled_for: string;
  task_id?: string | null;
  status: string;
  error_code?: string | null;
  error_message?: string | null;
  created_at: string;
}

const networkQuery = (cfg: HubConfig) => cfg.networkId
  ? `?network_id=${encodeURIComponent(cfg.networkId)}`
  : '';

export const fetchScheduledTasks = (cfg: HubConfig) =>
  get<{ ok: true; schedules: HubScheduledTask[] }>(cfg, `/api/scheduled-tasks${networkQuery(cfg)}`);

export const fetchScheduledRuns = (cfg: HubConfig, scheduleId: string) => {
  const q = new URLSearchParams({ limit: '50' });
  if (cfg.networkId) q.set('network_id', cfg.networkId);
  return get<{ ok: true; runs: HubScheduledRun[] }>(cfg, `/api/scheduled-tasks/${encodeURIComponent(scheduleId)}/runs?${q}`);
};

async function scheduledWrite<T>(cfg: HubConfig, path: string, method: string, body?: unknown): Promise<T> {
  const res = await withTimeout(signal => fetch(`${cfg.serverUrl}${path}`, {
    method,
    headers: headers(cfg),
    signal,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new ScheduledTaskError(data?.message || data?.error || `HTTP ${res.status}`, res.status, data?.error);
  }
  return data as T;
}

export class ScheduledTaskError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'ScheduledTaskError';
  }
}

export type ScheduledTaskMutationInput = {
  name: string;
  target_node_id: string;
  task: string;
  priority: 'high' | 'normal' | 'low';
  timezone: string;
  schedule: HubScheduleSpec;
  misfire_policy: HubMisfirePolicy;
};

export const createScheduledTask = (
  cfg: HubConfig,
  input: ScheduledTaskMutationInput,
) => scheduledWrite<{ ok: true; schedule: HubScheduledTask }>(cfg, '/api/scheduled-tasks', 'POST', { ...input, network_id: cfg.networkId });

export const updateScheduledTask = (cfg: HubConfig, row: HubScheduledTask, input: ScheduledTaskMutationInput) =>
  scheduledWrite<{ ok: true; schedule: HubScheduledTask }>(
    cfg,
    `/api/scheduled-tasks/${encodeURIComponent(row.schedule_id)}${networkQuery(cfg)}`,
    'PATCH',
    { revision: row.revision, ...input },
  );

export const setScheduledTaskStatus = (cfg: HubConfig, row: HubScheduledTask, status: 'active' | 'paused') =>
  scheduledWrite<{ ok: true; schedule: HubScheduledTask }>(cfg, `/api/scheduled-tasks/${encodeURIComponent(row.schedule_id)}${networkQuery(cfg)}`, 'PATCH', { revision: row.revision, status });

export const runScheduledTaskNow = (cfg: HubConfig, scheduleId: string) =>
  scheduledWrite<{ ok: true; taskId?: string; status: string }>(cfg, `/api/scheduled-tasks/${encodeURIComponent(scheduleId)}/run-now${networkQuery(cfg)}`, 'POST', {});

export const cancelScheduledTask = (cfg: HubConfig, scheduleId: string) =>
  scheduledWrite<{ ok: true; status: string }>(cfg, `/api/scheduled-tasks/${encodeURIComponent(scheduleId)}${networkQuery(cfg)}`, 'DELETE');

// ── 节点外部计划（RFC-036）。节点把本机 crontab/systemd 等计划的快照上报到
// Hub（#684，只有元数据，绝无命令/路径），owner 通过「编辑意向」改 enabled 或
// 五段 cron 时间（#688）；节点侧领取意向后自行落地并回执。

export interface HubExternalSchedule {
  id: string;
  name: string;
  kind: 'cron' | 'systemd' | 'tmux' | 'playwright' | 'custom';
  frequency: string;
  last_run_at: string | null;
  last_status: 'success' | 'failed' | 'running' | 'unknown';
  last_error: string | null;
  next_run_at: string | null;
  log_ref: string | null;
  enabled: boolean;
  /** RFC-036: 只有 agent-node 托管的 cron 条目带 editable+revision，其余只读。 */
  editable?: boolean;
  revision?: number;
}

export interface HubNodeExternalSchedules {
  node_id: string;
  alias: string;
  observed_at: string;
  error?: string;
  schedules: HubExternalSchedule[];
}

/** 汇总各节点上报的外部计划快照。走全量 /api/status —— light=1 会剥掉
 *  external_schedules 字段，这里绝不能带 light。同一 node_id 若有多条会话，
 *  取 updated_at 最新且带快照的那条（与 Hub 端 reportedSchedule 同准则）。 */
export const fetchExternalSchedules = async (cfg: HubConfig): Promise<HubNodeExternalSchedules[]> => {
  const data = await get<{ sessions: Array<{
    alias?: string;
    node_id?: string | null;
    updated_at?: string | null;
    external_schedules?: { observed_at?: string; schedules?: HubExternalSchedule[]; error?: string } | null;
  }> }>(cfg, `/api/status${networkQuery(cfg)}`);
  const byNode = new Map<string, { updatedAt: number; row: HubNodeExternalSchedules }>();
  for (const s of data.sessions || []) {
    if (!s.node_id || !s.external_schedules || !Array.isArray(s.external_schedules.schedules)) continue;
    const updatedAt = s.updated_at ? Date.parse(s.updated_at) || 0 : 0;
    const seen = byNode.get(s.node_id);
    if (seen && seen.updatedAt >= updatedAt) continue;
    byNode.set(s.node_id, { updatedAt, row: {
      node_id: s.node_id,
      alias: s.alias || s.node_id,
      observed_at: s.external_schedules.observed_at || '',
      ...(s.external_schedules.error ? { error: s.external_schedules.error } : {}),
      schedules: s.external_schedules.schedules,
    } });
  }
  return [...byNode.values()].map(v => v.row).sort((a, b) => a.alias.localeCompare(b.alias));
};

export interface HubExternalScheduleEditIntent {
  intent_id: string;
  node_id: string;
  schedule_id: string;
  base_revision: number;
  patch: { enabled?: boolean; cron?: string };
  status: 'pending' | 'delivered' | 'applied' | 'rejected' | 'expired';
  expires_at: string;
  created_at: string;
  delivered_at: string | null;
  acked_at: string | null;
  result_revision: number | null;
  error_code: string | null;
}

/** owner 视角的意向记录（最近 100 条，仅本人创建的）。 */
export const fetchExternalScheduleEdits = (cfg: HubConfig, nodeId: string) =>
  get<{ ok: true; edits: HubExternalScheduleEditIntent[] }>(cfg, `/api/nodes/${encodeURIComponent(nodeId)}/external-schedule-edits${networkQuery(cfg)}`);

/** 从意向记录里选出每个计划「仍在途」的那条：delivered（节点已领取、等回执）
 *  恒为在途；pending 只有未过 TTL（expires_at > now）才算——Hub 侧
 *  expireOpenIntents 会把过期 pending 收尾，这里镜像同一判定，别把死意向
 *  当在途去锁按钮。同计划多条取 created_at 最新。键：`${node_id}:${schedule_id}`。 */
export const selectOpenIntents = (
  edits: HubExternalScheduleEditIntent[],
  now: number,
): Record<string, HubExternalScheduleEditIntent> => {
  const open: Record<string, HubExternalScheduleEditIntent> = {};
  for (const edit of edits) {
    const inFlight = edit.status === 'delivered'
      || (edit.status === 'pending' && Date.parse(edit.expires_at) > now);
    if (!inFlight) continue;
    const key = `${edit.node_id}:${edit.schedule_id}`;
    if (!open[key] || Date.parse(edit.created_at) > Date.parse(open[key].created_at)) open[key] = edit;
  }
  return open;
};

/** 发起编辑意向。Hub 端 exactKeys 只收这四个键；network_id 必须等于节点归属网络
 *  （requireOwner 校验），patch 只允许 enabled / 五段 cron。冲突语义：
 *  revision_conflict / schedule_read_only / edit_in_flight / node_owner_changed
 *  都走 409，由 ScheduledTaskError.code 透出。 */
export const createExternalScheduleEdit = (
  cfg: HubConfig,
  nodeId: string,
  input: { schedule_id: string; base_revision: number; patch: { enabled?: boolean; cron?: string } },
) => scheduledWrite<{ ok: true; intent: HubExternalScheduleEditIntent }>(
  cfg,
  `/api/nodes/${encodeURIComponent(nodeId)}/external-schedule-edits`,
  'POST',
  { network_id: cfg.networkId, schedule_id: input.schedule_id, base_revision: input.base_revision, patch: input.patch },
);

export type PutAvatarResult =
  | { ok: true; avatar_url: string | null }
  | { ok: false; error: string; reason?: string; status?: number };

/** PUT /api/nodes/:ref/avatar — set (or clear with null) a node's cross-device
 *  `avatar_url`. ref = alias (the hub resolves node_id/node_name/alias). The hub
 *  validates the URL shape (#550: absolute http(s) or /avatars/<name>.(webp|png|svg))
 *  — on reject it returns 400 {ok:false, reason}. Session-only aliases (no nodes
 *  row) return 404; callers should disable the control BEFORE the user tries. */
export const putNodeAvatar = async (
  cfg: HubConfig,
  ref: string,
  avatarUrl: string | null,
): Promise<PutAvatarResult> => {
  try {
    const res = await withTimeout(signal =>
      fetch(`${cfg.serverUrl}/api/nodes/${encodeURIComponent(ref)}/avatar`, {
        method: 'PUT',
        headers: headers(cfg),
        signal,
        body: JSON.stringify({ avatar_url: avatarUrl }),
      }),
    );
    const body = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || body?.ok === false) {
      return { ok: false, error: body?.error || `HTTP ${res.status}`, reason: body?.reason, status: res.status };
    }
    return { ok: true, avatar_url: (body?.avatar_url ?? avatarUrl) as string | null };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || '网络错误' };
  }
};

// Boot-time prefetch (perf: load time). App boot fires the status request the
// instant the saved session is restored — before AgentsScreen mounts — so the
// network round-trip overlaps React mount/navigation instead of starting after
// it. AgentsScreen's first load consumes this in-flight promise; everything
// else (polls, other screens) ignores it. Consume-once + an 8s freshness gate
// keep it from ever serving a stale promise to a later, unrelated load.
let _statusPrefetch: { cfg: HubConfig; promise: Promise<{ sessions: Session[] }>; at: number } | null = null;

export const prefetchStatus = (cfg: HubConfig): void => {
  const promise = fetchStatus(cfg);
  // Suppress unhandled-rejection if the prefetch is never consumed; the real
  // consumer still awaits `promise` and sees any rejection for its own catch.
  promise.catch(() => {});
  _statusPrefetch = { cfg, promise, at: Date.now() };
};

export const takeStatusPrefetch = (cfg: HubConfig): Promise<{ sessions: Session[] }> | null => {
  const p = _statusPrefetch;
  if (p && p.cfg.serverUrl === cfg.serverUrl && p.cfg.token === cfg.token && Date.now() - p.at < 8000) {
    _statusPrefetch = null; // consume once
    return p.promise;
  }
  return null;
};

export const fetchTasks = (
  cfg: HubConfig,
  params: { to_name?: string; from_name?: string; limit?: number },
) => {
  const q = new URLSearchParams();
  if (params.to_name) q.set('to_name', params.to_name);
  if (params.from_name) q.set('from_name', params.from_name);
  q.set('limit', String(params.limit ?? 20));
  return get<{ tasks: HubTask[] }>(cfg, `/api/tasks?${q}`);
};

// Detail fetch by task_id — hub supports `?task_id=<id>` as a filter on
// the /api/tasks endpoint (verified against dashboard's proxy at
// app/api/hub/tasks/route.ts, which accepts task_id and forwards it).
// Returns the single task or null; distinct from "network error" (which
// throws) so callers can render "not found" vs "temporary failure".
export const fetchTaskDetail = async (
  cfg: HubConfig,
  taskId: string,
): Promise<HubTask | null> => {
  const q = new URLSearchParams({ task_id: taskId, limit: '1' });
  const data = await get<{ tasks: HubTask[] }>(cfg, `/api/tasks?${q}`);
  return data.tasks?.[0] ?? null;
};

// Task events feed — status transitions logged by the hub.
//
// 🔴 Path naming warning: on the hub itself this endpoint is
// `/api/task_events` (UNDERSCORE). The dashboard's proxy at
// `/api/hub/task-events` (HYPHEN) is a naming choice of the dashboard,
// NOT the hub. Copy-pasting the dashboard path to hit hub directly will
// 404. Since the third-state banner below fires on 404, a mis-typed
// path here would silently produce "hub 未暴露 task_events" for
// everyone — the runtime evidence and the real cause would look the
// same. Keep the underscore.
export interface HubTaskEvent {
  id?: number;
  event_type?: string;
  from_status?: string;
  to_status?: string;
  detail?: string;
  created_at?: string;
}
export type FetchTaskEventsResult =
  | { ok: true; events: HubTaskEvent[]; count: number }
  | { ok: false; unconfirmed: true; error: string }   // 404 / 501 / non-JSON → hub 未暴露 or 需升级
  | { ok: false; unconfirmed: false; error: string }; // 网络 / 其它错误

const TASK_EVENTS_NEEDS_UPGRADE =
  '当前 hub 未暴露 /api/task_events，events feed 不可用（需 hub 升级或缺少该 endpoint）';

export const fetchTaskEvents = async (
  cfg: HubConfig,
  taskId: string,
  limit = 50,
): Promise<FetchTaskEventsResult> => {
  try {
    const q = new URLSearchParams({ task_id: taskId, limit: String(limit) });
    if (cfg.networkId) q.set('network_id', cfg.networkId);
    const res = await withTimeout(signal =>
      // NB: hub path uses underscore — see comment above.
      fetch(`${cfg.serverUrl}/api/task_events?${q}`, { headers: headers(cfg), signal }),
    );
    if (res.status === 404 || res.status === 501) {
      return { ok: false, unconfirmed: true, error: TASK_EVENTS_NEEDS_UPGRADE };
    }
    if (!res.ok) {
      return { ok: false, unconfirmed: false, error: `HTTP ${res.status}` };
    }
    // Pre-support hubs may serve a non-JSON help banner on unknown paths
    // (same pattern as fetchHostSupervisors). Guard the content-type so
    // "wrong hub version" doesn't slide into an "empty events" green.
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      return { ok: false, unconfirmed: true, error: TASK_EVENTS_NEEDS_UPGRADE };
    }
    const data = (await res.json().catch(() => null)) as
      { ok?: boolean; events?: HubTaskEvent[]; count?: number; error?: string } | null;
    if (!data || (data.ok === undefined && data.events === undefined)) {
      return { ok: false, unconfirmed: true, error: TASK_EVENTS_NEEDS_UPGRADE };
    }
    if (data.ok === false) {
      return { ok: false, unconfirmed: false, error: data.error || 'hub returned ok:false' };
    }
    const events = Array.isArray(data.events) ? data.events : [];
    const count = typeof data.count === 'number' ? data.count : events.length;
    return { ok: true, events, count };
  } catch (e: unknown) {
    return { ok: false, unconfirmed: false, error: e instanceof Error ? e.message : String(e) };
  }
};

export interface HubMessage {
  id: string;
  from_alias?: string;
  to_alias?: string;
  type?: string;
  priority?: string;
  content?: string;
  created_at?: string;
}

export const fetchMessages = (cfg: HubConfig, limit: number) =>
  get<{ messages: HubMessage[] }>(cfg, `/api/messages?limit=${limit}`);

/** The hub's REST send endpoint is POST /api/task with {alias, task} —
 *  /api/send_task does not exist (it 404s into the server help text).
 *  Sends are network-scoped: utok users must pass an explicit network_id. */
export const fetchNetworkId = async (cfg: HubConfig): Promise<string | undefined> => {
  try {
    const res = await withTimeout(signal =>
      fetch(`${cfg.serverUrl}/api/auth/me`, { headers: headers(cfg), signal }),
    );
    const d = await res.json();
    const cur = d?.current_network;
    return (
      (typeof cur === 'string' ? cur : cur?.network_id) ?? d?.networks?.[0]?.network_id
    );
  } catch {
    return undefined;
  }
};

export interface TaskAttachment {
  type: 'file';
  file_id: string;
  name?: string;
  mime?: string;
  size?: number;
}

export const sendTask = async (
  cfg: HubConfig,
  to: string,
  content: string,
  attachments?: TaskAttachment[],
) => {
  const networkId = cfg.networkId ?? (await fetchNetworkId(cfg));
  const res = await withTimeout(signal =>
    fetch(`${cfg.serverUrl}/api/task`, {
      method: 'POST',
      headers: headers(cfg),
      signal,
      body: JSON.stringify({
        alias: to,
        task: content,
        network_id: networkId,
        ...(attachments?.length ? { attachments } : {}),
      }),
    }),
  );
  if (!res.ok) throw new Error(`HTTP ${res.status} on /api/task`);
  const data = await res.json();
  if (!data?.ok) throw new Error(String(data?.error ?? 'send failed'));
  return data;
};

/** The hub's root/help route is plain text starting with
 *  "CommHub MCP Server vX.Y.Z …" — scrape the version for the Server tab.
 *  Returns undefined if unreachable or the banner isn't present. */
// #338 RFC-026 §9.2.1 — list host_supervisor daemon nodes the caller can
// dispatch create_node to. Hub side landed in commhub-server preview.8
// (PR #341 MCP + PR #343 audit) — earlier hubs return 501/404 and we
// surface the "needs upgrade" state honestly — never a fake empty list
// (an empty daemons array on an unsupported hub is indistinguishable
// from a supported hub that genuinely has no daemons yet; the third
// state must be visible to callers).
export interface HostSupervisorDaemon {
  daemon_node_id: string;
  alias: string;
  hostname?: string | null;
  online?: boolean;
  last_seen_at?: string | null;
  runtimes_supported?: string[];
  allowed_secret_keys?: string[];
  host_telemetry?: {
    alert_level?: 'green' | 'yellow' | 'red' | 'gray';
    cpu_cores?: number | null;
    mem_gb?: number | null;
    ip_internal?: string | null;
  };
}
export type HostSupervisorListResult =
  | { ok: true; count: number; daemons: HostSupervisorDaemon[] }
  | { ok: false; unconfirmed: true; error: string }   // hub < preview.8
  | { ok: false; unconfirmed: false; error: string }; // other failure

export const fetchHostSupervisors = async (cfg: HubConfig): Promise<HostSupervisorListResult> => {
  const qs = cfg.networkId ? `?network_id=${encodeURIComponent(cfg.networkId)}` : '';
  const NEEDS_UPGRADE = '当前 hub 未包含 /api/host-supervisors API，需升级到 commhub-server@0.9.0-preview.8 以上';
  try {
    const res = await withTimeout(signal =>
      fetch(`${cfg.serverUrl}/api/host-supervisors${qs}`, { headers: headers(cfg), signal }),
    );
    if (res.status === 404 || res.status === 501) {
      return { ok: false, unconfirmed: true, error: NEEDS_UPGRADE };
    }
    if (!res.ok) {
      return { ok: false, unconfirmed: false, error: `HTTP ${res.status}` };
    }
    // ⚠️ Pre-preview.8 hubs serve a plain-text help banner on unknown paths
    // at HTTP 200 instead of 404 (proven via real curl against preview.7).
    // A naive `data?.daemons ?? []` slides those into the onboarding state,
    // silently misreporting "no daemons yet" when the truth is "wrong hub
    // version". Detect by content-type OR by absence of any contract field.
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      return { ok: false, unconfirmed: true, error: NEEDS_UPGRADE };
    }
    const data = (await res.json().catch(() => null)) as
      { ok?: boolean; count?: number; daemons?: HostSupervisorDaemon[]; error?: string } | null;
    if (!data) {
      return { ok: false, unconfirmed: true, error: NEEDS_UPGRADE };
    }
    // Endpoint shape sanity: a real /api/host-supervisors response always
    // carries either `ok` or `daemons` or `count`. Absence of all three
    // means we hit a different handler (older hub catch-all returning
    // JSON help, or a proxy front-page). Never silently fake "no
    // daemons" from a non-conforming response — surface the upgrade
    // hint so the caller can tell "empty for the right reason" apart
    // from "wrong hub answered".
    if (data.ok === undefined && data.daemons === undefined && data.count === undefined) {
      return { ok: false, unconfirmed: true, error: NEEDS_UPGRADE };
    }
    if (data.ok === false) {
      return { ok: false, unconfirmed: false, error: data?.error || 'hub returned ok:false' };
    }
    const daemons = Array.isArray(data?.daemons) ? data.daemons : [];
    const count = typeof data?.count === 'number' ? data.count : daemons.length;
    return { ok: true, count, daemons };
  } catch (e: unknown) {
    return { ok: false, unconfirmed: false, error: e instanceof Error ? e.message : String(e) };
  }
};

// #338 RFC-026 §3.1 — create_node via MCP JSON-RPC. Hub exposes
// create_node only as an MCP tool at POST /mcp (no REST mirror in
// preview.8). We send a single stateless tools/call envelope without
// a prior `initialize` handshake — the hub treats tool calls as session-
// scoped per token but accepts unsequenced calls (matches dashboard's
// callMcp pattern in app/lib/hub-mcp.ts).
//
// Response body comes back as application/json OR text/event-stream; the
// tool payload itself lives at envelope.result.content[0].text as a JSON
// string. A `ok:true` from the tool means "hub accepted the RPC", not
// "the child agent is running" — so callers must poll fetchStatus
// afterwards to confirm the child registered before reporting success
// to the user.
export interface CreateNodeRequest {
  daemon_node_id: string;
  network_id?: string;
  node_spec: {
    name: string;
    runtime: string;
    model?: string;
    flags?: Record<string, unknown>;
  };
}
export type CreateNodeResult =
  | { ok: true; request_id?: string; result?: unknown }
  | { ok: false; unconfirmed?: true; error: string };

const NEEDS_UPGRADE_HINT = '当前 hub 不响应 create_node MCP 工具，需升级到 commhub-server@0.9.0-preview.8 以上';

// Discriminated parse result so createNode can distinguish:
//   - business errors (hub returned ok:false OR JSON-RPC error: tool
//     rejected the args, schema invalid, validation failed) → real
//     create_node failure to surface as-is to the user
//   - version / transport errors (no valid envelope at all, SSE
//     unparseable, missing result.content.text) → "needs upgrade hub"
//
// Mapping ANY parse error to "needs upgrade" (the bug 通信龙 caught) is
// misleading: it tells a user with bad inputs that their server is broken.
type ParsedMcp =
  | { kind: 'payload'; payload: unknown }
  | { kind: 'jsonRpcError'; message: string }
  | { kind: 'malformed'; message: string };

function parseMcpToolResponse(rawText: string): ParsedMcp {
  let envelope: unknown;
  try {
    envelope = JSON.parse(rawText);
  } catch {
    // SSE path: find the last `data:` line and parse it.
    const dataLines = rawText
      .split('\n')
      .filter(l => l.startsWith('data:'))
      .map(l => l.slice(5).trim())
      .filter(Boolean);
    const last = dataLines[dataLines.length - 1];
    if (!last) return { kind: 'malformed', message: 'empty MCP response' };
    try {
      envelope = JSON.parse(last);
    } catch {
      return { kind: 'malformed', message: 'MCP response not parseable as JSON or SSE' };
    }
  }
  const env = envelope as {
    error?: { message?: string };
    result?: { content?: Array<{ text?: string }>; isError?: boolean };
  };
  // JSON-RPC envelope-level error = business error from hub
  // (auth_failed, tool_not_found, validation, etc.) — surface it.
  if (env.error) {
    return { kind: 'jsonRpcError', message: env.error.message || 'MCP error' };
  }
  const text = env.result?.content?.[0]?.text;
  if (typeof text !== 'string') {
    // No result.content.text usually means the response shape doesn't
    // match the tool contract — either the tool is missing or the
    // server is on an older protocol. This IS a version concern.
    return { kind: 'malformed', message: 'MCP result missing content.text' };
  }
  // result.isError=true is the MCP convention for tool-level errors
  // delivered in result.content[0].text as plain text (NOT JSON). We
  // saw this with create_node's "MCP error -32602: Input validation
  // error: ..." message when schema fields are missing. Treat as
  // jsonRpcError so createNode surfaces the raw message instead of
  // wrongly mapping the unparseable text body to ok:true.
  if (env.result?.isError === true) {
    return { kind: 'jsonRpcError', message: text };
  }
  // Tool replies typically encode their payload as a JSON string in
  // result.content[0].text. If that fails to parse, the payload is
  // a free-form string the tool wanted to return — treat as ok with
  // text so callers can still surface something.
  try {
    return { kind: 'payload', payload: JSON.parse(text) };
  } catch {
    return { kind: 'payload', payload: { ok: true, text } };
  }
}

export const createNode = async (cfg: HubConfig, req: CreateNodeRequest): Promise<CreateNodeResult> => {
  const networkId = req.network_id ?? cfg.networkId ?? (await fetchNetworkId(cfg));
  try {
    const args = {
      daemon_node_id: req.daemon_node_id,
      ...(networkId ? { network_id: networkId } : {}),
      node_spec: req.node_spec,
    };
    const envelope = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'create_node', arguments: args },
    };
    const res = await withTimeout(signal =>
      fetch(`${cfg.serverUrl}/mcp`, {
        method: 'POST',
        headers: {
          ...headers(cfg),
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2025-03-26',
        },
        signal,
        body: JSON.stringify(envelope),
      }),
    );
    if (res.status === 404 || res.status === 501) {
      return { ok: false, unconfirmed: true, error: NEEDS_UPGRADE_HINT };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      try {
        const j = JSON.parse(text) as { error?: string | { message?: string } };
        const err = typeof j?.error === 'string' ? j.error : j?.error?.message;
        return { ok: false, error: err || `HTTP ${res.status}` };
      } catch {
        return { ok: false, error: `HTTP ${res.status}` };
      }
    }
    const raw = await res.text();
    const parsed = parseMcpToolResponse(raw);
    if (parsed.kind === 'malformed') {
      // No valid JSON-RPC envelope OR missing result.content.text — this
      // is the real "wrong hub version" case.
      return { ok: false, unconfirmed: true, error: NEEDS_UPGRADE_HINT };
    }
    if (parsed.kind === 'jsonRpcError') {
      // Hub answered with a JSON-RPC error envelope. This is a business
      // error (validation rejected, tool not allowed, etc.) — surface it
      // raw rather than misclassifying as a version mismatch.
      return { ok: false, error: parsed.message };
    }
    // payload kind
    const payload = parsed.payload as { ok?: boolean; error?: string; request_id?: string; result?: unknown } | null;
    if (!payload) return { ok: false, error: 'empty hub response' };
    if (payload.ok === false) {
      // Tool returned ok:false in its content payload — also business.
      return { ok: false, error: payload.error || 'create_node failed' };
    }
    return { ok: true, request_id: payload.request_id, result: payload.result ?? payload };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
};

export const fetchServerVersion = async (cfg: HubConfig): Promise<string | undefined> => {
  try {
    const res = await withTimeout(signal =>
      fetch(`${cfg.serverUrl}/api/version`, { headers: headers(cfg), signal }),
    );
    const text = await res.text();
    const m = text.match(/CommHub MCP Server v([^\s]+)/i);
    return m?.[1];
  } catch {
    return undefined;
  }
};

/** Username/password login → token (Vincent tg 679: 不需要填 TOKEN).
 *  POST /api/auth/login {username,password} → {ok, token, error?}. */
export const login = async (
  serverUrl: string,
  username: string,
  password: string,
): Promise<{ ok: true; cfg: HubConfig } | { ok: false; error: string; kind: LoginFailureKind }> => {
  try {
    const res = await withTimeout(signal =>
      fetch(`${serverUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({ username, password }),
      }),
    );
    // Vincent hit this against a half-open port: connection succeeds but
    // the body is empty, and res.json() throws a cryptic JSON parse
    // error. Read text first so we can say what actually went wrong.
    const text = await res.text();
    if (!text.trim()) {
      // review-fix(通信龙 #34):响应形状不对=不是 hub → server-error,与 HTTP 状态码无关
      // (401+空体的常见真身是 basic-auth nginx——判 bad-credentials 会诱导用户反复重打密码)。
      return { ok: false, kind: 'server-error', error: '服务器无响应内容 — 检查地址和端口（hub 默认 9999）' };
    }
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      // 同上:非 JSON 体(HTML 401 页等)= 不是 hub → server-error(kind 必须与本行文案同向)。
      return { ok: false, kind: 'server-error', error: `服务器返回了非 JSON 内容（HTTP ${res.status}）— 确认地址指向 hub` };
    }
    if (!data?.ok) return { ok: false, kind: classifyLoginFailure(false, res.status), error: String(data?.error ?? `HTTP ${res.status}`) };
    const token = data.token ?? data.user_token ?? data.access_token;
    if (!token) return { ok: false, kind: 'server-error', error: 'login ok but no token in response' };
    const networkId = await fetchNetworkId({ serverUrl, token });
    return { ok: true, cfg: { serverUrl, token, networkId } };
  } catch (e) {
    // fetch 抛了 = 压根没拿到 HTTP 响应(连接拒绝/DNS/超时)→ unreachable。
    return { ok: false, kind: classifyLoginFailure(true, null), error: e instanceof Error ? e.message : 'network error' };
  }
};
