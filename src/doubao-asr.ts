// 豆包语音「大模型录音文件识别极速版」客户端(火山引擎 docs 6561/1631584)。
//
//   POST https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash
//   headers: X-Api-App-Key + X-Api-Access-Key(旧版控制台)| X-Api-Key(新版控制台)
//            X-Api-Resource-Id: volc.bigasr.auc_turbo · X-Api-Request-Id: uuid · X-Api-Sequence: -1
//   body:    { user:{uid}, audio:{data:<base64>, format:"wav"}, request:{model_name:"bigmodel"} }
//   结果:    响应头 X-Api-Status-Code(20000000 成功 / 20000003 静音)+ body.result.text
//
// 为什么三端都用它,而不是手机上走流式 WebSocket:一句话 ≤60 s,一次请求一次返回,
// 不需要自己实现二进制分帧协议;桌面 webview 的 WebSocket 设不了鉴权头,但 REST 走
// Tauri plugin-http(app-fetch.ts)可以带头也不受 CORS 限制;RN 的 fetch 本来就能带头。
// 一个客户端、一个接口,三端同一条路径。
//
// 🔴 不打日志;错误对象里只放错误码和上游的**数字**状态码,从不放响应体、请求头或音频
// (网关可能把凭据回显在响应体里)。

import type { VoiceCredentials } from './voice-credentials-model';
import { DOUBAO_DEFAULT_ENDPOINT, authMode, checkEndpoint, type VoiceAuthMode } from './voice-credentials-model';
import { bytesToBase64 } from './voice-wav';

export const DOUBAO_RESOURCE_ID = 'volc.bigasr.auc_turbo';
/** 一句话的上限(秒)。按住说话满 60 s 自动松开。 */
export const MAX_UTTERANCE_SECONDS = 60;
/** 太短当误触(微信也是 <1 s 提示「说话时间太短」)。 */
export const MIN_UTTERANCE_SECONDS = 0.6;
/** 16 kHz 16-bit 单声道 60 s = 1.92 MB;留余量,超过就拒发。 */
export const MAX_WAV_BYTES = 2_500_000;
export const REQUEST_TIMEOUT_MS = 20_000;

export type AsrErrorCode =
  | 'not_configured'
  /** HTTP 401:密钥不对。 */
  | 'auth_failed'
  /** HTTP 403:密钥对,但这个资源(极速版)没开通 ——「requested resource not granted」。 */
  | 'not_enabled'
  | 'too_long'
  | 'too_short'
  | 'bad_audio'
  | 'rate_limited'
  | 'upstream_error'
  | 'network'
  | 'timeout'
  | 'bad_endpoint';

export class AsrError extends Error {
  constructor(public readonly code: AsrErrorCode, public readonly upstream?: string) {
    // 🔴 message 只由错误码 + 数字状态码组成。
    super(upstream ? `${code} (${upstream})` : code);
    this.name = 'AsrError';
  }
}

/** 鉴权失败的一句话:按控制台版本点名是哪个字段不对。 */
export function authFailedMessage(mode?: VoiceAuthMode): string {
  if (mode === 'app-token') return '鉴权失败：App ID 或 Access Token 不对';
  return '鉴权失败：API Key 不对';
}

/** 服务未开通的一句话:点名控制台里的服务名和资源 ID。 */
export function notEnabledMessage(service: string, resourceId: string): string {
  return `服务未开通：请在开通管理里开通 ${service}（资源 ID ${resourceId}）`;
}

export const FLASH_SERVICE_NAME = '录音文件识别大模型-极速版';

/**
 * 给用户看的一句话。
 * 401 / 403 的区分:文档错误码表(docs 6561/1631584、6561/1354869)只列了 2000xxxx / 4500xxxx /
 * 5500xxxx 业务码,没有鉴权码;鉴权在网关层按 HTTP 状态回 —— 403 的响应体是
 * `[resource_id=…] requested resource not granted`(密钥有效、资源没开通),401 是密钥本身无效。
 */
export function asrErrorMessage(code: AsrErrorCode, upstream?: string, mode?: VoiceAuthMode): string {
  switch (code) {
    case 'not_configured': return '未配置语音识别';
    case 'auth_failed': return authFailedMessage(mode);
    case 'not_enabled': return notEnabledMessage(FLASH_SERVICE_NAME, DOUBAO_RESOURCE_ID);
    case 'too_long': return `一次最多说 ${MAX_UTTERANCE_SECONDS} 秒`;
    case 'too_short': return '说话时间太短';
    case 'bad_audio': return '音频格式不被接受';
    case 'rate_limited': return '语音识别请求太频繁,稍后再试';
    case 'timeout': return '网络失败：语音识别超时，请重试';
    case 'network': return '网络失败：连不上语音识别服务，检查网络';
    case 'bad_endpoint': return '语音识别接口地址无效';
    default: return upstream ? `语音识别失败(${upstream})` : '语音识别失败';
  }
}

