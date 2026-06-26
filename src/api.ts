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
