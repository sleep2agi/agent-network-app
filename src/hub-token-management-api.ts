import type { HubConfig } from './api';
import { hubManagementRpc } from './hub-provider-management-api';
import { hubTokenInput, parseHubTokenNames } from './hub-token-management';
export async function readHubTokenNames(cfg: HubConfig, signal: AbortSignal) {
  try {
    const result = await hubManagementRpc(cfg, 'list_network_secrets', {}, signal);
    return result.kind === 'payload' ? parseHubTokenNames(result.value) : null;
  } catch { return null; }
}
export async function saveHubToken(cfg: HubConfig, key: string, value: string, signal: AbortSignal) {
  const input = hubTokenInput(key, value); if (!input) return null;
  try {
    const result = await hubManagementRpc(cfg, 'upsert_network_secret', input, signal, true);
    if (result.kind !== 'payload' || result.value.key !== input.key) return null;
    const names = await readHubTokenNames(cfg, signal);
    return names?.includes(input.key) ? names : null;
  } catch { return null; }
}
