// 运行时切换的纯逻辑（admin 2026-11-21）。UI 排期在部门范围之后，先把语义钉住。
//   run: bun src/node-runtime-switch.test.ts
import { patchForRuntime, runtimeLoginHint, runtimeOptions, runtimeSwitchErrorText, validateRuntimeSwitch } from './node-runtime-switch';

let passed = 0;
let total = 0;
const ck = (name: string, ok: boolean) => { total++; if (ok) passed++; else console.log('❌', name); };

const ids = runtimeOptions().map(o => o.id);
ck('已知清单包含 agy', ids.includes('antigravity-acp'));
ck('已知清单包含 codex / claude / grok / opencode', ['codex-app-server', 'claude-code-cli', 'grok-build-acp', 'opencode-cli'].every(id => ids.includes(id)));
ck('每个选项都有 label', runtimeOptions().every(o => o.label === o.id));

ck('正常 id 通过并 trim', JSON.stringify(validateRuntimeSwitch('  antigravity-acp ', 'codex-app-server')) === JSON.stringify({ ok: true, value: 'antigravity-acp' }));
ck('空串拒绝', validateRuntimeSwitch('   ', 'codex-app-server').ok === false);
ck('带空格拒绝', validateRuntimeSwitch('a b', null).ok === false);
ck('超长拒绝', validateRuntimeSwitch('x'.repeat(65), null).ok === false);
ck('与当前相同 → same_runtime（不发请求）', JSON.stringify(validateRuntimeSwitch('codex-app-server', 'codex-app-server')) === JSON.stringify({ ok: false, reason: 'same_runtime' }));
ck('当前为空时不判 same', validateRuntimeSwitch('codex-app-server', '').ok === true);
ck('patch 是 { runtime }', JSON.stringify(patchForRuntime(' grok-build-cli ')) === JSON.stringify({ runtime: 'grok-build-cli' }));
ck('错误码有人话', /运行时/.test(runtimeSwitchErrorText('invalid_runtime')) && /相同/.test(runtimeSwitchErrorText('same_runtime')));

import { readFileSync } from 'node:fs';
const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
const card = readFileSync(new URL('./NodeRuntimeSwitchCard.tsx', import.meta.url), 'utf8');
ck('api: patch 支持 runtime 并 trim 后下发', api.includes("patch.runtime = req.patch.runtime.trim()"));
ck('api: NodeConfigRead 带 runtime 读回字段', api.includes('runtime?: string | null;'));
ck('卡片走 updateNodeConfig({patch:{runtime}})', card.includes('patch: patchForRuntime(checked.value)'));
ck('卡片只回读配置、不声称已切换', card.includes("after.runtime") && card.includes('需要重启节点才生效'));
ck('卡片写明可能要重配认证', card.includes('换运行时可能需要重新配置认证'));
ck('卡片带进阶 toggle / 输入 / 保存 testID', ['node-runtime-advanced-toggle', 'node-runtime-input', 'node-runtime-save'].every(id => card.includes(id)));
ck('agy 的登录命令能提示', runtimeLoginHint('antigravity-acp') === 'agy acp --login');
ck('没有登录命令的 runtime 返回 null', runtimeLoginHint('claude-agent-sdk') === null);
ck('未知 runtime 不编造', runtimeLoginHint('nope') === null);
console.log(`${passed}/${total} passed`);
if (passed !== total) process.exit(1);
