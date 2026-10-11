// #906: explicit daemon readback, never a network-wide Provider catalog.
// This module contains no native imports and never returns untrusted error text.
export type ProviderScope = { networkId: string; daemonId: string };
import { validCodexInventory } from './codex-inventory';
export type CodexInventory = { observed_at: number; scope: 'hub_bound_nodes'; installation?: { status: 'found' | 'missing' | 'unknown'; version: string | null }; rows: Array<{
  node_id: string; alias: string; status: 'observed' | 'unavailable' | 'not_codex';
  runtime?: string | null; home_ref?: string; home_source?: string; config_status?: string;
  configured_provider?: string | null; configured_model?: string | null; node_configured_model?: string | null;
  provider_ids?: string[]; auth_kind?: string; credential_status?: string; account_fingerprint?: string | null;
  verification?: 'not_checked'; effective_state?: 'not_checked';
}> };
export type ProviderAuth = { id: string; kind: 'chatgpt' | 'api_key'; models: string[];
  baseUrl?: string; credential_present: boolean; verification: 'not_checked'; application: 'not_applied' };
export type ManagedProvider = { id: string; label: string; enabled: boolean;
  runtimes: { runtime: 'codex-tui'; auth: ProviderAuth[] }[] };
export type ProviderSnapshot = { network_id: string; daemon_node_id: string; revision: number;
  source: 'daemon'; providers: ManagedProvider[]; codex_inventory?: CodexInventory };
export type ProviderRead = { kind: 'ready'; snapshot: ProviderSnapshot; observedAt: number }
  | { kind: 'unsupported' | 'forbidden' | 'error' | 'timeout' | 'cancelled' };

export type ProviderSaveState = { identity: string; phase: 'saving' | 'saved' | 'unconfirmed' };
/** Receipts, not just configuration, belong to one Hub/credential/daemon scope. */
export function scopedProviderSave(state: ProviderSaveState | null, identity: string) {
  return state?.identity === identity ? state.phase : '';
}

const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const fields = (v: unknown, allowed: string[]) => record(v) && Object.keys(v).every(k => allowed.includes(k));
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v);
const list = (v: unknown, max: number): v is any[] => Array.isArray(v) && v.length > 0 && v.length <= max;
const unique = (xs: any[], key: string) => xs.every(record) && new Set(xs.map(x => x[key])).size === xs.length;

/** Fail closed on foreign scope, unsupported shapes or secret-bearing additions. */
export function parseProviderSnapshot(v: unknown, scope: ProviderScope): ProviderSnapshot | null {
  if (!record(v) || !fields(v, ['network_id', 'daemon_node_id', 'revision', 'source', 'providers', 'codex_inventory'])
    || v.network_id !== scope.networkId || v.daemon_node_id !== scope.daemonId || v.source !== 'daemon'
    || !Number.isSafeInteger(v.revision) || v.revision < 0 || !Array.isArray(v.providers)
    || v.providers.length > 100 || !unique(v.providers, 'id')) return null;
  if (v.codex_inventory !== undefined && !validCodexInventory(v.codex_inventory)) return null;
  for (const p of v.providers) {
    if (!fields(p, ['id', 'label', 'enabled', 'runtimes']) || !id(p.id)
      || typeof p.label !== 'string' || !p.label.trim() || p.label.length > 100
      || /[\x00-\x1f\x7f]/.test(p.label) || typeof p.enabled !== 'boolean'
      || !list(p.runtimes, 8) || !unique(p.runtimes, 'runtime')) return null;
    for (const r of p.runtimes) {
      if (!fields(r, ['runtime', 'auth']) || r.runtime !== 'codex-tui'
        || !list(r.auth, 32) || !unique(r.auth, 'id')) return null;
      for (const a of r.auth) {
        if (!fields(a, ['id', 'kind', 'models', 'baseUrl', 'credential_present', 'verification', 'application'])
          || !id(a.id) || a.verification !== 'not_checked' || a.application !== 'not_applied'
          || !list(a.models, 200) || new Set(a.models).size !== a.models.length
          || a.models.some((m: unknown) => typeof m !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(m))) return null;
        if (a.kind === 'chatgpt') {
          if (p.id !== 'openai' || a.baseUrl !== undefined || a.credential_present !== false) return null;
        } else if (a.kind === 'api_key') {
          if (a.credential_present !== true || typeof a.baseUrl !== 'string' || a.baseUrl.length > 2048) return null;
          try {
            const u = new URL(a.baseUrl);
            if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return null;
          } catch { return null; }
        } else return null;
      }
    }
  }
  const encoded = JSON.stringify(v);
  if (new TextEncoder().encode(encoded).byteLength > 1024 * 1024) return null;
  return JSON.parse(encoded) as ProviderSnapshot;
}

