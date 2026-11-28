// Hub-managed external storage relay (ModelScope / Aliyun OSS / AWS S3) client store.
//
// Security & design discipline (mirrors hub-voice.ts):
// - GET /api/storage/config reads masked metadata only (never exposes plaintext secrets).
// - PUT /api/storage/config, DELETE /api/storage/config, POST /api/storage/test are owner/admin only.
// - Old Hubs returning 404/405/501 degrade silently to supported=false without error noise.
// - Scoped strictly by (serverUrl, networkId, token); switching account/network resets immediately.
// - Zero console.* logs (never risk logging secrets or tokens).

import type { HubConfig } from './api';
import { appFetch } from './app-fetch';
import { reportProfileAuthResponse } from './profile-auth-state';
import { LEGACY_SESSION_ID } from './session-registry';

export type HubStorageProvider = 'modelscope' | 'oss' | 's3';
export type HubStorageRepoType = 'dataset' | 'model';

// ModelScope lacks per-object signed URLs so it cannot be configured for private network storage;
// only private S3 / Aliyun OSS buckets are selectable for new configs (legacy ModelScope remains readable).
export const SELECTABLE_HUB_STORAGE_PROVIDERS: readonly HubStorageProvider[] = ['s3', 'oss'];

export function isSelectableHubStorageProvider(provider: HubStorageProvider): boolean {
  return provider === 's3' || provider === 'oss';
}

export const DEFAULT_HUB_STORAGE_MAX_BYTES = 100 * 1024 * 1024;
export const MIN_HUB_STORAGE_MAX_BYTES = 1 * 1024 * 1024;
export const MAX_HUB_STORAGE_MAX_BYTES = 500 * 1024 * 1024;

export type HubStorageConfigState = {
  scopeKey: string;
  supported: boolean;
  loaded: boolean;
  enabled: boolean;
  configured: boolean;
  provider: HubStorageProvider;
  endpoint: string;
  region: string;
  bucket: string;
  repoId: string;
  repoType: HubStorageRepoType;
  revision: string;
  prefix: string;
  publicBaseUrl: string;
  maxFileBytes: number;
  keyHint: string;
  canManage: boolean;
  vaultReady: boolean;
  updatedAt: number | null;
};

export type HubStorageAdminForm = {
  enabled: boolean;
  provider: HubStorageProvider;
  repoId: string;
  repoType: HubStorageRepoType;
  revision: string;
  apiToken: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  accessKeySecret: string;
  endpoint: string;
  prefix: string;
  publicBaseUrl: string;
  maxFileMb: string;
};

export type HubStorageWriteInput = {
  enabled: boolean;
  provider: HubStorageProvider;
  repo_id?: string;
  repo_type?: HubStorageRepoType;
  revision?: string;
  api_token?: string;
  bucket?: string;
  region?: string;
  access_key_id?: string;
  access_key_secret?: string;
  endpoint: string;
  prefix: string;
  public_base_url: string;
  max_file_bytes: number;
};

export type HubStorageTestResult = {
  ok: boolean;
  provider: HubStorageProvider;
  latencyMs: number;
  visibility?: 'private' | 'public' | 'unknown';
  warning?: string;
  message: string;
  error?: string;
};

