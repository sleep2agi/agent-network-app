// ck-style (self-executing; run by scripts/run-tests.mjs). 豆包「录音文件识别极速版」客户端,上游全部 mock。
import { AsrError, asrErrorMessage, buildFlashRequest, DOUBAO_RESOURCE_ID, interpretFlashResponse, MAX_WAV_BYTES, transcribeWav, type FetchLike } from './doubao-asr';
import { DOUBAO_DEFAULT_ENDPOINT, type VoiceCredentials } from './voice-credentials-model';
import { encodeWav } from './voice-wav';

let p = 0, t = 0;
const ck = (name: string, cond: boolean) => { t++; if (cond) { p++; console.log(`✅ ${name}`); } else console.log(`❌ ${name}`); };

const TOKEN = 'tok-SECRET-9f8e7d6c5b4a';
const SECRET_KEY = 'sk-SECRET-0011223344'; // 0.2.112 存档里可能还有;请求里绝不能出现
const OLD: VoiceCredentials = { appId: '1234567890', accessToken: TOKEN, endpoint: '' };
const NEW: VoiceCredentials = { appId: '', accessToken: TOKEN, endpoint: '' };
const wav = encodeWav(new Int16Array(1600), 16000);

// ── 请求形状 ──
{
  const r = buildFlashRequest(OLD, 'QUJD', 'req-1');
  ck('默认地址 = 官方 flash 接口', r.url === DOUBAO_DEFAULT_ENDPOINT && r.url.endsWith('/api/v3/auc/bigmodel/recognize/flash'));
  ck('旧版控制台:X-Api-App-Key + X-Api-Access-Key', r.headers['X-Api-App-Key'] === OLD.appId && r.headers['X-Api-Access-Key'] === TOKEN && !('X-Api-Key' in r.headers));
  ck('资源 ID = volc.bigasr.auc_turbo', r.headers['X-Api-Resource-Id'] === 'volc.bigasr.auc_turbo' && DOUBAO_RESOURCE_ID === 'volc.bigasr.auc_turbo');
  ck('X-Api-Sequence = -1、Request-Id 透传', r.headers['X-Api-Sequence'] === '-1' && r.headers['X-Api-Request-Id'] === 'req-1');
  const body = JSON.parse(r.body);
  ck('body:audio.data=base64、format=wav、model_name=bigmodel', body.audio.data === 'QUJD' && body.audio.format === 'wav' && body.request.model_name === 'bigmodel');
  const legacy = buildFlashRequest({ ...OLD, secretKey: SECRET_KEY } as VoiceCredentials, 'QUJD', 'req-1');
  ck('Secret Key 不进请求(极速版用不到)', !legacy.body.includes(SECRET_KEY) && !Object.values(legacy.headers).includes(SECRET_KEY));
  ck('user.uid 不是凭据', body.user.uid === 'agent-network-app');
  const n = buildFlashRequest(NEW, 'QUJD', 'req-2');
  ck('新版控制台(App ID 空):只发 X-Api-Key', n.headers['X-Api-Key'] === TOKEN && !('X-Api-App-Key' in n.headers) && !('X-Api-Access-Key' in n.headers));
  const local = buildFlashRequest({ ...NEW, endpoint: 'http://127.0.0.1:9911/flash' }, 'x', 'r');
  ck('回环 http 地址允许(本机假服务)', local.url === 'http://127.0.0.1:9911/flash');
  let code = '';
  try { buildFlashRequest({ ...NEW, endpoint: 'http://evil.example.com/flash' }, 'x', 'r'); } catch (e) { code = (e as AsrError).code; }
  ck('非回环 http 地址拒绝(凭据不走明文)', code === 'bad_endpoint');
}

// ── 响应判定(纯函数) ──
{
  const ok = interpretFlashResponse(200, '20000000', { result: { text: ' 你好。 ' } });
  ck('20000000 → 文本(去首尾空白)', 'text' in ok && ok.text === '你好。');
  ck('20000003 静音 → 空串', JSON.stringify(interpretFlashResponse(200, '20000003', {})) === '{"text":""}');
  ck('45000002 空音频 → 空串', JSON.stringify(interpretFlashResponse(200, '45000002', null)) === '{"text":""}');
  const e401 = interpretFlashResponse(401, null, { message: 'Invalid X-Api-Key ' + TOKEN });
  ck('HTTP 401 → auth_failed', 'error' in e401 && e401.error === 'auth_failed');
  const e403 = interpretFlashResponse(403, null, { error: '[resource_id=volc.bigasr.auc_turbo] requested resource not granted' });
  ck('HTTP 403(requested resource not granted)→ not_enabled,不是 auth_failed', 'error' in e403 && e403.error === 'not_enabled' && e403.upstream === '403');
  const e151 = interpretFlashResponse(200, '45000151', null);
  ck('45000151 → bad_audio', 'error' in e151 && e151.error === 'bad_audio');
  const busy = interpretFlashResponse(200, '55000031', null);
  ck('55000031 → rate_limited', 'error' in busy && busy.error === 'rate_limited');
  const r429 = interpretFlashResponse(429, null, null);
  ck('HTTP 429 → rate_limited', 'error' in r429 && r429.error === 'rate_limited');
  const other = interpretFlashResponse(200, '55000999', null);
  ck('其他 550xxxxx → upstream_error 带数字码', 'error' in other && other.error === 'upstream_error' && other.upstream === '55000999');
  const garbage = interpretFlashResponse(500, 'Bearer ' + TOKEN, null);
  ck('非数字的状态头不被带出(防回显)', 'error' in garbage && garbage.upstream === '500');
  const notext = interpretFlashResponse(200, '20000000', { result: {} });
  ck('成功码但无 text → upstream_error', 'error' in notext && notext.error === 'upstream_error');
}

