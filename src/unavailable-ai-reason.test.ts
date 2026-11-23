import assert from 'node:assert/strict';
import { unavailableAiReason } from './unavailable-ai-reason';

for (const [state, supported, expected] of [
  ['not_logged_in', true, '未登录'], ['missing_cli', true, '未安装'],
  ['no_network', true, '暂时连不上'], ['unsupported_version', true, '版本不支持'],
  [null, false, '版本不支持'], ['future_state', true, '暂时用不了'],
  [undefined, true, '暂时用不了'],
] as const) assert.equal(unavailableAiReason(state, supported), expected);
console.log('7/7 unavailable AI reason cases passed');
