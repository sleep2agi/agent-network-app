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
  if (!options.nodes.some(n => n.node_id === selection.nodeId) || !options.profile
    || !options.models.includes(selection.model)) return null;
  return {
    networkId: snapshot.network_id, daemonId: snapshot.daemon_node_id, providerRevision: snapshot.revision,
    ...selection, runtime: 'codex-tui' as const, authKind: options.profile.kind,
  };
}
