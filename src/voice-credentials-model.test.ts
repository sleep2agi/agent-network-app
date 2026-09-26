// ck-style (self-executing; run by scripts/run-tests.mjs). 语音输入凭据:打码、保存合并、不回显。
import { authMode, checkEndpoint, checkStreamEndpoint, consoleOf, DOUBAO_DEFAULT_ENDPOINT, initialForm, maskTail, mergeOnSave, needsScrub, parseVoiceCredentials, statusLabel, voiceConfigStatus, type VoiceCredentials, type VoiceForm } from './voice-credentials-model';
import { STREAM_DEFAULT_ENDPOINT } from './doubao-stream-protocol';

let p = 0, t = 0;
const ck = (name: string, cond: boolean) => { t++; if (cond) { p++; console.log(`✅ ${name}`); } else console.log(`❌ ${name}`); };

const TOKEN = 'abcdefghijklmnopqrstuvwxyza1b2';
const SK = 'secret-key-zzzz-9999';
const saved: VoiceCredentials = { appId: '1234567890', accessToken: TOKEN, endpoint: '' };

// ── 打码 ──
ck('只露最后 4 位', maskTail(TOKEN) === '…a1b2');
ck('短值(<8)不露任何字符', maskTail('abc1234') === '…');
ck('空值 → 空串', maskTail('   ') === '');
ck('首尾空白不算', maskTail(`  ${TOKEN}\n`) === '…a1b2');

// ── 状态 ──
{
  const s = voiceConfigStatus(saved);
  ck('已配置 → 「已配置 ✓ …a1b2」', statusLabel(s) === '已配置 ✓ …a1b2');
  ck('状态对象里没有 token 全文', !JSON.stringify(s).includes(TOKEN));
  ck('有 App ID → 旧版控制台模式', s.configured && s.mode === 'app-token');
  const n = voiceConfigStatus({ ...saved, appId: '' });
  ck('无 App ID → 新版控制台 API Key 模式', n.configured && n.mode === 'api-key');
  ck('未保存 → 未配置', statusLabel(voiceConfigStatus(null)) === '未配置');
  ck('token 为空 → 未配置', !voiceConfigStatus({ ...saved, accessToken: '' }).configured);
}

// ── 表单初值:密钥永不预填;没存过 = 新版 ──
const F = (over: Partial<VoiceForm>): VoiceForm => ({ ...initialForm(null), ...over });
{
  const f = initialForm(saved);
  ck('旧存档(有 App ID)→ 表单是旧版控制台', f.console === 'old');
  ck('App ID 预填(不是密钥)', f.appId === saved.appId);
  ck('Access Token / API Key 不预填', f.accessToken === '' && f.apiKey === '');
  ck('初值表单里没有任何密钥', !JSON.stringify(f).includes(TOKEN));
  ck('没存过 → 默认新版(API Key)', initialForm(null).console === 'new');
  ck('迁移:App ID 空 + 有 token 的存档 → 新版', initialForm({ appId: '', accessToken: TOKEN, endpoint: '' }).console === 'new' && consoleOf({ appId: '' }) === 'new');
  ck('表单没有 Secret Key 这一栏', !('secretKey' in initialForm(saved)));
}

