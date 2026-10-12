import type { ProviderSnapshot } from './daemon-provider-management';
import { providerCollectionConfirmed, type ProviderCollectionWrite } from './daemon-provider-collection';
export type CreateProviderSelection = { providerId: string; authId: string; model: string };
export type CreateProviderReference = { revision: number; provider_id: string; auth_id: string; model: string };
export const EMPTY_CREATE_PROVIDER: CreateProviderSelection = { providerId: '', authId: '', model: '' };
const modelValid = (model: string) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(model) && !/(?:^|:)\.{1,2}(?::|$)/.test(model);
export function createProviderOptions(snapshot: ProviderSnapshot, selection: CreateProviderSelection) {
  const providers = snapshot.providers.filter(p => p.enabled && p.runtimes.some(r => r.runtime === 'codex-tui'
    && r.auth.some(a => a.kind === 'api_key' && a.credential_present && a.models.some(modelValid))));
  const auth = providers.find(p => p.id === selection.providerId)?.runtimes.find(r => r.runtime === 'codex-tui')?.auth
    .filter(a => a.kind === 'api_key' && a.credential_present && a.models.some(modelValid)) ?? [];
  const models = auth.find(a => a.id === selection.authId)?.models.filter(modelValid) ?? [];
  return { providers, auth, models };
}
export function changeCreateProviderSelection(selection: CreateProviderSelection, field: keyof CreateProviderSelection, value: string): CreateProviderSelection {
  if (field === 'providerId') return { providerId: value, authId: '', model: '' };
  if (field === 'authId') return { ...selection, authId: value, model: '' };
  return { ...selection, model: value };
}
export function managedCreateReference(snapshot: ProviderSnapshot, runtimeId: string, selection: CreateProviderSelection): CreateProviderReference | null {
  const options = createProviderOptions(snapshot, selection);
  if (runtimeId !== 'codex-app-server' || !options.models.includes(selection.model)) return null;
  return { revision: snapshot.revision, provider_id: selection.providerId, auth_id: selection.authId, model: selection.model };
}
/** A confirmed local collection can populate the form, but never creates a node. */
export function collectedCreateSelection(before: ProviderSnapshot, write: ProviderCollectionWrite, after: ProviderSnapshot): CreateProviderSelection | null {
  if (!providerCollectionConfirmed(before, write, after)) return null;
  const auth = after.providers.find(p => p.id === write.provider.provider_id)?.runtimes
    .find(r => r.runtime === 'codex-tui')?.auth.find(a => a.id === write.provider.auth_id);
  const selection = { providerId: write.provider.provider_id, authId: write.provider.auth_id, model: auth?.models[0] ?? '' };
  return managedCreateReference(after, 'codex-app-server', selection) ? selection : null;
}
export function validCreateProviderReference(value: CreateProviderReference): boolean {
  const id = (s: string) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(s);
  return Number.isSafeInteger(value.revision) && value.revision >= 0 && id(value.provider_id) && id(value.auth_id)
    && modelValid(value.model) && Object.keys(value).every(k => ['revision', 'provider_id', 'auth_id', 'model'].includes(k));
}
