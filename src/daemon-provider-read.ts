// #906 —— 读 Hub 的 list_providers。失败原因用固定枚举,不把响应体写进日志或返回值。
import { appFetch } from './app-fetch';
import type { HubConfig } from './api';
import { interpretListProvidersHttp, type TaggedProvider } from './daemon-runtime-providers';

const TIMEOUT_MS = 12_000;

export type ListProvidersRead =
  | { kind: 'ok'; rows: TaggedProvider[] }
  | { kind: 'unsupported' }
  | { kind: 'error' };

export async function readListProviders(cfg: Pick<HubConfig, 'serverUrl' | 'token' | 'networkId'>): Promise<ListProvidersRead> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await appFetch(`${cfg.serverUrl.replace(/\/$/, '')}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-03-26',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'list_providers',
          arguments: cfg.networkId ? { network_id: cfg.networkId } : {},
        },
      }),
      signal: ctrl.signal,
    });
    const body = res.ok ? await res.text() : '';
    return interpretListProvidersHttp(res.status, body);
  } catch {
    return { kind: 'error' };
  } finally {
    clearTimeout(timer);
  }
}
