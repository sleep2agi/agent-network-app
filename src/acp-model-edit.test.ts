// 2026-11-21 admin 截图：agy/grok（ACP）节点在 App 里选不了模型 —— 面板被「非 OpenCode V2」锁成只读。
// 这两个 runtime 没有目录可读，所以走「输入模型 id + 写节点配置」，并如实标注：需要重启、未读回。
//   run: bun src/acp-model-edit.test.ts
import { ACP_MODEL_SUGGESTIONS, acpModelErrorText, isAcpModelRuntime, normalizeAcpModelId } from './acp-model-edit';
import { readFileSync } from 'node:fs';

let passed = 0;
let total = 0;
const ck = (name: string, ok: boolean) => { total++; if (ok) passed++; else console.log('❌', name); };

ck('agy 是 ACP runtime', isAcpModelRuntime('antigravity-acp'));
ck('grok 是 ACP runtime', isAcpModelRuntime('grok-build-acp'));
ck('OpenCode 不是 ACP（有目录，走原面板）', !isAcpModelRuntime('opencode-cli'));
ck('空/未知 runtime 不误判', !isAcpModelRuntime(null) && !isAcpModelRuntime(''));

ck('模型 id trim 后合法', normalizeAcpModelId('  claude-opus-5-5-high ').ok && (normalizeAcpModelId(' claude-opus-5-5-high ') as any).value === 'claude-opus-5-5-high');
ck('空串不合法', normalizeAcpModelId('   ').ok === false);
ck('带空格不合法', normalizeAcpModelId('claude opus').ok === false);
ck('超长不合法', normalizeAcpModelId('x'.repeat(121)).ok === false);
ck('错误码有人话', /模型 id/.test(acpModelErrorText('invalid_model_id')));

ck('候选按 vendor 分组且非空', ACP_MODEL_SUGGESTIONS.length >= 2 && ACP_MODEL_SUGGESTIONS.every(g => g.vendor && g.ids.length > 0));

const palette = readFileSync(new URL('./ComposerModelPalette.tsx', import.meta.url), 'utf8');
ck('ACP 节点不再命中只读卡', palette.includes('!acpRuntime && (generation'));
ck('ACP 分支写节点配置（与 CLI 同一份）', palette.includes('patch: buildConfigPatch({ model: checked.value })'));
ck('ACP 分支只确认配置回读', palette.includes("after.model !== checked.value"));
ck('界面明说需要重启 + 未读回', palette.includes("t('chat.modelPicker.acpHint'") && palette.includes("t('chat.modelPicker.acpSaved'"));
ck('有输入框与保存按钮的 testID', palette.includes('model-palette-acp-input') && palette.includes('model-palette-acp-save'));

console.log(`${passed}/${total} passed`);
if (passed !== total) process.exit(1);
