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
  created_at?: string;
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

async function get<T>(cfg: HubConfig, path: string): Promise<T> {
  const res = await withTimeout(signal =>
    fetch(`${cfg.serverUrl}${path}`, { headers: headers(cfg), signal }),
  );
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
  return res.json() as Promise<T>;
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
// surface the "needs upgrade" state honestly per
// [[feedback_doc_capability_claim_verify_code_path]] — never a fake
// empty list.
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
    // JSON help, or a proxy front-page). Per
    // [[feedback_doc_capability_claim_verify_code_path]] never silently
    // fake "no daemons" — surface upgrade hint.
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
// string. claim=reality per [[feedback_doc_capability_claim_verify_code_path]]
// — caller polls fetchStatus afterwards to confirm the child registered;
// we never report "succeeded" from this call alone.
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

function parseMcpToolResponse(rawText: string): unknown {
  // Hub may answer in plain JSON or SSE-encoded JSON-RPC. Mirror the
  // dashboard's parseMcpEnvelope shape but inline for the mobile app
  // (no extra dep, single call site).
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
    if (!last) throw new Error('empty MCP response');
    envelope = JSON.parse(last);
  }
  const env = envelope as {
    error?: { message?: string };
    result?: { content?: Array<{ text?: string }> };
  };
  if (env.error) throw new Error(env.error.message || 'MCP error');
  const text = env.result?.content?.[0]?.text;
  if (typeof text !== 'string') throw new Error('MCP result missing content.text');
  try {
    return JSON.parse(text);
  } catch {
    return { ok: true, text };
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
    let payload: { ok?: boolean; error?: string; request_id?: string } & Record<string, unknown>;
    try {
      payload = parseMcpToolResponse(raw) as typeof payload;
    } catch (e: unknown) {
      // Most likely older hub returning text help banner / no MCP tool.
      return { ok: false, unconfirmed: true, error: NEEDS_UPGRADE_HINT };
    }
    if (payload?.ok === false) {
      return { ok: false, error: payload?.error || 'create_node failed' };
    }
    return { ok: true, request_id: payload?.request_id, result: payload };
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
): Promise<{ ok: true; cfg: HubConfig } | { ok: false; error: string }> => {
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
      return { ok: false, error: '服务器无响应内容 — 检查地址和端口（hub 默认 9999）' };
    }
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, error: `服务器返回了非 JSON 内容（HTTP ${res.status}）— 确认地址指向 hub` };
    }
    if (!data?.ok) return { ok: false, error: String(data?.error ?? `HTTP ${res.status}`) };
    const token = data.token ?? data.user_token ?? data.access_token;
    if (!token) return { ok: false, error: 'login ok but no token in response' };
    const networkId = await fetchNetworkId({ serverUrl, token });
    return { ok: true, cfg: { serverUrl, token, networkId } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network error' };
  }
};