export type HubStorageFetchLike = (
  url: string,
  init: { method?: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{
  status: number;
  ok?: boolean;
  json(): Promise<unknown>;
}>;

export const EMPTY_HUB_STORAGE: HubStorageConfigState = {
  scopeKey: '',
  supported: false,
  loaded: false,
  enabled: false,
  configured: false,
  provider: 's3',
  endpoint: '',
  region: '',
  bucket: '',
  repoId: '',
  repoType: 'dataset',
  revision: 'master',
  prefix: 'anet-files',
  publicBaseUrl: '',
  maxFileBytes: DEFAULT_HUB_STORAGE_MAX_BYTES,
  keyHint: '',
  canManage: false,
  vaultReady: true,
  updatedAt: null,
};

const defaultFetch: HubStorageFetchLike = (url, init) => appFetch(url, init as RequestInit) as ReturnType<HubStorageFetchLike>;

export function hubStorageScopeKey(cfg: HubConfig | null): string {
  if (!cfg || !cfg.serverUrl || !cfg.token) return '';
  return `${cfg.serverUrl.replace(/\/+$/, '')}|${cfg.networkId ?? ''}|${cfg.token.slice(-12)}`;
}

function storageUrl(cfg: HubConfig, path: string): string {
  const base = cfg.serverUrl.replace(/\/+$/, '');
  if (!cfg.networkId) return `${base}${path}`;
  return `${base}${path}?network_id=${encodeURIComponent(cfg.networkId)}`;
}

function authHeaders(cfg: HubConfig, withJson = false): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${cfg.token}` };
  if (withJson) h['Content-Type'] = 'application/json';
  return h;
}

function profileIdOf(cfg: HubConfig): string {
  return cfg.profileId ?? LEGACY_SESSION_ID;
}

function normalizeProvider(raw: unknown): HubStorageProvider {
  if (raw === 'oss' || raw === 's3' || raw === 'modelscope') return raw;
  return 's3';
}

function parsePublicConfig(scopeKey: string, body: unknown): HubStorageConfigState | null {
  if (!body || typeof body !== 'object') return null;
  const o = body as Record<string, unknown>;
  if (o.ok !== true || typeof o.configured !== 'boolean' || typeof o.enabled !== 'boolean') return null;
  const configured = o.configured;
  const enabled = configured && o.enabled;
  const rawMax = typeof o.max_file_bytes === 'number' && Number.isFinite(o.max_file_bytes)
    ? Math.min(Math.max(Math.floor(o.max_file_bytes), MIN_HUB_STORAGE_MAX_BYTES), MAX_HUB_STORAGE_MAX_BYTES)
    : DEFAULT_HUB_STORAGE_MAX_BYTES;
  return {
    scopeKey,
    supported: true,
    loaded: true,
    enabled,
    configured,
    provider: normalizeProvider(o.provider),
    endpoint: typeof o.endpoint === 'string' ? o.endpoint : '',
    region: typeof o.region === 'string' ? o.region : '',
    bucket: typeof o.bucket === 'string' ? o.bucket : '',
    repoId: typeof o.repo_id === 'string' ? o.repo_id : '',
    repoType: o.repo_type === 'model' ? 'model' : 'dataset',
    revision: typeof o.revision === 'string' && o.revision ? o.revision : 'master',
    prefix: typeof o.prefix === 'string' ? o.prefix : 'anet-files',
    publicBaseUrl: typeof o.public_base_url === 'string' ? o.public_base_url : '',
    maxFileBytes: rawMax,
    keyHint: typeof o.key_hint === 'string' ? o.key_hint : '',
    canManage: o.can_manage === true,
    vaultReady: o.vault_ready !== false,
    updatedAt: typeof o.updated_at === 'number' && Number.isFinite(o.updated_at) ? o.updated_at : null,
  };
}

export function initialHubStorageForm(state: HubStorageConfigState): HubStorageAdminForm {
  const editableProvider: HubStorageProvider = isSelectableHubStorageProvider(state.provider) ? state.provider : 's3';
  return {
    enabled: state.configured ? state.enabled : true,
    provider: editableProvider,
    repoId: state.repoId,
    repoType: state.repoType,
    revision: state.revision || 'master',
    apiToken: '',
    bucket: state.bucket,
    region: state.region,
    accessKeyId: '',
    accessKeySecret: '',
    endpoint: state.endpoint,
    prefix: state.prefix ?? 'anet-files',
    publicBaseUrl: '',
    maxFileMb: String(Math.round((state.maxFileBytes || DEFAULT_HUB_STORAGE_MAX_BYTES) / (1024 * 1024))),
  };
}

function isValidOptionalUrl(raw: string): boolean {
  const s = raw.trim();
  if (!s) return true;
  try {
    const u = new URL(s);
    if (u.username || u.password) return false;
    if (u.protocol === 'https:') return true;
    const h = u.hostname.toLowerCase();
    return u.protocol === 'http:' && (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1');
  } catch {
    return false;
  }
}

/** Pure form validator + payload builder for PUT /api/storage/config and POST /api/storage/test. */
export function mergeHubStorageWrite(
  current: HubStorageConfigState,
  form: HubStorageAdminForm,
): { ok: true; body: HubStorageWriteInput } | { ok: false; reasonKey: string } {
  const sameProvider = current.configured && current.provider === form.provider;
  const endpoint = form.endpoint.trim();
  if (!isValidOptionalUrl(endpoint)) {
    return { ok: false, reasonKey: 'hubStorage.err.urlInvalid' };
  }
  // Strictly private-only policy: never transmit a public/CDN base URL.
  const publicBaseUrl = '';

  const mb = Number(form.maxFileMb.trim() || '100');
  if (!Number.isFinite(mb) || mb < 1 || mb > 500) {
    return { ok: false, reasonKey: 'hubStorage.err.maxSizeInvalid' };
  }
  const maxFileBytes = Math.round(mb) * 1024 * 1024;
  const prefix = form.prefix.trim().replace(/^\/+|\/+$/g, '');

  if (form.provider === 'modelscope') {
    // Allow disabling an already-configured legacy ModelScope entry; block creating/enabling/testing ModelScope.
    if (!sameProvider || form.enabled) {
      return { ok: false, reasonKey: 'hubStorage.modelscopeDisabledHint' };
    }
    const repoId = form.repoId.trim().replace(/^\/+|\/+$/g, '');
    if (!/^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,120}$/.test(repoId) || repoId.includes('..')) {
      return { ok: false, reasonKey: 'hubStorage.err.repoIdRequired' };
    }
    const body: HubStorageWriteInput = {
      enabled: false,
      provider: 'modelscope',
      repo_id: repoId,
      repo_type: form.repoType,
      revision: form.revision.trim() || 'master',
      endpoint,
      prefix,
      public_base_url: publicBaseUrl,
      max_file_bytes: maxFileBytes,
    };
    return { ok: true, body };
  }

  const bucket = form.bucket.trim();
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || bucket.includes('..')) {
    return { ok: false, reasonKey: 'hubStorage.err.bucketRequired' };
  }
  const region = form.region.trim().toLowerCase();
  if (!/^[a-z0-9-]{2,40}$/.test(region)) {
    return { ok: false, reasonKey: 'hubStorage.err.regionRequired' };
  }
  const ak = form.accessKeyId.trim();
  const sk = form.accessKeySecret.trim();
  if ((ak || sk) && (!ak || !sk)) {
    return { ok: false, reasonKey: 'hubStorage.err.akSkRequired' };
  }
  if (!ak && !sk && !sameProvider) {
    return { ok: false, reasonKey: 'hubStorage.err.akSkRequired' };
  }
  if ((ak && /[\s\x00-\x1f\x7f]/.test(ak)) || (sk && /[\s\x00-\x1f\x7f]/.test(sk))) {
    return { ok: false, reasonKey: 'hubStorage.err.secretWhitespace' };
  }

  const body: HubStorageWriteInput = {
    enabled: form.enabled,
    provider: form.provider,
    bucket,
    region,
    endpoint,
    prefix,
    public_base_url: publicBaseUrl,
    max_file_bytes: maxFileBytes,
  };
  if (ak && sk) {
    body.access_key_id = ak;
    body.access_key_secret = sk;
  }
  return { ok: true, body };
}

// ── Reactive module-level store ────────────────────────────────────────────
let activeCfg: HubConfig | null = null;
let snapshot: HubStorageConfigState = EMPTY_HUB_STORAGE;
let storeEpoch = 0;
const listeners = new Set<() => void>();
const unsupportedScopes = new Set<string>();

function emit(): void {
  for (const cb of [...listeners]) cb();
}

function setSnapshot(next: HubStorageConfigState): void {
  if (
    snapshot.scopeKey === next.scopeKey &&
    snapshot.supported === next.supported &&
    snapshot.loaded === next.loaded &&
    snapshot.enabled === next.enabled &&
    snapshot.configured === next.configured &&
    snapshot.provider === next.provider &&
    snapshot.endpoint === next.endpoint &&
    snapshot.region === next.region &&
    snapshot.bucket === next.bucket &&
    snapshot.repoId === next.repoId &&
    snapshot.repoType === next.repoType &&
    snapshot.revision === next.revision &&
    snapshot.prefix === next.prefix &&
    snapshot.publicBaseUrl === next.publicBaseUrl &&
    snapshot.maxFileBytes === next.maxFileBytes &&
    snapshot.keyHint === next.keyHint &&
    snapshot.canManage === next.canManage &&
    snapshot.vaultReady === next.vaultReady &&
    snapshot.updatedAt === next.updatedAt
  ) {
    return;
  }
  snapshot = next;
  emit();
}

export function getActiveHubStorageConfig(): HubConfig | null {
  return activeCfg;
}

export function getHubStorageSnapshot(): HubStorageConfigState {
  return snapshot;
}

export function subscribeHubStorage(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function __resetHubStorageForTest(): void {
  storeEpoch++;
  activeCfg = null;
  snapshot = EMPTY_HUB_STORAGE;
  unsupportedScopes.clear();
  emit();
}

export function setActiveHubStorageConfig(cfg: HubConfig | null, opts?: { fetchImpl?: HubStorageFetchLike }): void {
  const nextScope = hubStorageScopeKey(cfg);
  const prevScope = hubStorageScopeKey(activeCfg);
  activeCfg = cfg;
  if (!cfg || !nextScope) {
    storeEpoch++;
    setSnapshot(EMPTY_HUB_STORAGE);
    return;
  }
  if (nextScope !== prevScope) {
    storeEpoch++;
    setSnapshot({ ...EMPTY_HUB_STORAGE, scopeKey: nextScope });
    void refreshHubStorageConfig(cfg, opts);
  }
}

export async function fetchHubStorageConfig(
  cfg: HubConfig,
  opts?: { fetchImpl?: HubStorageFetchLike },
): Promise<HubStorageConfigState> {
  const scopeKey = hubStorageScopeKey(cfg);
  if (!scopeKey) return EMPTY_HUB_STORAGE;
  const fetchImpl = opts?.fetchImpl ?? defaultFetch;
  try {
    const res = await fetchImpl(storageUrl(cfg, '/api/storage/config'), {
      method: 'GET',
      headers: authHeaders(cfg),
    });
    if (res.status === 401) {
      reportProfileAuthResponse(401, profileIdOf(cfg), undefined, cfg.token);
      return { ...EMPTY_HUB_STORAGE, scopeKey, loaded: true };
    }
    if (res.status === 404 || res.status === 405 || res.status === 501) {
      unsupportedScopes.add(scopeKey);
      return { ...EMPTY_HUB_STORAGE, scopeKey, supported: false, loaded: true };
    }
    if (res.status < 200 || res.status >= 300) {
      return { ...EMPTY_HUB_STORAGE, scopeKey, loaded: true };
    }
    const body = await res.json().catch(() => null);
    const parsed = parsePublicConfig(scopeKey, body);
    if (!parsed) return { ...EMPTY_HUB_STORAGE, scopeKey, loaded: true };
    unsupportedScopes.delete(scopeKey);
    return parsed;
  } catch {
    return snapshot.scopeKey === scopeKey ? snapshot : { ...EMPTY_HUB_STORAGE, scopeKey };
  }
}

export async function refreshHubStorageConfig(
  cfg: HubConfig | null = activeCfg,
  opts?: { fetchImpl?: HubStorageFetchLike; force?: boolean },
): Promise<HubStorageConfigState> {
  const target = cfg ?? activeCfg;
  const scopeKey = hubStorageScopeKey(target);
  if (!target || !scopeKey) {
    setSnapshot(EMPTY_HUB_STORAGE);
    return EMPTY_HUB_STORAGE;
  }
  if (!opts?.force && unsupportedScopes.has(scopeKey)) {
    const unsupported = { ...EMPTY_HUB_STORAGE, scopeKey, supported: false, loaded: true };
    if (hubStorageScopeKey(activeCfg) === scopeKey) setSnapshot(unsupported);
    return unsupported;
  }
  const reqEpoch = storeEpoch;
  const next = await fetchHubStorageConfig(target, opts);
  if (hubStorageScopeKey(activeCfg) === scopeKey && reqEpoch === storeEpoch) {
    setSnapshot(next);
  }
  return reqEpoch === storeEpoch ? next : snapshot;
}

export async function saveHubStorageConfig(
  cfg: HubConfig,
  input: HubStorageWriteInput,
  opts?: { fetchImpl?: HubStorageFetchLike },
): Promise<{ ok: true; state: HubStorageConfigState } | { ok: false; error: string; message: string }> {
  const scopeKey = hubStorageScopeKey(cfg);
  const fetchImpl = opts?.fetchImpl ?? defaultFetch;
  try {
    const res = await fetchImpl(storageUrl(cfg, '/api/storage/config'), {
      method: 'PUT',
      headers: authHeaders(cfg, true),
      body: JSON.stringify(cfg.networkId ? { ...input, network_id: cfg.networkId } : input),
    });
    if (res.status === 401) {
      reportProfileAuthResponse(401, profileIdOf(cfg), undefined, cfg.token);
      return { ok: false, error: 'auth_required', message: 'HTTP 401' };
    }
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.status >= 200 && res.status < 300) {
      const parsed = parsePublicConfig(scopeKey, body);
      if (parsed) {
        if (hubStorageScopeKey(activeCfg) === scopeKey) {
          storeEpoch++;
          setSnapshot(parsed);
        }
        return { ok: true, state: parsed };
      }
    }
    const errCode = typeof body?.error === 'string' ? body.error : `http_${res.status}`;
    const errMsg = typeof body?.message === 'string' && body.message.trim() ? body.message.trim() : errCode;
    return { ok: false, error: errCode, message: errMsg };
  } catch {
    return { ok: false, error: 'network', message: 'network' };
  }
}

export async function testHubStorageConfig(
  cfg: HubConfig,
  draft?: HubStorageWriteInput | null,
  opts?: { fetchImpl?: HubStorageFetchLike },
): Promise<HubStorageTestResult> {
  const fetchImpl = opts?.fetchImpl ?? defaultFetch;
  const provider = draft?.provider ?? snapshot.provider ?? 'modelscope';
  try {
    const payload = draft
      ? (cfg.networkId ? { ...draft, network_id: cfg.networkId } : draft)
      : (cfg.networkId ? { network_id: cfg.networkId } : {});
    const res = await fetchImpl(storageUrl(cfg, '/api/storage/test'), {
      method: 'POST',
      headers: authHeaders(cfg, true),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) {
      reportProfileAuthResponse(401, profileIdOf(cfg), undefined, cfg.token);
      return { ok: false, provider, latencyMs: 0, error: 'auth_required', message: 'HTTP 401' };
    }
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const latencyMs = typeof body?.latency_ms === 'number' ? body.latency_ms : 0;
    const vis = body?.visibility === 'private' || body?.visibility === 'public' || body?.visibility === 'unknown'
      ? body.visibility
      : undefined;
    const warning = typeof body?.warning === 'string' && body.warning.trim() ? body.warning.trim() : undefined;
    const message = typeof body?.message === 'string' && body.message.trim()
      ? body.message.trim()
      : (typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`);
    if (res.status >= 200 && res.status < 300 && body?.ok === true) {
      return {
        ok: true,
        provider: normalizeProvider(body.provider ?? provider),
        latencyMs,
        visibility: vis,
        warning,
        message,
      };
    }
    return {
      ok: false,
      provider: normalizeProvider(body?.provider ?? provider),
      latencyMs,
      visibility: vis,
      warning,
      error: typeof body?.error === 'string' ? body.error : `http_${res.status}`,
      message,
    };
  } catch {
    return { ok: false, provider, latencyMs: 0, error: 'network', message: 'network' };
  }
}

