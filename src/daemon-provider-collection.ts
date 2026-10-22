import type { CodexInventoryRow, ProviderSnapshot } from './daemon-provider-management';

export type ProviderCollectionForm = { nodeId: string; providerId: string; authId: string; label: string };
export type ProviderCollectionWrite = { action: 'collect'; revision: number; provider: {
  node_id: string; alias: string; node_revision: string; provider_id: string; auth_id: string; label: string;
} };
export const EMPTY_PROVIDER_COLLECTION: ProviderCollectionForm = { nodeId: '', providerId: '', authId: '', label: '' };
const id = (value: string) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
export function collectionSourceOptions(snapshot: ProviderSnapshot): CodexInventoryRow[] {
  return (snapshot.codex_inventory?.rows ?? []).filter(row => row.node_id !== snapshot.daemon_node_id
    && row.status === 'observed' && row.runtime === 'codex-app-server' && row.auth_kind === 'api_key'
    && id(row.node_id) && /^[\p{L}\p{N}][\p{L}\p{N}_.-]{0,99}$/u.test(row.alias)
    && /^[a-f0-9]{64}$/.test(row.config_revision ?? '') && id(row.configured_provider ?? '')
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(row.configured_model ?? ''));
}
export function collectionSourceForm(snapshot: ProviderSnapshot, nodeId: string): ProviderCollectionForm {
  const row = collectionSourceOptions(snapshot).find(row => row.node_id === nodeId);
  return row ? { nodeId, providerId: row.configured_provider!, authId: `source_${nodeId}`.slice(0, 64), label: row.configured_provider! }
    : { ...EMPTY_PROVIDER_COLLECTION };
}
export function providerCollectionWrite(snapshot: ProviderSnapshot, form: ProviderCollectionForm, confirmed: boolean): ProviderCollectionWrite | null {
  const row = collectionSourceOptions(snapshot).find(row => row.node_id === form.nodeId);
  const label = form.label.trim();
  if (!confirmed || !row || !id(form.providerId) || !id(form.authId) || !label || label.length > 100
    || /[\x00-\x1f\x7f]/.test(label) || snapshot.providers.some(provider => provider.id === form.providerId
      && provider.runtimes.some(runtime => runtime.auth.some(auth => auth.id === form.authId)))) return null;
  return { action: 'collect', revision: snapshot.revision, provider: { node_id: row.node_id, alias: row.alias,
    node_revision: row.config_revision!, provider_id: form.providerId, auth_id: form.authId, label } };
}
/** A newer revision alone is not proof that the selected profile was collected. */
export function providerCollectionConfirmed(before: ProviderSnapshot, write: ProviderCollectionWrite, after: ProviderSnapshot): boolean {
  const row = collectionSourceOptions(before).find(row => row.node_id === write.provider.node_id);
  const provider = after.providers.find(provider => provider.id === write.provider.provider_id);
  const auth = provider?.runtimes.find(runtime => runtime.runtime === 'codex-tui')?.auth.find(auth => auth.id === write.provider.auth_id);
  return !!row && after.network_id === before.network_id && after.daemon_node_id === before.daemon_node_id
    && after.revision === write.revision + 1 && provider?.label === write.provider.label
    && auth?.kind === 'api_key' && auth.credential_present && auth.models.length === 1
    && auth.models[0] === row.configured_model && auth.verification === 'not_checked' && auth.application === 'not_applied';
}
