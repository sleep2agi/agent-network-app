// #5653 — Hub 统一配置语音输入（ASR）客户端逻辑与模块级状态。
//
// 设计要点：
// - 只从 Hub 读取脱敏状态（enabled / configured / keyHint / canManage），客户端永不拿到服务器明文密钥。
// - 未配本地个人 Key 且当前网络已启用 Hub 语音时，录音整段 WAV 通过 POST /api/voice/recognize
//   由 Hub 代为调用豆包极速版并返回识别文本 —— 全平台（含鸿蒙/网页）零配置开箱即用。
// - 旧版 Hub 返回 404/405/501 时静默降级为 supported=false，不报错、不反复轮询。
// - 严格按 (serverUrl, networkId, token) 隔离状态，切账号/切网络/登出立刻清空旧快照。
// - 🔴 不打任何 console.* 日志（音频与密钥安全红线）。

import type { HubConfig } from './api';
import { appFetch } from './app-fetch';
import { AsrError, MAX_WAV_BYTES, REQUEST_TIMEOUT_MS, type AsrErrorCode } from './doubao-asr';
import { bytesToBase64 } from './voice-wav';
import { reportProfileAuthResponse } from './profile-auth-state';
import { LEGACY_SESSION_ID } from './session-registry';

export type HubVoiceAuthMode = 'api-key' | 'app-token';

export type HubVoiceConfigState = {
  scopeKey: string;
  supported: boolean;
  loaded: boolean;
  enabled: boolean;
  configured: boolean;
  mode: 'hub-proxy';
  provider: 'doubao';
  authMode: HubVoiceAuthMode;
  appId: string;
  keyHint: string;
  endpoint: string;
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
};

export type HubVoiceWriteInput = {
  enabled: boolean;
  provider: 'doubao';
  auth_mode: HubVoiceAuthMode;
  app_id: string;
  access_token?: string;
  endpoint: string;
};

