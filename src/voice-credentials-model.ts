// 语音输入凭据的纯模型:形状、校验、保存时的合并、界面上的打码。
//
// 🔴 凭据只存本机(安卓/iOS = SecureStore → Keystore/Keychain;桌面 = 系统钥匙串,
// 与登录 token 同一个 keyring service),不上传 hub。界面**保存之后永远不回显**
// API Key / Access Token 的全文,只显示「已配置 ✓ …a1b2」。
//
// 两种控制台(豆包语音 docs 6561/1631584 极速版、6561/1354869 流式,鉴权表两边相同):
//   · 新版控制台(默认):只有一个 API Key → X-Api-Key。
//   · 旧版控制台:App ID + Access Token → X-Api-App-Key + X-Api-Access-Key。
// 存储形状沿用 0.2.112:新版 = appId 为空、API Key 存在 accessToken 里 —— 于是
// 「App ID 空 + 有 token」的旧存档读出来天然就是新版,不需要迁移步骤。
// Secret Key 两个接口都用不到,0.2.112 的界面曾让人填:读的时候丢掉,且 load 时静默重写一次存档。
//
// 纯逻辑,不 import react-native。

import { isStreamResourceId, STREAM_DEFAULT_ENDPOINT, STREAM_DEFAULT_RESOURCE_ID } from './doubao-stream-protocol';

export const DOUBAO_DEFAULT_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash';
export const VOLC_CONSOLE_URL = 'https://console.volcengine.com/speech/app';

export type VoiceCredentials = {
  /** 旧版控制台的 App ID;新版控制台为空。 */
  appId: string;
  /** 新版:API Key;旧版:Access Token。 */
  accessToken: string;
  /** 空 = 官方默认地址。只在「高级」里改(自建转发 / 本地假服务做验收)。 */
  endpoint: string;
  /** 流式识别(WebSocket)地址。空 / 缺省 = 官方 wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async。 */
  streamEndpoint?: string;
  /** 流式资源 ID(控制台开通的是哪一种)。空 / 缺省 = volc.bigasr.sauc.duration(1.0 小时版)。 */
  streamResourceId?: string;
};

export type VoiceAuthMode = 'app-token' | 'api-key';
/** 设置页的第一个选择:控制台版本。 */
export type VoiceConsole = 'new' | 'old';

export const CONSOLE_LABELS: Record<VoiceConsole, string> = {
  new: '新版（API Key）',
  old: '旧版（App ID + Access Token）',
};

export type VoiceConfigStatus =
  | { configured: false }
  | { configured: true; mode: VoiceAuthMode; console: VoiceConsole; tokenTail: string; appId: string; customEndpoint: boolean; customStreamEndpoint: boolean; streamResourceId: string };

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** 从存储里读出来的东西(可能是旧版本/手改/损坏)→ 规整形状;不合法返回 null。 */
export function parseVoiceCredentials(raw: string | null | undefined): VoiceCredentials | null {
  if (!raw) return null;
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return null; }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const creds: VoiceCredentials = { appId: str(o.appId), accessToken: str(o.accessToken), endpoint: str(o.endpoint) };
  // 流式两栏是后加的:只在有值时带上。
  const streamEndpoint = str(o.streamEndpoint);
  const streamResourceId = str(o.streamResourceId);
  if (streamEndpoint) creds.streamEndpoint = streamEndpoint;
  if (isStreamResourceId(streamResourceId)) creds.streamResourceId = streamResourceId;
  return creds.accessToken ? creds : null;
}

/** 存档里还留着 0.2.112 的 Secret Key(或其他已废弃字段)→ 需要静默重写一次。 */
export function needsScrub(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    return !!o && typeof o === 'object' && 'secretKey' in o;
  } catch { return false; }
}

export function authMode(creds: Pick<VoiceCredentials, 'appId'>): VoiceAuthMode {
  return creds.appId ? 'app-token' : 'api-key';
}

export function consoleOf(creds: Pick<VoiceCredentials, 'appId'> | null): VoiceConsole {
  return creds && creds.appId ? 'old' : 'new';
}

/**
 * 打码:只露最后 4 位。短于 8 位的值露 4 位就等于露了一半,那种只显示「…」。
 * 🔴 这是界面上**唯一**能看到密钥内容的地方。
 */
export function maskTail(secret: string): string {
  const s = secret.trim();
  if (!s) return '';
  if (s.length < 8) return '…';
  return `…${s.slice(-4)}`;
}

export function voiceConfigStatus(creds: VoiceCredentials | null): VoiceConfigStatus {
  if (!creds || !creds.accessToken) return { configured: false };
  return {
    configured: true,
    mode: authMode(creds),
    console: consoleOf(creds),
    tokenTail: maskTail(creds.accessToken),
    appId: creds.appId,
    customEndpoint: !!creds.endpoint,
    customStreamEndpoint: !!creds.streamEndpoint,
    streamResourceId: creds.streamResourceId || STREAM_DEFAULT_RESOURCE_ID,
  };
}

/** 「已配置 ✓ …a1b2」这一行。 */
export function statusLabel(status: VoiceConfigStatus): string {
  if (!status.configured) return '未配置';
  return `已配置 ✓ ${status.tokenTail}`;
}