// ── transcribeWav:mock fetch ──
const res = (status: number, code: string | null, body: unknown) => ({
  status,
  headers: { get: (n: string) => (n.toLowerCase() === 'x-api-status-code' ? code : null) },
  json: async () => body,
});
const leaks = (e: unknown) => {
  const s = `${(e as Error)?.message} ${String(e)} ${JSON.stringify(e)}`;
  return s.includes(TOKEN) || s.includes(SECRET_KEY);
};

let seen: { url: string; headers: Record<string, string>; body: string } | null = null;
const okFetch: FetchLike = async (url, init) => { seen = { url, headers: init.headers, body: init.body }; return res(200, '20000000', { result: { text: '打开终端' } }); };
ck('成功 → 文本', (await transcribeWav(OLD, wav, { fetchImpl: okFetch })) === '打开终端');
ck('请求体里的音频 = WAV 的 base64', !!seen && JSON.parse(seen!.body).audio.data === Buffer.from(wav).toString('base64'));
ck('每次请求带 UUID 形状的 Request-Id', !!seen && /^[0-9a-f-]{36}$/.test(seen!.headers['X-Api-Request-Id']));

const expectCode = async (name: string, run: () => Promise<unknown>, code: string) => {
  try { await run(); ck(name, false); } catch (e) { ck(name, e instanceof AsrError && e.code === code && !leaks(e)); }
};
await expectCode('未配置 → not_configured(不发请求)', () => transcribeWav(null, wav, { fetchImpl: async () => { throw new Error('must not call'); } }), 'not_configured');
await expectCode('空 token → not_configured', () => transcribeWav({ ...OLD, accessToken: '' }, wav, { fetchImpl: okFetch }), 'not_configured');
await expectCode('超过大小上限 → too_long(不发请求)', () => transcribeWav(OLD, new Uint8Array(MAX_WAV_BYTES + 1), { fetchImpl: async () => { throw new Error('must not call'); } }), 'too_long');
await expectCode('403 → not_enabled', () => transcribeWav(NEW, wav, { fetchImpl: async () => res(403, null, { error: 'requested resource not granted' }) }), 'not_enabled');
await expectCode('401(响应体回显 token)→ auth_failed,错误里无 token', () => transcribeWav(OLD, wav, { fetchImpl: async () => res(401, null, { message: `Invalid ${TOKEN}` }) }), 'auth_failed');
await expectCode('网络异常(message 含 URL/token)→ network,不透传', () => transcribeWav(OLD, wav, { fetchImpl: async () => { throw new Error(`connect failed https://x?token=${TOKEN}`); } }), 'network');
let aborted = false;
await expectCode('上游不回 → timeout 并 abort', () => transcribeWav(OLD, wav, { timeoutMs: 50, fetchImpl: (_u, init) => new Promise(() => { init.signal?.addEventListener('abort', () => { aborted = true; }); }) }), 'timeout');
ck('超时时 abort 了请求', aborted);
await expectCode('body 永不 resolve → timeout', () => transcribeWav(OLD, wav, { timeoutMs: 50, fetchImpl: async () => ({ status: 200, headers: { get: () => '20000000' }, json: () => new Promise(() => {}) }) }), 'timeout');
ck('静音 → 空串(不是错误)', (await transcribeWav(OLD, wav, { fetchImpl: async () => res(200, '20000003', {}) })) === '');
ck('body 不是 JSON 且成功码 → upstream_error', await transcribeWav(OLD, wav, { fetchImpl: async () => ({ status: 200, headers: { get: () => '20000000' }, json: async () => { throw new SyntaxError('bad'); } }) }).then(() => false, e => e.code === 'upstream_error'));

// ── 给用户看的文案 ──
ck('auth_failed(新版)→「鉴权失败：API Key 不对」', asrErrorMessage('auth_failed', '401', 'api-key') === '鉴权失败：API Key 不对');
ck('auth_failed(旧版)→ 点名 App ID / Access Token', asrErrorMessage('auth_failed', '401', 'app-token') === '鉴权失败：App ID 或 Access Token 不对');
ck('not_enabled → 「服务未开通：请在开通管理里开通 录音文件识别大模型-极速版（资源 ID volc.bigasr.auc_turbo）」', asrErrorMessage('not_enabled', '403') === '服务未开通：请在开通管理里开通 录音文件识别大模型-极速版（资源 ID volc.bigasr.auc_turbo）');
ck('network / timeout → 「网络失败」开头', asrErrorMessage('network').startsWith('网络失败') && asrErrorMessage('timeout').startsWith('网络失败'));
ck('upstream_error 文案带数字码', asrErrorMessage('upstream_error', '55000999').includes('55000999'));
ck('not_configured 文案', asrErrorMessage('not_configured') === '未配置语音识别');

console.log(`doubao asr: ${p}/${t} checks passed`);
process.exit(p === t ? 0 : 1);
