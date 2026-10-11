import type { HubConfig } from './api';
import { parseProviderRpc, loadProviderSnapshot } from './daemon-provider-management';
import { providerFetch, providerWriteTransportAllowed, readManagedProviders } from './daemon-provider-management-api';
import { hubProviderInput, parseHubProvider, parseHubProviderCatalog, type HubProvider, type HubProviderForm } from './hub-provider-management';
async function rpc(cfg: HubConfig, name: string, args: Record<string, unknown>, signal: AbortSignal, secret = false) {
  if (secret && !providerWriteTransportAllowed(cfg.serverUrl)) return { kind: 'error' as const };
  const ctrl = new AbortController();
  const cancel = () => ctrl.abort();
  signal.addEventListener('abort', cancel, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stopped = new Promise<never>((_, reject) => {
    ctrl.signal.addEventListener('abort', () => reject(new Error('unconfirmed')), { once: true });
    timer = setTimeout(cancel, 20_000);
    if (signal.aborted) cancel();
  });
  try { return await Promise.race([stopped, (async () => {
  const response = await providerFetch(`${cfg.serverUrl.replace(/\/$/, '')}/mcp`, {
    method: 'POST', signal: ctrl.signal, headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-03-26' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { ...args, network_id: cfg.networkId } } }),
  }, secret);
  return parseProviderRpc(response.status, response.ok ? await response.text() : '');
  })()]); } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); ctrl.abort(); }
}
export async function readHubProviderCatalog(cfg: HubConfig, signal: AbortSignal) {
  try {
    const result = await rpc(cfg, 'daemon_provider_snapshot', { action: 'hub_read', id: 'hub' }, signal);
    if (result.kind !== 'payload') return null;
    return parseHubProviderCatalog(result.value, cfg.networkId ?? '');
  } catch { return null; }
}
export async function saveHubProviderConfig(cfg: HubConfig, form: HubProviderForm, signal: AbortSignal) {
  const input = hubProviderInput(form); if (!input || !providerWriteTransportAllowed(cfg.serverUrl)) return null;
  try {
    const result = await rpc(cfg, 'daemon_provider_snapshot', { action: 'hub_put', id: input.id, revision: form.revision, provider: input }, signal, true);
    if (result.kind !== 'payload' || result.value.network_id !== cfg.networkId) return null;
    const saved = parseHubProvider(result.value.provider);
    if (!saved || saved.id !== input.id || saved.revision !== form.revision + 1 || saved.label !== input.label
      || saved.protocol !== input.protocol || saved.baseUrl !== input.baseUrl || saved.enabled !== input.enabled
      || !saved.credential_present || JSON.stringify(saved.models) !== JSON.stringify(input.models)) return null;
    return saved;
  } catch { return null; }
}
/** Separate per-daemon receipts; a Hub save or queued request is not synchronization. */
export async function bindHubProviderConfig(cfg: HubConfig, provider: HubProvider, daemonId: string, signal: AbortSignal) {
  if (!provider.enabled || !provider.credential_present || provider.protocol !== 'openai-responses' || !providerWriteTransportAllowed(cfg.serverUrl)) return false;
  const before = await readManagedProviders(cfg, daemonId, signal); if (before.kind !== 'ready') return false;
  let expectedId = '';
  const result = await loadProviderSnapshot({ networkId: cfg.networkId ?? '', daemonId }, async (action, id, requestSignal) => {
    const result = await rpc(cfg, 'daemon_provider_snapshot', action === 'refresh'
      ? { action: 'hub_bind', id: provider.id, revision: provider.revision, provider: { daemon_node_id: daemonId, daemon_revision: before.snapshot.revision, confirm: true } }
      : { action: 'read', id }, requestSignal);
    if (action === 'refresh' && result.kind === 'payload') {
      const ref = result.value.provider_reference;
      if (result.value.daemon_node_id !== daemonId || ref?.network_id !== cfg.networkId || ref?.id !== provider.id || ref?.revision !== provider.revision
        || !/^hub_[a-f0-9]{24}$/.test(ref?.daemon_provider_id ?? '')) return { kind: 'error' };
      expectedId = ref.daemon_provider_id;
    }
    return result;
  }, signal);
  if (result.kind !== 'ready' || result.snapshot.revision !== before.snapshot.revision + 1) return false;
  const saved = result.snapshot.providers.find(p => p.id === expectedId);
  const auth = saved?.runtimes.find(r => r.runtime === 'codex-tui')?.auth.find(a => a.id === 'hub_key');
  return !!saved?.enabled && saved.label === `Hub · ${provider.label}`.slice(0, 100) && auth?.kind === 'api_key'
    && auth.credential_present && auth.baseUrl === provider.baseUrl && JSON.stringify(auth.models) === JSON.stringify(provider.models);
}
