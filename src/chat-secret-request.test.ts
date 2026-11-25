// admin 2026-11-24 —— 聊天里的密钥卡（Hub request_secret ⇒ tasks.meta_json.reply_secret_request）。
import { secretDisplayName, chatSecretRequestFromMeta, secretSavedAfter, secretSaveErrorText, secretSavedMessage, selectChatSecretScopes } from './chat-secret-request';

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
const card1 = '2026-11-24T08:00:00Z', card2 = '2026-11-24T09:00:00Z';
const mine = (content: string, at: string | null) => ({ content, at, own: true });
ck('重开聊天：卡片之后本人发的确认 ⇒ 已保存', secretSavedAfter([mine('你好', '2026-11-24T08:01:00Z'), mine(msg, '2026-11-24T08:02:00Z')], 'GITHUB_TOKEN', card1));
ck('旧确认不吞掉后来同名的换钥请求', !secretSavedAfter([mine(msg, '2026-11-24T08:02:00Z')], 'GITHUB_TOKEN', card2));
ck('别人发的确认不算', !secretSavedAfter([{ content: msg, at: '2026-11-24T09:05:00Z', own: false }], 'GITHUB_TOKEN', card2));
ck('别的变量名的确认不算', !secretSavedAfter([mine(secretSavedMessage({ key: 'NPM_TOKEN' }), '2026-11-24T09:05:00Z')], 'GITHUB_TOKEN', card2));
ck('本地回显带真实时间（卡片之后）算', secretSavedAfter([mine(msg, '2026-11-24T09:00:01Z')], 'GITHUB_TOKEN', card2));
ck('确认缺时间 ⇒ 不算', !secretSavedAfter([mine(msg, null)], 'GITHUB_TOKEN', card2));
ck('确认时间不可解析 ⇒ 不算', !secretSavedAfter([mine(msg, 'not-a-date')], 'GITHUB_TOKEN', card2));
ck('卡片缺时间 ⇒ 任何旧确认都不算', !secretSavedAfter([mine(msg, '2026-11-24T09:05:00Z')], 'GITHUB_TOKEN', null));
ck('卡片时间不可解析 ⇒ 不算', !secretSavedAfter([mine(msg, '2026-11-24T09:05:00Z')], 'GITHUB_TOKEN', 'garbage'));
ck('普通消息里提到变量名不算已保存', !secretSavedAfter([mine('我把 GITHUB_TOKEN（GITHUB_TOKEN）发你了', '2026-11-24T09:05:00Z')], 'GITHUB_TOKEN', card2));

for (const k of ['forbidden', 'unsupported', 'invalid', 'unconfirmed', 'cancelled']) {
  const s = secretSaveErrorText(k);
  ck(`失败文案说人话（${k}）`, s.length > 5 && !/forbidden|unsupported|unconfirmed|cancelled|_/.test(s), s);
}

ck('Daemon 托管节点优先写 Daemon 作用域，再回退独立节点 (#5505)', same(
  selectChatSecretScopes('net_1', 'n_1', 'd_1'),
  [{ networkId: 'net_1', daemonId: 'd_1', nodeId: 'n_1' }, { networkId: 'net_1', daemonId: null, nodeId: 'n_1' }],
));
ck('独立节点只走独立节点作用域 (#5505)', same(
  selectChatSecretScopes('net_1', 'n_1', null),
  [{ networkId: 'net_1', daemonId: null, nodeId: 'n_1' }],
));

ck('标题里带变量名(半角括号)时去掉', secretDisplayName({ key: 'GITHUB_TOKEN', label: '更新 GitHub 密钥 (GITHUB_TOKEN)' }) === '更新 GitHub 密钥', secretDisplayName({ key: 'GITHUB_TOKEN', label: '更新 GitHub 密钥 (GITHUB_TOKEN)' }));
ck('全角括号同样去掉', secretDisplayName({ key: 'NPM_TOKEN', label: 'npm 令牌（NPM_TOKEN）' }) === 'npm 令牌');
ck('标题只有变量名 / 没标题 ⇒ 用变量名', secretDisplayName({ key: 'K', label: '(K)' }) === 'K' && secretDisplayName({ key: 'K' }) === 'K');
ck('保存消息不再重复变量名', secretSavedMessage({ key: 'GITHUB_TOKEN', label: 'GitHub 密钥 (GITHUB_TOKEN)' }).startsWith('🔑 已在卡片里保存「GitHub 密钥」（GITHUB_TOKEN）'));

console.log(`chat-secret-request: ${p}/${t} passed`);
if (p !== t) process.exit(1);
