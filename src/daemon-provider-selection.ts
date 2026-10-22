import type { ProviderSnapshot } from './daemon-provider-management';

export type ProviderSelection = { nodeId: string; providerId: string; authId: string; model: string };
export const EMPTY_PROVIDER_SELECTION: ProviderSelection = { nodeId: '', providerId: '', authId: '', model: '' };

/** Choices only from this daemon's receipt; never from network-wide catalogs. */
export function providerSelectionOptions(snapshot: ProviderSnapshot, selection: ProviderSelection) {
  const nodes = (snapshot.codex_inventory?.rows ?? []).filter(row => row.status === 'observed'
    && (row.runtime === 'codex-app-server' || row.runtime === 'codex-tui'));
  const providers = snapshot.providers.filter(p => p.enabled && p.runtimes.some(r => r.runtime === 'codex-tui'));
  const provider = providers.find(p => p.id === selection.providerId);
  const auth = provider?.runtimes.find(r => r.runtime === 'codex-tui')?.auth ?? [];
  const profile = auth.find(a => a.id === selection.authId);
  return { nodes, providers, auth, models: profile?.models ?? [], profile };
}

/** Changing a parent explicitly clears dependent choices, even matching model names. */
export function changeProviderSelection(selection: ProviderSelection, field: keyof ProviderSelection, value: string): ProviderSelection {
  if (field === 'nodeId') return { ...EMPTY_PROVIDER_SELECTION, nodeId: value };
  if (field === 'providerId') return { ...selection, providerId: value, authId: '', model: '' };
  if (field === 'authId') return { ...selection, authId: value, model: '' };
  return { ...selection, model: value };
}

export function resolveProviderSelection(snapshot: ProviderSnapshot, selection: ProviderSelection) {
  const options = providerSelectionOptions(snapshot, selection);
  const node = options.nodes.find(n => n.node_id === selection.nodeId);
  if (!node || !options.profile
    || !options.models.includes(selection.model)) return null;
  return {
    networkId: snapshot.network_id, daemonId: snapshot.daemon_node_id, providerRevision: snapshot.revision,
    ...selection, runtime: 'codex-tui' as const, authKind: options.profile.kind, nodeRevision: node.config_revision ?? null,
    accountId: options.profile.account_id, credentialPresent: options.profile.credential_present,
  };
}

/** A readable legacy scan is not permission to mutate; require both CAS tokens. */
export function providerApplicationWrite(snapshot: ProviderSnapshot, selection: ProviderSelection, confirmed: boolean) {
  const resolved = resolveProviderSelection(snapshot, selection);
  if (!confirmed || !resolved || (resolved.authKind === 'chatgpt' && (!resolved.accountId || !resolved.credentialPresent)) || !resolved.nodeRevision
    || !/^[a-f0-9]{64}$/.test(resolved.nodeRevision)) return null;
  return { revision: resolved.providerRevision, provider: {
    node_id: resolved.nodeId, node_revision: resolved.nodeRevision, provider_id: resolved.providerId,
    auth_id: resolved.authId, model: resolved.model, confirm_restart: true as const,
    ...(resolved.authKind === 'chatgpt' ? { account_id: resolved.accountId! } : {}),
  } };
}
