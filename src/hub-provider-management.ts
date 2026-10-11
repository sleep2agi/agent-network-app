export type HubProvider = { id: string; label: string; enabled: boolean; protocol: 'openai-responses' | 'openai-chat-completions' | 'anthropic-messages'; baseUrl: string; models: string[];
  revision: number; updated_at: number; source: 'hub'; credential_present: boolean; verification: 'not_checked'; compatible_runtimes: string[]; secret_key_ref?: string };
export type HubProviderForm = { id: string; label: string; enabled: boolean; protocol: HubProvider['protocol']; baseUrl: string; models: string; key: string; revision: number; secretKeyRef?: string };
export const EMPTY_HUB_PROVIDER: HubProviderForm = { id: '', label: '', enabled: true, protocol: 'openai-responses', baseUrl: '', models: '', key: '', revision: 0 };
export function hubProviderInput(form: HubProviderForm) {
  const models = form.models.split(/[,，\n]/).map(m => m.trim()).filter(Boolean);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(form.id) || !form.label.trim() || form.label.length > 100
    || /[\x00-\x1f\x7f]/.test(form.label) || !models.length || models.length > 200 || new Set(models).size !== models.length
    || models.some(m => !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(m))
    || !['openai-responses', 'openai-chat-completions', 'anthropic-messages'].includes(form.protocol)
    || !Number.isSafeInteger(form.revision) || form.revision < 0 || (!form.revision && !form.key && !form.secretKeyRef)
    || (form.secretKeyRef !== undefined && (!/^[A-Z][A-Z0-9_]{0,63}$/.test(form.secretKeyRef) || !!form.key))
    || (form.key && (form.key.length > 8192 || /[\s\x00-\x1f\x7f]/.test(form.key)))) return null;
  try { const u = new URL(form.baseUrl.trim()); if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return null; }
  catch { return null; }
  return { id: form.id, label: form.label.trim(), enabled: form.enabled, protocol: form.protocol,
    baseUrl: form.baseUrl.trim(), models, ...(form.key ? { key: form.key } : {}), ...(form.secretKeyRef ? { secretKeyRef: form.secretKeyRef } : {}) };
}
export function parseHubProvider(value: any): HubProvider | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.id !== 'string' || typeof value.label !== 'string' || typeof value.baseUrl !== 'string'
    || Object.keys(value).some(k => !['id','label','enabled','protocol','baseUrl','models','revision','updated_at','source','credential_present','verification','compatible_runtimes','secret_key_ref'].includes(k))
    || (value.secret_key_ref !== undefined && (typeof value.secret_key_ref !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(value.secret_key_ref)))
    || !Number.isSafeInteger(value.revision) || value.revision < 1 || !Number.isSafeInteger(value.updated_at)
    || value.source !== 'hub' || typeof value.enabled !== 'boolean' || typeof value.credential_present !== 'boolean' || value.verification !== 'not_checked'
    || !Array.isArray(value.models) || !value.models.every((m: unknown) => typeof m === 'string')
    || !Array.isArray(value.compatible_runtimes)
    || JSON.stringify(value.compatible_runtimes) !== JSON.stringify(value.protocol === 'openai-responses' ? ['codex-tui'] : [])) return null;
  if (!hubProviderInput({ ...value, models: value.models.join(','), key: '', revision: value.revision })) return null;
  return JSON.parse(JSON.stringify(value));
}
export function parseHubProviderCatalog(value: any, networkId: string): HubProvider[] | null {
  if (value?.ok !== true || value.network_id !== networkId || value.source !== 'hub' || !Array.isArray(value.providers)
    || value.providers.length > 1000) return null;
  const rows = value.providers.map(parseHubProvider);
  return rows.some((r: HubProvider | null) => !r) || new Set(rows.map((r: HubProvider) => r.id)).size !== rows.length ? null : rows;
}
