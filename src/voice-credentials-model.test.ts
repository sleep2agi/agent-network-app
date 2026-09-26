// ck-style (self-executing; run by scripts/run-tests.mjs). 语音输入凭据:打码、保存合并、不回显。
import { checkEndpoint, DOUBAO_DEFAULT_ENDPOINT, initialForm, maskTail, mergeOnSave, parseVoiceCredentials, statusLabel, voiceConfigStatus, type VoiceCredentials } from './voice-credentials-model';

let p = 0, t = 0;
const ck = (name: string, cond: boolean) => { t++; if (cond) { p++; console.log(`✅ ${name}`); } else console.log(`❌ ${name}`); };

const TOKEN = 'abcdefghijklmnopqrstuvwxyza1b2';
const SK = 'secret-key-zzzz-9999';
const saved: VoiceCredentials = { appId: '1234567890', accessToken: TOKEN, secretKey: SK, endpoint: '' };

// ── 打码 ──
ck('只露最后 4 位', maskTail(TOKEN) === '…a1b2');
ck('短值(<8)不露任何字符', maskTail('abc1234') === '…');
ck('空值 → 空串', maskTail('   ') === '');
ck('首尾空白不算', maskTail(`  ${TOKEN}\n`) === '…a1b2');

// ── 状态 ──
{
  const s = voiceConfigStatus(saved);
  ck('已配置 → 「已配置 ✓ …a1b2」', statusLabel(s) === '已配置 ✓ …a1b2');
  ck('状态对象里没有 token/secret 全文', !JSON.stringify(s).includes(TOKEN) && !JSON.stringify(s).includes(SK));
  ck('有 App ID → 旧版控制台模式', s.configured && s.mode === 'app-token');
  const n = voiceConfigStatus({ ...saved, appId: '' });
  ck('无 App ID → 新版控制台 API Key 模式', n.configured && n.mode === 'api-key');
  ck('未保存 → 未配置', statusLabel(voiceConfigStatus(null)) === '未配置');
  ck('token 为空 → 未配置', !voiceConfigStatus({ ...saved, accessToken: '' }).configured);
}

// ── 表单初值:密钥永不预填 ──
{
  const f = initialForm(saved);
  ck('App ID 预填(不是密钥)', f.appId === saved.appId);
  ck('Access Token 不预填', f.accessToken === '');
  ck('Secret Key 不预填', f.secretKey === '');
  ck('初值表单里没有任何密钥', !JSON.stringify(f).includes(TOKEN) && !JSON.stringify(f).includes(SK));
}

// ── 保存合并 ──
{
  const keep = mergeOnSave(saved, { appId: '1234567890', accessToken: '', secretKey: '', endpoint: '' });
  ck('密钥栏留空 = 保留已存的 token 和 secret', keep.ok && keep.creds.accessToken === TOKEN && keep.creds.secretKey === SK);
  const change = mergeOnSave(saved, { appId: '', accessToken: ' new-api-key-000111 ', secretKey: '', endpoint: '' });
  ck('填了新 token → 替换(去首尾空白)、App ID 清空 = 切到 API Key 模式', change.ok && change.creds.accessToken === 'new-api-key-000111' && change.creds.appId === '');
  ck('首次保存必须有 token', !mergeOnSave(null, { appId: '1', accessToken: '', secretKey: '', endpoint: '' }).ok);
  ck('token 中间有空白 → 拒绝', !mergeOnSave(null, { appId: '', accessToken: 'ab cd', secretKey: '', endpoint: '' }).ok);
  ck('App ID 非法字符 → 拒绝', !mergeOnSave(null, { appId: '12 34', accessToken: 'x', secretKey: '', endpoint: '' }).ok);
  const badEp = mergeOnSave(saved, { appId: '', accessToken: '', secretKey: '', endpoint: 'http://proxy.example.com/flash' });
  ck('非回环 http 接口地址 → 拒绝保存', !badEp.ok && badEp.reason.includes('https'));
  const httpsEp = mergeOnSave(saved, { appId: '', accessToken: '', secretKey: '', endpoint: 'https://proxy.example.com/flash' });
  ck('https 自定义地址 → 保存', httpsEp.ok && httpsEp.creds.endpoint === 'https://proxy.example.com/flash');
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

console.log(`voice credentials model: ${p}/${t} checks passed`);
process.exit(p === t ? 0 : 1);