export type FlashRequest = { url: string; headers: Record<string, string>; body: string };

export function buildFlashRequest(creds: VoiceCredentials, wavBase64: string, requestId: string): FlashRequest {
  const ep = checkEndpoint(creds.endpoint || '');
  if (!ep.ok) throw new AsrError('bad_endpoint');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Api-Resource-Id': DOUBAO_RESOURCE_ID,
    'X-Api-Request-Id': requestId,
    'X-Api-Sequence': '-1',
  };
  if (authMode(creds) === 'app-token') {
    headers['X-Api-App-Key'] = creds.appId;
    headers['X-Api-Access-Key'] = creds.accessToken;
  } else {
    headers['X-Api-Key'] = creds.accessToken;
  }
  const body = JSON.stringify({
    user: { uid: 'agent-network-app' },
    audio: { data: wavBase64, format: 'wav' },
    request: { model_name: 'bigmodel', enable_itn: true, enable_punc: true },
  });
  return { url: ep.url || DOUBAO_DEFAULT_ENDPOINT, headers, body };
}

const digits = (s: string | null | undefined): string | undefined => {
  const t = (s ?? '').trim();
  return /^\d{1,12}$/.test(t) ? t : undefined;
};

/**
 * HTTP 状态 + X-Api-Status-Code + 解析后的 body → 文本或错误码。纯函数,便于穷举测试。
 * 静音(20000003)和空音频(45000002)返回空串:不是错误,界面提示「没有识别到文字」。
 */
export function interpretFlashResponse(httpStatus: number, apiStatus: string | null | undefined, body: unknown): { text: string } | { error: AsrErrorCode; upstream?: string } {
  const code = digits(apiStatus);
  if (httpStatus === 401) return { error: 'auth_failed', upstream: '401' };
  if (httpStatus === 403) return { error: 'not_enabled', upstream: '403' };
  if (httpStatus === 429) return { error: 'rate_limited', upstream: '429' };
  if (code === '20000003' || code === '45000002') return { text: '' };
  if (code === '45000151') return { error: 'bad_audio', upstream: code };
  if (code === '55000031') return { error: 'rate_limited', upstream: code };
  if (httpStatus >= 200 && httpStatus < 300 && code === '20000000') {
    const text = (body as { result?: { text?: unknown } } | null)?.result?.text;
    if (typeof text !== 'string') return { error: 'upstream_error', upstream: 'no_text' };
    return { text: text.trim() };
  }
  // 鉴权失败有时是 HTTP 200/400 + 4500xxxx 以外的码;只把数字带出去。
  return { error: 'upstream_error', upstream: code ?? (httpStatus ? String(httpStatus) : undefined) };
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

const newRequestId = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const h = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${h()}${h()}-${h()}-4${h().slice(1)}-a${h().slice(1)}-${h()}${h()}${h()}`;
};

/** WAV 字节 → 识别文本。凭据缺失、超长、网络、超时、上游错误都抛 AsrError。 */
export async function transcribeWav(
  creds: VoiceCredentials | null,
  wav: Uint8Array,
  opts: { fetchImpl: FetchLike; timeoutMs?: number; requestId?: string },
): Promise<string> {
  if (!creds || !creds.accessToken) throw new AsrError('not_configured');
  if (wav.length > MAX_WAV_BYTES) throw new AsrError('too_long');
  const req = buildFlashRequest(creds, bytesToBase64(wav), opts.requestId ?? newRequestId());
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { ctrl?.abort(); reject(new AsrError('timeout')); }, timeoutMs);
  });
  try {
    const res = await Promise.race([
      opts.fetchImpl(req.url, { method: 'POST', headers: req.headers, body: req.body, signal: ctrl?.signal }),
      timeout,
    ]);
    let body: unknown = null;
    try { body = await Promise.race([res.json(), timeout]); } catch (e) { if (e instanceof AsrError) throw e; body = null; }
    const out = interpretFlashResponse(res.status, res.headers.get('X-Api-Status-Code'), body);
    if ('error' in out) throw new AsrError(out.error, out.upstream);
    return out.text;
  } catch (e) {
    if (e instanceof AsrError) throw e;
    // 🔴 原始异常可能带 URL/头;不透传 message。
    throw new AsrError('network');
  } finally {
    if (timer) clearTimeout(timer);
  }
}