/** Configured counts ONLY. Same model in two auth profiles is one per Provider/runtime. */
export function providerConfiguredCounts(snapshot: ProviderSnapshot) {
  const models = new Set<string>();
  for (const p of snapshot.providers) for (const r of p.runtimes) for (const a of r.auth)
    for (const m of a.models) models.add(JSON.stringify([p.id, r.runtime, m]));
  return { providers: snapshot.providers.length, enabled: snapshot.providers.filter(p => p.enabled).length, models: models.size };
}

type RpcResult = { kind: 'payload'; value: Record<string, any> } | Exclude<ProviderRead, { kind: 'ready' }>;
export function parseProviderRpc(status: number, body: string): RpcResult {
  if (status === 401 || status === 403) return { kind: 'forbidden' };
  if (status === 404 || status === 501) return { kind: 'unsupported' };
  if (status < 200 || status >= 300 || body.length > 2 * 1024 * 1024) return { kind: 'error' };
  try {
    let envelope: any;
    try { envelope = JSON.parse(body); } catch {
      const messages = body.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim());
      envelope = JSON.parse(messages[messages.length - 1]);
    }
    if (envelope?.error || envelope?.result?.isError) {
      const message = envelope?.error?.message ?? envelope?.result?.content?.[0]?.text;
      return { kind: typeof message === 'string' && /unknown tool|tool .*not found/i.test(message) ? 'unsupported' : 'error' };
    }
    const value = JSON.parse(envelope?.result?.content?.[0]?.text);
    if (!record(value)) return { kind: 'error' };
    if (value.ok !== true) return { kind: ['user_token_required', 'provider_admin_required'].includes(value.error) ? 'forbidden' : 'error' };
    return { kind: 'payload', value };
  } catch { return { kind: 'error' }; }
}

export type ProviderRpc = (action: 'refresh' | 'read', id: string, signal: AbortSignal) => Promise<RpcResult>;

