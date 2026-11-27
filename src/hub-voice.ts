// #5653 — Hub 统一配置语音输入（ASR）客户端逻辑与模块级状态（直接发放 Key，不做音频转发）。
//
// 设计要点：
// - GET /api/voice/config 读取脱敏状态（enabled / configured / keyHint / canManage / updatedAt）。
// - 启用时通过 GET /api/voice/credentials 拉取豆包语音凭据，**仅存放在易失内存**（绝不写 localStorage），
//   供客户端直接连接豆包极速版（桌面/鸿蒙/网页）与豆包流式识别（Android/iOS 边说边出字），
//   零 Hub 带宽与中转延迟。
// - 旧版 Hub 返回 404/405/501 时静默降级为 supported=false，不报错、不反复轮询。
// - 严格按 (serverUrl, networkId, token) 隔离状态，切账号 / 切网络 / 登出 / 管理员停用立即清空内存凭据。
// - 🔴 不打任何 console.* 日志（音频与密钥安全红线）。

import type { HubConfig } from './api';
import { appFetch } from './app-fetch';
import { isStreamResourceId, STREAM_DEFAULT_RESOURCE_ID } from './doubao-stream-protocol';
import { reportProfileAuthResponse } from './profile-auth-state';
import { LEGACY_SESSION_ID } from './session-registry';
import { checkEndpoint, checkStreamEndpoint, type VoiceCredentials } from './voice-credentials-model';

export type HubVoiceAuthMode = 'api-key' | 'app-token';

export type HubVoiceConfigState = {
  scopeKey: string;
  supported: boolean;
  loaded: boolean;
  enabled: boolean;
  configured: boolean;
  mode: 'hub-key';
  provider: 'doubao';
  authMode: HubVoiceAuthMode;
  appId: string;
  keyHint: string;
  endpoint: string;
  streamEndpoint: string;
  streamResourceId: string;
  canUse: boolean;
  canManage: boolean;
  vaultReady: boolean;
  updatedAt: number | null;
};

export type HubVoiceAdminForm = {
  enabled: boolean;
  authMode: HubVoiceAuthMode;
  apiKey: string;
  appId: string;
  accessToken: string;
  endpoint: string;
  streamEndpoint: string;
  streamResourceId: string;
};

export type HubVoiceWriteInput = {
  enabled: boolean;
  provider: 'doubao';
  auth_mode: HubVoiceAuthMode;
  app_id: string;
  access_token?: string;
  endpoint: string;
  stream_endpoint: string;
  stream_resource_id: string;
};

