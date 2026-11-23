import assert from 'node:assert/strict';
import { unavailableAiCommand, unavailableAiReason } from './unavailable-ai-reason';

for (const [state, supported, expected] of [
  ['not_logged_in', true, '未登录'], ['missing_cli', true, '未安装'],
  ['no_network', true, '暂时连不上'], ['unsupported_version', true, '版本不支持'],
  [null, false, '版本不支持'], ['future_state', true, '暂时用不了'],
  [undefined, true, '暂时用不了'],
] as const) assert.equal(unavailableAiReason(state, supported), expected);
console.log('7/7 unavailable AI reason cases passed');

// A command is shown only when it is the right one for that AI and that problem.
for (const [ai, state, expected] of [
  ['codex-sdk', 'not_logged_in', 'codex login --device-auth'], ['codex-app-server', 'missing_cli', 'npm i -g @openai/codex'],
  ['claude-agent-sdk', 'not_logged_in', 'claude'], ['claude-code-cli', 'missing_cli', 'npm i -g @anthropic-ai/claude-code'],
  ['antigravity-acp', 'not_logged_in', 'agy acp --login'], ['antigravity-acp', 'missing_cli', undefined],
  ['grok-build-acp', 'missing_cli', undefined], ['opencode-cli', 'missing_cli', undefined],
  ['codex-sdk', 'no_network', undefined], ['claude-agent-sdk', 'unsupported_version', undefined], ['codex-sdk', undefined, undefined],
] as const) assert.equal(unavailableAiCommand(ai, state), expected);
console.log('11/11 unavailable AI command cases passed');