export type ProviderKeyForm = { id: string; label: string; authId: string; baseUrl: string; models: string; key: string };
export const EMPTY_PROVIDER_KEY_FORM: ProviderKeyForm = { id: '', label: '', authId: 'default', baseUrl: '', models: '', key: '' };
/** Preserve every other runtime/auth profile when updating just one API-key profile. */
export function providerKeyWrite(snapshot: ProviderSnapshot, form: ProviderKeyForm): { revision: number; provider: unknown } | null {
  if (!id(form.id) || !id(form.authId) || !form.label.trim()) return null;
  const old = snapshot.providers.find(p => p.id === form.id);
  const provider: any = old ? { ...old, runtimes: old.runtimes.map(r => ({ runtime: r.runtime, auth: r.auth.map(a => ({
    id: a.id, kind: a.kind, models: [...a.models], ...(a.baseUrl ? { baseUrl: a.baseUrl } : {}),
  })) })) } : { id: form.id, label: form.label.trim(), enabled: true, runtimes: [{ runtime: 'codex-tui', auth: [] }] };
  provider.label = form.label.trim();
  const runtime = provider.runtimes.find((r: any) => r.runtime === 'codex-tui');
  if (!runtime) return null;
  const before = runtime.auth.find((a: any) => a.id === form.authId);
  // Do not silently convert an official login into a key-based identity.
  if (before && before.kind !== 'api_key') return null;
  if (!form.key && (!before || before.baseUrl !== form.baseUrl.trim())) return null;
  if (form.key && (form.key.length > 8192 || /[\s\x00-\x1f\x7f]/.test(form.key))) return null;
  const auth = { id: form.authId, kind: 'api_key', models: form.models.split(/[,，\n]/).map(m => m.trim()).filter(Boolean),
    baseUrl: form.baseUrl.trim(), ...(form.key ? { key: form.key } : {}) };
  const index = runtime.auth.findIndex((a: any) => a.id === form.authId);
  if (index < 0) runtime.auth.push(auth); else runtime.auth[index] = auth;
  const projection = { ...provider, runtimes: provider.runtimes.map((r: any) => ({ ...r, auth: r.auth.map((a: any) => {
    const { key, ...publicAuth } = a;
    return { ...publicAuth, credential_present: a.kind === 'api_key', verification: 'not_checked', application: 'not_applied' };
  }) })) };
  if (!parseProviderSnapshot({ ...snapshot, providers: [projection] }, { networkId: snapshot.network_id, daemonId: snapshot.daemon_node_id })) return null;
  return { revision: snapshot.revision, provider };
}

/** One bounded refresh/read cycle. Cancel on navigation; no infinite loading or automatic replay. */
export async function loadProviderSnapshot(scope: ProviderScope, rpc: ProviderRpc, signal: AbortSignal,
  options: { timeoutMs?: number; pollMs?: number } = {}): Promise<ProviderRead> {
  if (!scope.networkId || !scope.daemonId) return { kind: 'error' };
  if (signal.aborted) return { kind: 'cancelled' };
  const ctrl = new AbortController();
  const cancel = () => ctrl.abort();
  signal.addEventListener('abort', cancel, { once: true });
  const deadline = setTimeout(cancel, options.timeoutMs ?? 20_000);
  const aborted = new Promise<{ kind: 'cancelled' | 'timeout' }>(resolve => {
    ctrl.signal.addEventListener('abort', () => resolve({ kind: signal.aborted ? 'cancelled' : 'timeout' }), { once: true });
  });
  const call = (action: 'refresh' | 'read', requestId: string) => Promise.race([rpc(action, requestId, ctrl.signal), aborted]);
  try {
    const refresh = await call('refresh', scope.daemonId);
    if (refresh.kind !== 'payload') return refresh;
    const requestId = refresh.value.request_id;
    if (refresh.value.status !== 'pending' || typeof requestId !== 'string' || !/^dps_[a-f0-9-]{36}$/.test(requestId)) return { kind: 'error' };
    while (!ctrl.signal.aborted) {
      const result = await call('read', requestId);
      if (result.kind !== 'payload') return result;
      const v = result.value;
      if (v.request_id !== requestId || v.daemon_node_id !== scope.daemonId) return { kind: 'error' };
      if (v.status === 'succeeded') {
        const snapshot = parseProviderSnapshot(v.snapshot, scope);
        return snapshot && Number.isSafeInteger(v.observed_at) && v.observed_at > 0
          ? { kind: 'ready', snapshot, observedAt: v.observed_at } : { kind: 'error' };
      }
      if (v.status === 'expired') return { kind: 'timeout' };
      if (v.status !== 'pending') return { kind: 'error' };
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); ctrl.signal.removeEventListener('abort', done); resolve(); };
        const timer = setTimeout(done, options.pollMs ?? 1000);
        ctrl.signal.addEventListener('abort', done, { once: true });
        if (ctrl.signal.aborted) done();
      });
    }
    return { kind: signal.aborted ? 'cancelled' : 'timeout' };
  } catch { return { kind: ctrl.signal.aborted ? (signal.aborted ? 'cancelled' : 'timeout') : 'error' }; }
  finally { clearTimeout(deadline); signal.removeEventListener('abort', cancel); ctrl.abort(); }
}
