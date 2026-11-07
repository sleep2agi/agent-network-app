// ck-style (self-executing; run by scripts/run-tests.mjs). #4130 显示段:
// 输入框底部那行模型只认会话自己上报的值,缺了就什么都不显示。
import { strict as assert } from 'node:assert';
import { composerModelLabel } from './composer-model-label';

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

console.log(`${n}/${n} passed`);
process.exit(0);
