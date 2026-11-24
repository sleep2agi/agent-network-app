// admin 2026-11-24 —— 聊天里的密钥卡（Hub request_secret ⇒ tasks.meta_json.reply_secret_request）。
import { chatSecretRequestFromMeta, savedSecretKeys, secretSaveErrorText, secretSavedMessage } from './chat-secret-request';

let p = 0, t = 0;
const ck = (name: string, ok: boolean, extra?: unknown) => {
  t++;
  if (ok) { p++; console.log('✅', name); } else console.log('❌', name, extra === undefined ? '' : JSON.stringify(extra));
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const meta = JSON.stringify({ reply_secret_request: { node_id: 'n_1', key: 'GITHUB_TOKEN', label: 'GitHub 密钥', hint: '粘贴新的 GitHub token' } });
const want = { nodeId: 'n_1', key: 'GITHUB_TOKEN', label: 'GitHub 密钥', hint: '粘贴新的 GitHub token' };
ck('从任务行读出卡片（字符串）', same(chatSecretRequestFromMeta(meta), want), chatSecretRequestFromMeta(meta));
ck('从任务行读出卡片（对象）', same(chatSecretRequestFromMeta(JSON.parse(meta)), want));
ck('没有 meta ⇒ 普通回复', chatSecretRequestFromMeta(null) === null);
ck('坏 JSON ⇒ 普通回复', chatSecretRequestFromMeta('{bad') === null);
ck('只有附件 ⇒ 普通回复', chatSecretRequestFromMeta(JSON.stringify({ reply_attachments: [] })) === null);
ck('非法变量名 ⇒ 普通回复', chatSecretRequestFromMeta(JSON.stringify({ reply_secret_request: { node_id: 'n', key: 'github token!' } })) === null);
ck('缺 node_id ⇒ 普通回复', chatSecretRequestFromMeta(JSON.stringify({ reply_secret_request: { key: 'GITHUB_TOKEN' } })) === null);

const msg = secretSavedMessage({ key: 'GITHUB_TOKEN', label: 'GitHub 密钥' });
ck('保存后发出的话有名字和变量名', msg.includes('GitHub 密钥') && msg.includes('GITHUB_TOKEN'), msg);
ck('重开聊天能认出已保存', savedSecretKeys(['你好', msg, null]).has('GITHUB_TOKEN'));
ck('普通消息里提到变量名不算已保存', savedSecretKeys(['我把 GITHUB_TOKEN（GITHUB_TOKEN）发你了']).size === 0);

for (const k of ['forbidden', 'unsupported', 'invalid', 'unconfirmed', 'cancelled']) {
  const s = secretSaveErrorText(k);
  ck(`失败文案说人话（${k}）`, s.length > 5 && !/forbidden|unsupported|unconfirmed|cancelled|_/.test(s), s);
}

console.log(`chat-secret-request: ${p}/${t} passed`);
if (p !== t) process.exit(1);
