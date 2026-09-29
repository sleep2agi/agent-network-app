// 人与人私信的 Hub 调用(agent-network#2086)。
import { appFetch } from './app-fetch';
import type { HubConfig } from './api';
import type { DmMessage, DmThread, Human } from './human-dm';

const TIMEOUT_MS = 12_000;

async function call<T>(cfg: HubConfig, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await appFetch(`${cfg.serverUrl}${path}`, {
      method: init.method ?? 'GET',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* 下面按 HTTP 状态报 */ }
    if (!res.ok || data?.ok === false) throw new Error(String(data?.error ?? `HTTP ${res.status}`));
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

const q = (params: Record<string, string | number | undefined>) =>
  Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');

/** 旧 hub 没有 /humans(404)→ 空列表:人员区块就不出现,与升级前一样。 */
export const fetchHumans = (cfg: HubConfig, networkId: string): Promise<Human[]> =>
  call<{ humans: Human[] }>(cfg, `/api/networks/${encodeURIComponent(networkId)}/humans`).then(d => d.humans ?? []);

export const fetchDmThreads = (cfg: HubConfig, networkId: string): Promise<DmThread[]> =>
  call<{ threads: DmThread[] }>(cfg, `/api/dm/threads?${q({ network_id: networkId })}`).then(d => d.threads ?? []);

export const fetchDmMessages = (cfg: HubConfig, networkId: string, withUserId: string, before?: string, limit = 50): Promise<DmMessage[]> =>
  call<{ messages: DmMessage[] }>(cfg, `/api/dm?${q({ network_id: networkId, with: withUserId, limit, before })}`).then(d => d.messages ?? []);

export const sendDm = (cfg: HubConfig, body: unknown): Promise<{ message: DmMessage; delivered: boolean }> =>
  call<{ message: DmMessage; delivered: boolean }>(cfg, '/api/dm', { method: 'POST', body });
