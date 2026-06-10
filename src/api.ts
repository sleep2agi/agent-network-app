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
  reply?: string;
  status?: string;
  created_at?: string;
}

export interface HubConfig {
  serverUrl: string; // e.g. https://hub.example.com
  token: string;
}

const headers = (cfg: HubConfig) => ({
  Authorization: `Bearer ${cfg.token}`,
  'Content-Type': 'application/json',
});

async function get<T>(cfg: HubConfig, path: string): Promise<T> {
  const res = await fetch(`${cfg.serverUrl}${path}`, { headers: headers(cfg) });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
  return res.json() as Promise<T>;
}

export const fetchStatus = (cfg: HubConfig) =>
  get<{ sessions: Session[] }>(cfg, '/api/status');

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

export const sendTask = async (cfg: HubConfig, to: string, content: string) => {
  const res = await fetch(`${cfg.serverUrl}/api/send_task`, {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify({ to_name: to, content }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} on /api/send_task`);
  return res.json();
};

/** Probe used by the login screen: token valid ⇔ /api/status readable. */
export const verifyConfig = async (cfg: HubConfig): Promise<boolean> => {
  try {
    await fetchStatus(cfg);
    return true;
  } catch {
    return false;
  }
};