export type HubVoiceFetchLike = (
  url: string,
  init: { method?: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{
  status: number;
  ok?: boolean;
  json(): Promise<unknown>;
}>;

const KNOWN_ASR_CODES = new Set<AsrErrorCode>([
  'not_configured',
  'too_long',
  'auth_failed',
  'not_enabled',
  'rate_limited',
  'bad_audio',
  'timeout',
  'network',
  'upstream_error',
]);

export const EMPTY_HUB_VOICE: HubVoiceConfigState = {
  scopeKey: '',
  supported: false,
  loaded: false,
  enabled: false,
  configured: false,
  mode: 'hub-proxy',
  provider: 'doubao',
  authMode: 'api-key',
  appId: '',
  keyHint: '',
  endpoint: '',
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
  if (o.ok !== true) return null;
  const configured = o.configured === true;
  const enabled = configured && o.enabled === true;
  const authMode: HubVoiceAuthMode = o.auth_mode === 'app-token' ? 'app-token' : 'api-key';
  return {
    scopeKey,
    supported: true,
    loaded: true,
    enabled,
    configured,
    mode: 'hub-proxy',
    provider: 'doubao',
    authMode,
    appId: typeof o.app_id === 'string' ? o.app_id : '',
    keyHint: typeof o.key_hint === 'string' ? o.key_hint : '',
    endpoint: typeof o.endpoint === 'string' ? o.endpoint : '',
    canManage: o.can_manage === true,
    vaultReady: o.vault_ready !== false,
    updatedAt: typeof o.updated_at === 'number' && Number.isFinite(o.updated_at) ? o.updated_at : null,
  };
}

export function initialHubVoiceForm(state: HubVoiceConfigState): HubVoiceAdminForm {
  return {
    enabled: state.configured ? state.enabled : true,
    authMode: state.authMode,
    apiKey: '',
    appId: state.appId,
    accessToken: '',
    endpoint: state.endpoint,
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
    let parsed: URL;
    try { parsed = new URL(endpoint); } catch { return { ok: false, reasonKey: 'hubVoice.err.endpointInvalid' }; }
    const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
    if (parsed.username || parsed.password || (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback))) {
      return { ok: false, reasonKey: 'hubVoice.err.endpointInvalid' };
    }
  }

  const body: HubVoiceWriteInput = {
    enabled: form.enabled,
    provider: 'doubao',
    auth_mode: form.authMode,
    app_id: appId,
    endpoint,
  };
  if (secret) body.access_token = secret;
  return { ok: true, body };
}

// ── Reactive module-level store ──
let activeCfg: HubConfig | null = null;
let snapshot: HubVoiceConfigState = EMPTY_HUB_VOICE;
const listeners = new Set<() => void>();
const unsupportedScopes = new Set<string>();

function emit(): void {
  for (const cb of [...listeners]) cb();
}

function setSnapshot(next: HubVoiceConfigState): void {
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

export function hubVoiceReady(s: HubVoiceConfigState = snapshot): boolean {
  return s.supported && s.enabled && s.configured;
}

export function subscribeHubVoice(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Test-only reset for clean unit test isolation. */
export function __resetHubVoiceForTest(): void {
  activeCfg = null;
  snapshot = EMPTY_HUB_VOICE;
  unsupportedScopes.clear();
  emit();
}

/** Bind the currently active HubConfig (called by App.tsx on login/switch/logout). */
export function setActiveHubVoiceConfig(cfg: HubConfig | null, opts?: { fetchImpl?: HubVoiceFetchLike }): void {
  const nextScope = hubVoiceScopeKey(cfg);
  const prevScope = hubVoiceScopeKey(activeCfg);
  activeCfg = cfg;
  if (!cfg || !nextScope) {
    setSnapshot(EMPTY_HUB_VOICE);
    return;
  }
  if (nextScope !== prevScope) {
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
    // Transient network error: keep previous state if same scope, else mark loaded=false.
    return snapshot.scopeKey === scopeKey ? snapshot : { ...EMPTY_HUB_VOICE, scopeKey };
  }
}

export async function refreshHubVoiceConfig(
  cfg: HubConfig | null = activeCfg,
  opts?: { fetchImpl?: HubVoiceFetchLike; force?: boolean },
): Promise<HubVoiceConfigState> {
  const target = cfg ?? activeCfg;
  const scopeKey = hubVoiceScopeKey(target);
  if (!target || !scopeKey) {
    setSnapshot(EMPTY_HUB_VOICE);
    return EMPTY_HUB_VOICE;
  }
  if (!opts?.force && unsupportedScopes.has(scopeKey)) {
    const unsupported = { ...EMPTY_HUB_VOICE, scopeKey, supported: false, loaded: true };
    if (hubVoiceScopeKey(activeCfg) === scopeKey) setSnapshot(unsupported);
    return unsupported;
  }
  const next = await fetchHubVoiceConfig(target, opts);
  if (hubVoiceScopeKey(activeCfg) === scopeKey) {
    setSnapshot(next);
  }
  return next;
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
        if (hubVoiceScopeKey(activeCfg) === scopeKey) setSnapshot(parsed);
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
        if (hubVoiceScopeKey(activeCfg) === scopeKey) setSnapshot(parsed);
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

const cleanDigits = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return /^\d{1,12}$/.test(t) ? t : undefined;
};

/** Transcribe recorded WAV bytes via Hub proxy (POST /api/voice/recognize). */
export async function transcribeViaHub(
  cfg: HubConfig | null,
  wav: Uint8Array,
  opts?: { fetchImpl?: HubVoiceFetchLike; timeoutMs?: number },
): Promise<string> {
  if (!cfg || !cfg.serverUrl || !cfg.token) throw new AsrError('not_configured');
  if (wav.length > MAX_WAV_BYTES) throw new AsrError('too_long');
  const fetchImpl = opts?.fetchImpl ?? defaultFetch;
  const timeoutMs = opts?.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { ctrl?.abort(); reject(new AsrError('timeout')); }, timeoutMs);
  });

  const payload = JSON.stringify({
    wav_base64: bytesToBase64(wav),
    format: 'wav',
    ...(cfg.networkId ? { network_id: cfg.networkId } : {}),
  });

  try {
    const res = await Promise.race([
      fetchImpl(voiceUrl(cfg, '/api/voice/recognize'), {
        method: 'POST',
        headers: authHeaders(cfg, true),
        body: payload,
        signal: ctrl?.signal,
      }),
      timeout,
    ]);
    if (res.status === 401) {
      reportProfileAuthResponse(401, profileIdOf(cfg), undefined, cfg.token);
      throw new AsrError('auth_failed', '401');
    }
    let body: Record<string, unknown> | null = null;
    try {
      const parsed = await Promise.race([res.json(), timeout]);
      if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
    } catch (e) {
      if (e instanceof AsrError) throw e;
      body = null;
    }

    if (res.status >= 200 && res.status < 300 && body?.ok === true && typeof body.text === 'string') {
      return body.text.trim();
    }

    const rawCode = typeof body?.code === 'string' ? body.code : '';
    const upstream = cleanDigits(body?.upstream);
    if (KNOWN_ASR_CODES.has(rawCode as AsrErrorCode)) {
      throw new AsrError(rawCode as AsrErrorCode, upstream);
    }
    if (res.status === 413) throw new AsrError('too_long');
    if (res.status === 429) throw new AsrError('rate_limited', '429');
    if (res.status === 404 || res.status === 405 || res.status === 501 || res.status === 409) {
      throw new AsrError('not_configured');
    }
    if (res.status === 504) throw new AsrError('timeout');
    throw new AsrError('upstream_error', upstream ?? (res.status ? String(res.status) : undefined));
  } catch (e) {
    if (e instanceof AsrError) throw e;
    throw new AsrError('network');
  } finally {
    if (timer) clearTimeout(timer);
  }
}