// ── 保存合并 ──
{
  const keep = mergeOnSave(saved, F({ console: 'old', appId: '1234567890' }));
  ck('旧版:密钥栏留空 = 保留已存的 token', keep.ok && keep.creds.accessToken === TOKEN && keep.creds.appId === '1234567890');
  const newKey = mergeOnSave(null, F({ console: 'new', apiKey: ' new-api-key-000111 ' }));
  ck('新版:只填 API Key → 存 accessToken、App ID 为空(发 X-Api-Key)', newKey.ok && newKey.creds.accessToken === 'new-api-key-000111' && newKey.creds.appId === '' && authMode(newKey.creds) === 'api-key');
  const savedNew: VoiceCredentials = { appId: '', accessToken: TOKEN, endpoint: '' };
  const keepNew = mergeOnSave(savedNew, F({ console: 'new' }));
  ck('新版:API Key 栏留空 = 保留', keepNew.ok && keepNew.creds.accessToken === TOKEN);
  ck('旧版 → 新版且 API Key 留空 → 拒绝(Access Token 当不了 API Key)', !mergeOnSave(saved, F({ console: 'new' })).ok);
  ck('新版 → 旧版且 Access Token 留空 → 拒绝', !mergeOnSave(savedNew, F({ console: 'old', appId: '42' })).ok);
  const toOld = mergeOnSave(savedNew, F({ console: 'old', appId: '42', accessToken: 'acc-token-777' }));
  ck('新版 → 旧版:填了 App ID + Access Token → 旧版(发 X-Api-App-Key/Access-Key)', toOld.ok && authMode(toOld.creds) === 'app-token' && toOld.creds.accessToken === 'acc-token-777');
  ck('旧版必须有 App ID', !mergeOnSave(null, F({ console: 'old', accessToken: 'x' })).ok);
  ck('首次保存必须有 API Key', !mergeOnSave(null, F({ console: 'new' })).ok);
  ck('API Key 中间有空白 → 拒绝', !mergeOnSave(null, F({ console: 'new', apiKey: 'ab cd' })).ok);
  ck('App ID 非法字符 → 拒绝', !mergeOnSave(null, F({ console: 'old', appId: '12 34', accessToken: 'x' })).ok);
  const badEp = mergeOnSave(savedNew, F({ endpoint: 'http://proxy.example.com/flash' }));
  ck('非回环 http 接口地址 → 拒绝保存', !badEp.ok && badEp.reason.includes('https'));
  const httpsEp = mergeOnSave(savedNew, F({ endpoint: 'https://proxy.example.com/flash' }));
  ck('https 自定义地址 → 保存', httpsEp.ok && httpsEp.creds.endpoint === 'https://proxy.example.com/flash');
  const badWs = mergeOnSave(savedNew, F({ streamEndpoint: 'ws://proxy.example.com/sauc' }));
  ck('非回环 ws 流式地址 → 拒绝(握手头里有密钥)', !badWs.ok && badWs.reason.includes('wss'));
  const localWs = mergeOnSave(savedNew, F({ streamEndpoint: 'ws://127.0.0.1:9931/sauc' }));
  ck('回环 ws 流式地址 → 保存(本机假服务)', localWs.ok && localWs.creds.streamEndpoint === 'ws://127.0.0.1:9931/sauc');
  const rid = mergeOnSave(savedNew, F({ streamResourceId: 'volc.seedasr.sauc.duration' }));
  ck('流式资源 ID:四种之一 → 保存', rid.ok && rid.creds.streamResourceId === 'volc.seedasr.sauc.duration');
  ck('流式资源 ID:乱填 → 拒绝', !mergeOnSave(savedNew, F({ streamResourceId: 'volc.bigasr.auc_turbo' })).ok);
  const def = mergeOnSave(savedNew, F({ streamResourceId: 'volc.bigasr.sauc.duration' }));
  ck('流式资源 ID = 默认值 → 不写进存档(存档保持最小)', def.ok && !('streamResourceId' in def.creds));
  ck('保存结果里没有 secretKey', newKey.ok && !('secretKey' in newKey.creds));
}

// ── 接口地址 ──
ck('空 → 官方默认', (() => { const r = checkEndpoint(''); return r.ok && r.url === DOUBAO_DEFAULT_ENDPOINT; })());
ck('localhost http → 允许', checkEndpoint('http://localhost:9911/x').ok);
ck('[::1] http → 允许', checkEndpoint('http://[::1]:9911/x').ok);
ck('不是 URL → 拒绝', !checkEndpoint('openspeech').ok);
ck('ws:// → 拒绝', !checkEndpoint('ws://127.0.0.1/x').ok);

// ── 存储里读出来的 ──
ck('损坏 JSON → null', parseVoiceCredentials('{oops') === null);
ck('没有 token → null', parseVoiceCredentials(JSON.stringify({ appId: '1' })) === null);
ck('非字符串字段被丢弃', parseVoiceCredentials(JSON.stringify({ accessToken: 'x', appId: 5, secretKey: null }))?.appId === '');
ck('正常往返', JSON.stringify(parseVoiceCredentials(JSON.stringify(saved))) === JSON.stringify(saved));
{
  const legacy = JSON.stringify({ appId: '', accessToken: TOKEN, secretKey: SK, endpoint: '' });
  const parsed = parseVoiceCredentials(legacy);
  ck('0.2.112 存档带 Secret Key → 读出来没有 secretKey', !!parsed && !JSON.stringify(parsed).includes(SK));
  ck('0.2.112 存档带 Secret Key → needsScrub(静默重写)', needsScrub(legacy) && !needsScrub(JSON.stringify(parsed)));
  ck('0.2.112 新版存档(App ID 空)→ 新版控制台', !!parsed && voiceConfigStatus(parsed).configured && (voiceConfigStatus(parsed) as any).console === 'new');
  const withStream = parseVoiceCredentials(JSON.stringify({ accessToken: 'x', streamEndpoint: 'ws://127.0.0.1:1/x', streamResourceId: 'bogus' }));
  ck('存档里的流式地址带出,非法资源 ID 丢弃', withStream?.streamEndpoint === 'ws://127.0.0.1:1/x' && withStream?.streamResourceId === undefined);
}
ck('流式地址空 → 官方 bigmodel_async', (() => { const r = checkStreamEndpoint(''); return r.ok && r.url === STREAM_DEFAULT_ENDPOINT && r.url.endsWith('/api/v3/sauc/bigmodel_async'); })());
ck('流式 https:// → 拒绝(不是 WebSocket)', !checkStreamEndpoint('https://openspeech.bytedance.com/x').ok);
ck('流式 wss:// → 允许', checkStreamEndpoint('wss://relay.example.com/sauc').ok);

console.log(`voice credentials model: ${p}/${t} checks passed`);
process.exit(p === t ? 0 : 1);