export type EndpointCheck = { ok: true; url: string } | { ok: false; reason: string };

const isLoopbackHost = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';

/**
 * 接口地址校验:空 = 官方默认。必须 https —— 凭据在请求头里,明文 http 等于把
 * 密钥发给链路上的所有人。唯一例外是回环地址(本机假服务/本机转发)。
 */
export function checkEndpoint(input: string): EndpointCheck {
  const s = input.trim();
  if (!s) return { ok: true, url: DOUBAO_DEFAULT_ENDPOINT };
  let u: URL;
  try { u = new URL(s); } catch { return { ok: false, reason: '接口地址不是合法的 URL' }; }
  if (u.protocol === 'https:') return { ok: true, url: u.toString() };
  if (u.protocol === 'http:' && isLoopbackHost(u.hostname)) return { ok: true, url: u.toString() };
  return { ok: false, reason: '接口地址必须是 https://(本机回环地址除外)' };
}

/**
 * 流式地址:空 = 官方默认。必须 wss —— 鉴权头在握手请求里,明文 ws 等于把密钥
 * 发给链路上的所有人。唯一例外是回环地址(本机假服务)。
 */
export function checkStreamEndpoint(input: string): EndpointCheck {
  const s = input.trim();
  if (!s) return { ok: true, url: STREAM_DEFAULT_ENDPOINT };
  let u: URL;
  try { u = new URL(s); } catch { return { ok: false, reason: '流式接口地址不是合法的 URL' }; }
  if (u.protocol === 'wss:') return { ok: true, url: u.toString() };
  if (u.protocol === 'ws:' && isLoopbackHost(u.hostname)) return { ok: true, url: u.toString() };
  return { ok: false, reason: '流式接口地址必须是 wss://(本机回环地址除外)' };
}

export type VoiceForm = {
  console: VoiceConsole;
  /** 新版:API Key(密钥,不预填)。 */
  apiKey: string;
  /** 旧版:App ID(不是密钥,预填)。 */
  appId: string;
  /** 旧版:Access Token(密钥,不预填)。 */
  accessToken: string;
  endpoint: string;
  streamEndpoint: string;
  streamResourceId: string;
};

export type SaveResult = { ok: true; creds: VoiceCredentials } | { ok: false; reason: string };

/**
 * 点「保存」:表单 + 已存的 → 要写入的。
 * 密钥栏**从不预填**(不回显),所以「密钥栏留空」的意思是「不改」,不是「清空」;
 * 清空走单独的「清除」按钮。但**换了控制台版本**时旧密钥不沿用:旧版的 Access Token
 * 当不了新版的 API Key,反过来也一样 —— 必须填新的。
 */
export function mergeOnSave(existing: VoiceCredentials | null, form: VoiceForm): SaveResult {
  const sameConsole = !!existing && consoleOf(existing) === form.console;
  let appId = '';
  let accessToken: string;
  if (form.console === 'new') {
    accessToken = form.apiKey.trim() || (sameConsole ? existing!.accessToken : '');
    if (!accessToken) return { ok: false, reason: '请填写 API Key' };
    if (/\s/.test(accessToken)) return { ok: false, reason: 'API Key 里不能有空格或换行' };
  } else {
    appId = form.appId.trim();
    if (!appId) return { ok: false, reason: '请填写 App ID' };
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(appId)) return { ok: false, reason: 'App ID 只能是字母、数字、- 或 _' };
    accessToken = form.accessToken.trim() || (sameConsole ? existing!.accessToken : '');
    if (!accessToken) return { ok: false, reason: '请填写 Access Token' };
    if (/\s/.test(accessToken)) return { ok: false, reason: 'Access Token 里不能有空格或换行' };
  }
  const endpoint = form.endpoint.trim();
  const ep = checkEndpoint(endpoint);
  if (!ep.ok) return { ok: false, reason: ep.reason };
  const creds: VoiceCredentials = { appId, accessToken, endpoint: endpoint ? ep.url : '' };
  const streamEndpoint = form.streamEndpoint.trim();
  if (streamEndpoint) {
    const sep = checkStreamEndpoint(streamEndpoint);
    if (!sep.ok) return { ok: false, reason: sep.reason };
    creds.streamEndpoint = sep.url;
  }
  const rid = form.streamResourceId.trim();
  if (rid && rid !== STREAM_DEFAULT_RESOURCE_ID) {
    if (!isStreamResourceId(rid)) return { ok: false, reason: '流式资源 ID 不是控制台提供的四种之一' };
    creds.streamResourceId = rid;
  }
  return { ok: true, creds };
}

/** 设置页打开时表单的初值:非密钥字段带出来,密钥字段一律空。没存过 = 新版。 */
export function initialForm(existing: VoiceCredentials | null): VoiceForm {
  return {
    console: consoleOf(existing),
    apiKey: '',
    appId: existing?.appId ?? '',
    accessToken: '',
    endpoint: existing?.endpoint ?? '',
    streamEndpoint: existing?.streamEndpoint ?? '',
    streamResourceId: existing?.streamResourceId ?? '',
  };
}
