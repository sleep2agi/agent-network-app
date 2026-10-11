import { appFetch } from './app-fetch';
import type { HubConfig } from './api';
import { loadProviderSnapshot, parseProviderRpc } from './daemon-provider-management';

export function providerWriteTransportAllowed(serverUrl: string): boolean {
  try { const u = new URL(serverUrl); return !u.username && !u.password &&
    (u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))); }
  catch { return false; }
}
async function providerFetch(url: string, init: RequestInit, containsKey: boolean): Promise<Response> {
  if (!containsKey) return appFetch(url, init);
  // The pooled desktop client predates per-request redirect policy. Use the
  // bundled native HTTP plugin with zero redirects for this secret-bearing POST.
  if ((globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    const { fetch } = await import('@tauri-apps/plugin-http');
    return fetch(url, { ...init, maxRedirections: 0 });
  }
  return globalThis.fetch(url, { ...init, redirect: 'error' });
}
export function readManagedProviders(cfg: HubConfig, daemonId: string, signal: AbortSignal,
  write?: { revision: number; provider: unknown }) {
  if (write && !providerWriteTransportAllowed(cfg.serverUrl)) return Promise.resolve({ kind: 'error' as const });
  return loadProviderSnapshot({ networkId: cfg.networkId ?? '', daemonId }, async (action, id, requestSignal) => {
    const response = await providerFetch(`${cfg.serverUrl.replace(/\/$/, '')}/mcp`, {
      method: 'POST', signal: requestSignal,
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-03-26' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
        name: 'daemon_provider_snapshot', arguments: { action: write && action === 'refresh' ? 'put' : action,
          id, network_id: cfg.networkId, ...(write && action === 'refresh' ? write : {}) },
      } }),
    }, !!write && action === 'refresh');
    return parseProviderRpc(response.status, response.ok ? await response.text() : '');
  }, signal);
}