export type HubVoiceFetchLike = (
  url: string,
  init: { method?: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{
  status: number;
  ok?: boolean;
  json(): Promise<unknown>;
}>;

export const EMPTY_HUB_VOICE: HubVoiceConfigState = {
  scopeKey: '',
  supported: false,
  loaded: false,
  enabled: false,
  configured: false,
  mode: 'hub-key',
  provider: 'doubao',
  authMode: 'api-key',
  appId: '',
  keyHint: '',
  endpoint: '',
  streamEndpoint: '',
  streamResourceId: '',
  canUse: false,
  canManage: false,
  vaultReady: true,
  updatedAt: null,
};

const defaultFetch: HubVoiceFetchLike = (url, init) => appFetch(url, init as RequestInit) as ReturnType<HubVoiceFetchLike>;

export function hubVoiceScopeKey(cfg: HubConfig | null): string {
  if (!cfg || !cfg.serverUrl || !cfg.token) return '';
  return `${cfg.serverUrl.replace(/\/+$/, '')}|${cfg.networkId ?? ''}|${cfg.token.slice(-12)}`;
}

function voiceUrl(cfg: HubConfig, path: string): string {
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

function parsePublicConfig(scopeKey: string, body: unknown): HubVoiceConfigState | null {
  if (!body || typeof body !== 'object') return null;
  const o = body as Record<string, unknown>;
  if (o.ok !== true || typeof o.configured !== 'boolean' || typeof o.enabled !== 'boolean') return null;
  const configured = o.configured;
  const enabled = configured && o.enabled;
  const authMode: HubVoiceAuthMode = o.auth_mode === 'app-token' ? 'app-token' : 'api-key';
  const rawStreamRid = typeof o.stream_resource_id === 'string' ? o.stream_resource_id.trim() : '';
  return {
    scopeKey,
    supported: true,
    loaded: true,
    enabled,
    configured,
    mode: 'hub-key',
    provider: 'doubao',
    authMode,
    appId: typeof o.app_id === 'string' ? o.app_id : '',
    keyHint: typeof o.key_hint === 'string' ? o.key_hint : '',
    endpoint: typeof o.endpoint === 'string' ? o.endpoint : '',
    streamEndpoint: typeof o.stream_endpoint === 'string' ? o.stream_endpoint : '',
    streamResourceId: isStreamResourceId(rawStreamRid) ? rawStreamRid : '',
    canUse: o.can_use !== false,
    canManage: o.can_manage === true,
    vaultReady: o.vault_ready !== false,
    updatedAt: typeof o.updated_at === 'number' && Number.isFinite(o.updated_at) ? o.updated_at : null,
  };
}

function parseIssuedCredentials(body: unknown): { creds: VoiceCredentials; updatedAt: number | null } | null {
  if (!body || typeof body !== 'object') return null;
  const o = body as Record<string, unknown>;
  if (o.ok !== true || !o.credentials || typeof o.credentials !== 'object') return null;
  const c = o.credentials as Record<string, unknown>;
  const accessToken = typeof c.access_token === 'string' ? c.access_token.trim() : '';
  if (!accessToken) return null;
  const authMode: HubVoiceAuthMode = c.auth_mode === 'app-token' ? 'app-token' : 'api-key';
  const appId = authMode === 'app-token' && typeof c.app_id === 'string' ? c.app_id.trim() : '';
  const endpoint = typeof c.endpoint === 'string' ? c.endpoint.trim() : '';
  const streamEndpoint = typeof c.stream_endpoint === 'string' ? c.stream_endpoint.trim() : '';
  const streamResourceId = typeof c.stream_resource_id === 'string' ? c.stream_resource_id.trim() : '';
  const creds: VoiceCredentials = { appId, accessToken, endpoint };
  if (streamEndpoint) creds.streamEndpoint = streamEndpoint;
  if (isStreamResourceId(streamResourceId)) creds.streamResourceId = streamResourceId;
  const updatedAt = typeof o.updated_at === 'number' && Number.isFinite(o.updated_at) ? o.updated_at : null;
  return { creds, updatedAt };
}

export function initialHubVoiceForm(state: HubVoiceConfigState): HubVoiceAdminForm {
  return {
    enabled: state.configured ? state.enabled : true,
    authMode: state.authMode,
    apiKey: '',
    appId: state.appId,
    accessToken: '',
    endpoint: state.endpoint,
    streamEndpoint: state.streamEndpoint,
    streamResourceId: state.streamResourceId,
  };
}

/** Pure form validator + payload builder for PUT /api/voice/config. */
export function mergeHubVoiceWrite(
  current: HubVoiceConfigState,
  form: HubVoiceAdminForm,
): { ok: true; body: HubVoiceWriteInput } | { ok: false; reasonKey: string } {
  const sameMode = current.configured && current.authMode === form.authMode;
  let appId = '';
  let secret = '';

  if (form.authMode === 'api-key') {
    secret = form.apiKey.trim();
    if (!secret && !sameMode) return { ok: false, reasonKey: 'hubVoice.err.apiKeyRequired' };
    if (secret && /[\s\x00-\x1f\x7f]/.test(secret)) return { ok: false, reasonKey: 'hubVoice.err.secretWhitespace' };
  } else {
    appId = form.appId.trim();
    if (!appId) return { ok: false, reasonKey: 'hubVoice.err.appIdRequired' };
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(appId)) return { ok: false, reasonKey: 'hubVoice.err.appIdInvalid' };
    secret = form.accessToken.trim();
    if (!secret && !sameMode) return { ok: false, reasonKey: 'hubVoice.err.tokenRequired' };
    if (secret && /[\s\x00-\x1f\x7f]/.test(secret)) return { ok: false, reasonKey: 'hubVoice.err.secretWhitespace' };
  }

  const endpoint = form.endpoint.trim();
  if (endpoint) {
    const ep = checkEndpoint(endpoint);
    if (!ep.ok) return { ok: false, reasonKey: 'hubVoice.err.endpointInvalid' };
    let parsed: URL;
    try { parsed = new URL(ep.url); } catch { return { ok: false, reasonKey: 'hubVoice.err.endpointInvalid' }; }
    if (parsed.username || parsed.password) return { ok: false, reasonKey: 'hubVoice.err.endpointInvalid' };
  }

  const streamEndpoint = form.streamEndpoint.trim();
  if (streamEndpoint) {
    const sep = checkStreamEndpoint(streamEndpoint);
    if (!sep.ok) return { ok: false, reasonKey: 'hubVoice.err.streamEndpointInvalid' };
    let parsed: URL;
    try { parsed = new URL(sep.url); } catch { return { ok: false, reasonKey: 'hubVoice.err.streamEndpointInvalid' }; }
    if (parsed.username || parsed.password) return { ok: false, reasonKey: 'hubVoice.err.streamEndpointInvalid' };
  }

  const rid = form.streamResourceId.trim();
  const normalizedRid = rid && rid !== STREAM_DEFAULT_RESOURCE_ID ? rid : '';
  if (normalizedRid && !isStreamResourceId(normalizedRid)) {
    return { ok: false, reasonKey: 'hubVoice.err.streamResourceInvalid' };
  }

  const body: HubVoiceWriteInput = {
    enabled: form.enabled,
    provider: 'doubao',
    auth_mode: form.authMode,
    app_id: appId,
    endpoint,
    stream_endpoint: streamEndpoint,
    stream_resource_id: normalizedRid,
  };
  if (secret) body.access_token = secret;
  return { ok: true, body };
}

// ── Reactive module-level store (volatile memory only; credentials NEVER hit localStorage) ──
let activeCfg: HubConfig | null = null;
let snapshot: HubVoiceConfigState = EMPTY_HUB_VOICE;
let cachedCreds: { scopeKey: string; updatedAt: number | null; creds: VoiceCredentials } | null = null;
let inflightCreds: Promise<VoiceCredentials | null> | null = null;
/** Monotonic generation bumped on scope switches & writes so stale in-flight GETs never overwrite newer state. */
let storeEpoch = 0;
const listeners = new Set<() => void>();
const unsupportedScopes = new Set<string>();

function emit(): void {
  for (const cb of [...listeners]) cb();
}

function clearCachedCreds(): void {
  cachedCreds = null;
  inflightCreds = null;
}

function setSnapshot(next: HubVoiceConfigState): void {
  if (!next.supported || !next.enabled || !next.configured || !next.canUse) {
    clearCachedCreds();
  } else if (cachedCreds && (cachedCreds.scopeKey !== next.scopeKey || cachedCreds.updatedAt !== next.updatedAt)) {
    clearCachedCreds();
  }
  if (
    snapshot.scopeKey === next.scopeKey &&
    snapshot.supported === next.supported &&
    snapshot.loaded === next.loaded &&
    snapshot.enabled === next.enabled &&
    snapshot.configured === next.configured &&
    snapshot.authMode === next.authMode &&
    snapshot.appId === next.appId &&
    snapshot.keyHint === next.keyHint &&
    snapshot.endpoint === next.endpoint &&
    snapshot.streamEndpoint === next.streamEndpoint &&
    snapshot.streamResourceId === next.streamResourceId &&
    snapshot.canUse === next.canUse &&
    snapshot.canManage === next.canManage &&
    snapshot.vaultReady === next.vaultReady &&
    snapshot.updatedAt === next.updatedAt
  ) {
    return;
  }
  snapshot = next;
  emit();
}

export function getActiveHubVoiceConfig(): HubConfig | null {
  return activeCfg;
}

export function getHubVoiceSnapshot(): HubVoiceConfigState {
  return snapshot;
}

export function getHubVoiceCredentials(): VoiceCredentials | null {
  if (!hubVoiceReady(snapshot) || !cachedCreds) return null;
  if (cachedCreds.scopeKey !== snapshot.scopeKey) return null;
  return cachedCreds.creds;
}

export function hubVoiceReady(s: HubVoiceConfigState = snapshot): boolean {
  return s.supported && s.enabled && s.configured && s.canUse;
}

export function subscribeHubVoice(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Test-only reset for clean unit test isolation. */
export function __resetHubVoiceForTest(): void {
  storeEpoch++;
  activeCfg = null;
  snapshot = EMPTY_HUB_VOICE;
  clearCachedCreds();
  unsupportedScopes.clear();
  emit();
}

/** Bind the currently active HubConfig (called by App.tsx on login/switch/logout). */
export function setActiveHubVoiceConfig(cfg: HubConfig | null, opts?: { fetchImpl?: HubVoiceFetchLike }): void {
  const nextScope = hubVoiceScopeKey(cfg);
  const prevScope = hubVoiceScopeKey(activeCfg);
  activeCfg = cfg;
  if (!cfg || !nextScope) {
    storeEpoch++;
    clearCachedCreds();
    setSnapshot(EMPTY_HUB_VOICE);
    return;
  }
  if (nextScope !== prevScope) {
    storeEpoch++;
    clearCachedCreds();
    setSnapshot({ ...EMPTY_HUB_VOICE, scopeKey: nextScope });
    void refreshHubVoiceConfig(cfg, opts);
  }
}

export async function fetchHubVoiceConfig(
  cfg: HubConfig,
  opts?: { fetchImpl?: HubVoiceFetchLike },
): Promise<HubVoiceConfigState> {
  const scopeKey = hubVoiceScopeKey(cfg);
  if (!scopeKey) return EMPTY_HUB_VOICE;
  const fetchImpl = opts?.fetchImpl ?? defaultFetch;
  try {
    const res = await fetchImpl(voiceUrl(cfg, '/api/voice/config'), {
      method: 'GET',
      headers: authHeaders(cfg),
    });
    if (res.status === 401) {
      reportProfileAuthResponse(401, profileIdOf(cfg), undefined, cfg.token);
      return { ...EMPTY_HUB_VOICE, scopeKey, loaded: true };
    }
    if (res.status === 404 || res.status === 405 || res.status === 501) {
      unsupportedScopes.add(scopeKey);
      return { ...EMPTY_HUB_VOICE, scopeKey, supported: false, loaded: true };
    }
    if (res.status < 200 || res.status >= 300) {
      return { ...EMPTY_HUB_VOICE, scopeKey, loaded: true };
    }
    const body = await res.json().catch(() => null);
    const parsed = parsePublicConfig(scopeKey, body);
    if (!parsed) return { ...EMPTY_HUB_VOICE, scopeKey, loaded: true };
    unsupportedScopes.delete(scopeKey);
    return parsed;
  } catch {
    return snapshot.scopeKey === scopeKey ? snapshot : { ...EMPTY_HUB_VOICE, scopeKey };
  }
}

/** Fetch decrypted Doubao credentials from Hub (GET /api/voice/credentials) and cache in memory only. */
export async function fetchHubVoiceCredentials(
  cfg: HubConfig,
  opts?: { fetchImpl?: HubVoiceFetchLike },
): Promise<VoiceCredentials | null> {
  const scopeKey = hubVoiceScopeKey(cfg);
  if (!scopeKey) return null;
  const reqEpoch = storeEpoch;
  const fetchImpl = opts?.fetchImpl ?? defaultFetch;
  try {
    const res = await fetchImpl(voiceUrl(cfg, '/api/voice/credentials'), {
      method: 'GET',
      headers: authHeaders(cfg),
    });
    if (res.status === 401) {
      reportProfileAuthResponse(401, profileIdOf(cfg), undefined, cfg.token);
      if (hubVoiceScopeKey(activeCfg) === scopeKey && reqEpoch === storeEpoch) clearCachedCreds();
      return null;
    }
    if (res.status === 404 || res.status === 405 || res.status === 501) {
      unsupportedScopes.add(scopeKey);
      if (hubVoiceScopeKey(activeCfg) === scopeKey && reqEpoch === storeEpoch) clearCachedCreds();
      return null;
    }
    if (res.status < 200 || res.status >= 300) {
      if (hubVoiceScopeKey(activeCfg) === scopeKey && reqEpoch === storeEpoch) {
        if (res.status === 409) {
          clearCachedCreds();
          setSnapshot({ ...snapshot, enabled: false });
        } else if (res.status === 403) {
          clearCachedCreds();
          setSnapshot({ ...snapshot, canUse: false });
        }
      }
      return null;
    }
    const body = await res.json().catch(() => null);
    const parsed = parseIssuedCredentials(body);
    if (!parsed) return null;
    if (hubVoiceScopeKey(activeCfg) === scopeKey && reqEpoch === storeEpoch) {
      cachedCreds = { scopeKey, updatedAt: parsed.updatedAt ?? snapshot.updatedAt, creds: parsed.creds };
    }
    return parsed.creds;
  } catch {
    return null;
  }
}

/** Return in-memory Hub-issued credentials, fetching once on demand if enabled and not yet cached. */
export async function ensureHubVoiceCredentials(
  cfg: HubConfig | null = activeCfg,
  opts?: { fetchImpl?: HubVoiceFetchLike },
): Promise<VoiceCredentials | null> {
  const target = cfg ?? activeCfg;
  const scopeKey = hubVoiceScopeKey(target);
  if (!target || !scopeKey || !hubVoiceReady(snapshot) || snapshot.scopeKey !== scopeKey) return null;
  if (cachedCreds && cachedCreds.scopeKey === scopeKey && cachedCreds.updatedAt === snapshot.updatedAt) {
    return cachedCreds.creds;
  }
  if (inflightCreds) return inflightCreds;
  const req = fetchHubVoiceCredentials(target, opts).finally(() => {
    if (inflightCreds === req) inflightCreds = null;
  });
  inflightCreds = req;
  return req;
}

export async function refreshHubVoiceConfig(
  cfg: HubConfig | null = activeCfg,
  opts?: { fetchImpl?: HubVoiceFetchLike; force?: boolean },
): Promise<HubVoiceConfigState> {
  const target = cfg ?? activeCfg;
  const scopeKey = hubVoiceScopeKey(target);
  if (!target || !scopeKey) {
    clearCachedCreds();
    setSnapshot(EMPTY_HUB_VOICE);
    return EMPTY_HUB_VOICE;
  }
  if (!opts?.force && unsupportedScopes.has(scopeKey)) {
    const unsupported = { ...EMPTY_HUB_VOICE, scopeKey, supported: false, loaded: true };
    if (hubVoiceScopeKey(activeCfg) === scopeKey) setSnapshot(unsupported);
    return unsupported;
  }
  const reqEpoch = storeEpoch;
  const next = await fetchHubVoiceConfig(target, opts);
  // Ignore stale in-flight GET if an admin write or account switch happened meanwhile.
  if (hubVoiceScopeKey(activeCfg) === scopeKey && reqEpoch === storeEpoch) {
    setSnapshot(next);
    // Warm in-memory credentials in the background so pressing hold-to-talk has zero extra Hub RTT.
    if (hubVoiceReady(next) && (!cachedCreds || cachedCreds.scopeKey !== scopeKey || cachedCreds.updatedAt !== next.updatedAt)) {
      void ensureHubVoiceCredentials(target, opts);
    }
  }
  return reqEpoch === storeEpoch ? next : snapshot;
}

export async function saveHubVoiceConfig(
  cfg: HubConfig,
  input: HubVoiceWriteInput,
  opts?: { fetchImpl?: HubVoiceFetchLike },
): Promise<{ ok: true; state: HubVoiceConfigState } | { ok: false; error: string; message: string }> {
  const scopeKey = hubVoiceScopeKey(cfg);
  const fetchImpl = opts?.fetchImpl ?? defaultFetch;
  try {
    const res = await fetchImpl(voiceUrl(cfg, '/api/voice/config'), {
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
        if (hubVoiceScopeKey(activeCfg) === scopeKey) {
          storeEpoch++;
          clearCachedCreds();
          setSnapshot(parsed);
          if (hubVoiceReady(parsed)) void ensureHubVoiceCredentials(cfg, opts);
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

export async function clearHubVoiceConfig(
  cfg: HubConfig,
  opts?: { fetchImpl?: HubVoiceFetchLike },
): Promise<{ ok: true; state: HubVoiceConfigState } | { ok: false; error: string; message: string }> {
  const scopeKey = hubVoiceScopeKey(cfg);
  const fetchImpl = opts?.fetchImpl ?? defaultFetch;
  try {
    const res = await fetchImpl(voiceUrl(cfg, '/api/voice/config'), {
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
        if (hubVoiceScopeKey(activeCfg) === scopeKey) {
          storeEpoch++;
          clearCachedCreds();
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
