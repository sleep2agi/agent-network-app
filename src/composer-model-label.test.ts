// ck-style (self-executing; run by scripts/run-tests.mjs). #4130 显示段:
// 模型 helper 只认会话上报；缺值返回 null，由聊天 UI 显示未知提示。
import { strict as assert } from 'node:assert';
import { composerModelLabel, reportedComposerModel } from './composer-model-label';

let n = 0;
const ck = (name: string, cond: boolean, extra = '') => {
  n += 1;
  assert.ok(cond, `${name}${extra ? ` — ${extra}` : ''}`);
  console.log(`PASS: ${name}`);
};

// 有值:原样显示
ck('model only', composerModelLabel({ model: 'gpt-5-codex' }) === 'gpt-5-codex');
// runtime + model:中间用 · 连
ck('runtime prefix', composerModelLabel({ model: 'gpt-5-codex', runtime: 'codex-tui' }) === 'codex-tui · gpt-5-codex');
// model 已经含 runtime 字样 → 不重复前缀
ck('no dup prefix', composerModelLabel({ model: 'opencode:claude-sonnet-4.5', runtime: 'opencode' }) === 'opencode:claude-sonnet-4.5');
// 缺 model → 不显示(绝不拿默认配置顶)
ck('missing model hides', composerModelLabel({ model: '', runtime: 'codex-tui' }) === null);
ck('null model hides', composerModelLabel({ model: null, runtime: 'codex-tui' }) === null);
ck('no input hides', composerModelLabel({}) === null);
// 空白串也算缺
ck('blank model hides', composerModelLabel({ model: '   ' }) === null);
// 离线标注
ck('offline tag', composerModelLabel({ model: 'm1', runtime: 'r1', status: 'offline' }) === 'r1 · m1 · 离线');
// 在线不臆造字样
ck('online no tag', composerModelLabel({ model: 'm1', status: 'online' }) === 'm1');
// 首尾空白清掉
ck('trim', composerModelLabel({ model: '  m1  ', runtime: '  r1  ' }) === 'r1 · m1');

const rows = [{ alias: 'a', network_id: 'n1', model: 'one' }, { alias: 'a', network_id: 'n2', model: 'two' }];
ck('scope by network', reportedComposerModel(rows, 'n2', 'a')?.model === 'two');
ck('unknown network hides', reportedComposerModel(rows, undefined, 'a') === null);
ck('missing row network hides', reportedComposerModel([{ alias: 'a', model: 'one' }], 'n1', 'a') === null);
ck('duplicate scope hides', reportedComposerModel([rows[0], rows[0]], 'n1', 'a') === null);

console.log(`${n}/${n} passed`);
process.exit(0);
