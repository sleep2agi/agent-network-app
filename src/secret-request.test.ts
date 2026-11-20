// 识别层的单测：agent 举手（secret_request_ui）不能被当普通文本，也不能把普通文本误判成要密钥。
import { parseSecretRequest, secretSavedConfirmation, splitSecretRequest } from './secret-request';

let p = 0, t = 0;
const ck = (name: string, ok: boolean, extra?: unknown) => {
  t++;
  if (ok) { p++; console.log('✅', name); } else console.log('❌', name, extra === undefined ? '' : JSON.stringify(extra));
};

// 1) 干净的 JSON tool-call（fenced）
const fenced = '我先看下环境。\n```json\n{"name":"secret_request_ui","arguments":{"key":"GITHUB_TOKEN","label":"GitHub 密钥"}}\n```';
ck('fenced json 认出 key/label', JSON.stringify(parseSecretRequest(fenced)) === JSON.stringify({ key: 'GITHUB_TOKEN', label: 'GitHub 密钥' }), parseSecretRequest(fenced));
ck('split 会去掉那段 json、保留人话', (() => { const r = splitSecretRequest(fenced); return r.text === '我先看下环境。' && r.request?.key === 'GITHUB_TOKEN'; })(), splitSecretRequest(fenced));

// 2) Hub 的 action 形态：daemon_provider_snapshot + action=secret_request_ui
const nested = '{"name":"daemon_provider_snapshot","arguments":{"action":"secret_request_ui","key":"OPENAI_API_KEY"}}';
ck('daemon_provider_snapshot + action 也认', JSON.stringify(parseSecretRequest(nested)) === JSON.stringify({ key: 'OPENAI_API_KEY' }), parseSecretRequest(nested));

// 3) 紧凑调用
ck('紧凑调用 secret_request_ui({...})', parseSecretRequest('请给我 secret_request_ui({"key":"GH_TOKEN"})')?.key === 'GH_TOKEN');
ck('紧凑调用 secret_request_ui {...}', parseSecretRequest('secret_request_ui {"key":"GH_TOKEN","label":"GitHub"}`')?.key === 'GH_TOKEN');

// 4) 参数在 input / params 里
ck('input 里的参数', parseSecretRequest('{"tool":"secret_request_ui","input":{"key":"K1"}}')?.key === 'K1');
ck('params 里的参数', parseSecretRequest('{"action":"secret_request_ui","params":{"key":"K2","description":"某密钥"}}')?.label === '某密钥');

// 5) 不该认的
ck('普通消息不是举手', parseSecretRequest('今天先把构建跑一遍') === null);
ck('提到名字但没有参数不认', parseSecretRequest('我会用 secret_request_ui 这个工具') === null);
ck('缺 key 不认', parseSecretRequest('{"name":"secret_request_ui","arguments":{}}') === null);
ck('坏 JSON 不认', parseSecretRequest('secret_request_ui({"key": )') === null);
ck('非字符串输入不炸', parseSecretRequest(null) === null && parseSecretRequest(undefined) === null && parseSecretRequest(42 as any) === null);

// 6) 确认语只带 key，不带值
ck('确认语只写 key', secretSavedConfirmation({ key: 'GITHUB_TOKEN' }) === 'GITHUB_TOKEN 已保存。');
ck('确认语不会被当成新举手', parseSecretRequest(secretSavedConfirmation({ key: 'GITHUB_TOKEN' })) === null);

console.log(`secret-request: ${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