export async function clearHubStorageConfig(
  cfg: HubConfig,
  opts?: { fetchImpl?: HubStorageFetchLike },
): Promise<{ ok: true; state: HubStorageConfigState } | { ok: false; error: string; message: string }> {
  const scopeKey = hubStorageScopeKey(cfg);
  const fetchImpl = opts?.fetchImpl ?? defaultFetch;
  try {
    const res = await fetchImpl(storageUrl(cfg, '/api/storage/config'), {
      method: 'DELETE',
      headers: authHeaders(cfg),
    });
    if (res.status === 401) {
      reportProfileAuthResponse(401, profileIdOf(cfg), undefined, cfg.token);
      return { ok: false, error: 'auth_required', message: 'HTTP 401' };
    }
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.status >= 200 && res.status < 300) {
      const parsed = parsePublicConfig(scopeKey, body);
      if (parsed) {
        if (hubStorageScopeKey(activeCfg) === scopeKey) {
          storeEpoch++;
          setSnapshot(parsed);
        }
        return { ok: true, state: parsed };
      }
    }
    const errCode = typeof body?.error === 'string' ? body.error : `http_${res.status}`;
    const errMsg = typeof body?.message === 'string' && body.message.trim() ? body.message.trim() : errCode;
    return { ok: false, error: errCode, message: errMsg };
  } catch {
    return { ok: false, error: 'network', message: 'network' };
  }
}
