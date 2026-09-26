// 语音输入凭据的纯模型:形状、校验、保存时的合并、界面上的打码。
//
// 🔴 凭据只存本机(安卓/iOS = SecureStore → Keystore/Keychain;桌面 = 系统钥匙串,
// 与登录 token 同一个 keyring service),不上传 hub。界面**保存之后永远不回显**
// Access Token / Secret Key 的全文,只显示「已配置 ✓ …a1b2」。
//
// 两种控制台(豆包语音 docs 6561/1631584):
//   · 旧版控制台:App ID + Access Token → X-Api-App-Key + X-Api-Access-Key
//   · 新版控制台:只有一个 API Key → X-Api-Key。此时 App ID 留空、把 API Key 填进 Access Token。
// Secret Key 极速版接口用不到,可留空;保留这一栏是因为旧控制台把三样摆在一起,用户会照着填。
//
// 纯逻辑,不 import react-native。

export const DOUBAO_DEFAULT_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash';

export type VoiceCredentials = {
  appId: string;
  accessToken: string;
  secretKey: string;
  /** 空 = 官方默认地址。只在「高级」里改(自建转发 / 本地假服务做验收)。 */
  endpoint: string;
};

export type VoiceAuthMode = 'app-token' | 'api-key';

export type VoiceConfigStatus =
  | { configured: false }
  | { configured: true; mode: VoiceAuthMode; tokenTail: string; appId: string; hasSecretKey: boolean; customEndpoint: boolean };

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** 从存储里读出来的东西(可能是旧版本/手改/损坏)→ 规整形状;不合法返回 null。 */
export function parseVoiceCredentials(raw: string | null | undefined): VoiceCredentials | null {
  if (!raw) return null;
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return null; }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const creds: VoiceCredentials = { appId: str(o.appId), accessToken: str(o.accessToken), secretKey: str(o.secretKey), endpoint: str(o.endpoint) };
  return creds.accessToken ? creds : null;
}

export function authMode(creds: Pick<VoiceCredentials, 'appId'>): VoiceAuthMode {
  return creds.appId ? 'app-token' : 'api-key';
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
    tokenTail: maskTail(creds.accessToken),
    appId: creds.appId,
    hasSecretKey: !!creds.secretKey,
    customEndpoint: !!creds.endpoint,
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
 * Access Token 发给链路上的所有人。唯一例外是回环地址(本机假服务/本机转发)。
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

export type VoiceForm = { appId: string; accessToken: string; secretKey: string; endpoint: string };

export type SaveResult = { ok: true; creds: VoiceCredentials } | { ok: false; reason: string };

/**
 * 点「保存」:表单 + 已存的 → 要写入的。
 * 密钥栏**从不预填**(不回显),所以「密钥栏留空」的意思是「不改」,不是「清空」;
 * 清空走单独的「清除」按钮。App ID 与接口地址不是密钥,会预填,表单里是什么就存什么。
 */
export function mergeOnSave(existing: VoiceCredentials | null, form: VoiceForm): SaveResult {
  const accessToken = form.accessToken.trim() || existing?.accessToken || '';
  if (!accessToken) return { ok: false, reason: '请填写 Access Token(新版控制台填 API Key)' };
  if (/\s/.test(accessToken)) return { ok: false, reason: 'Access Token 里不能有空格或换行' };
  const appId = form.appId.trim();
  if (appId && !/^[A-Za-z0-9_-]{1,64}$/.test(appId)) return { ok: false, reason: 'App ID 只能是字母、数字、- 或 _' };
  const secretKey = form.secretKey.trim() || existing?.secretKey || '';
  const endpoint = form.endpoint.trim();
  const ep = checkEndpoint(endpoint);
  if (!ep.ok) return { ok: false, reason: ep.reason };
  return { ok: true, creds: { appId, accessToken, secretKey, endpoint: endpoint ? ep.url : '' } };
}

/** 设置页打开时表单的初值:非密钥字段带出来,密钥字段一律空。 */
export function initialForm(existing: VoiceCredentials | null): VoiceForm {
  return { appId: existing?.appId ?? '', accessToken: '', secretKey: '', endpoint: existing?.endpoint ?? '' };
}
