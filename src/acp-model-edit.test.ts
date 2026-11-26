// 2026-11-21 admin 截图：agy/grok（ACP）节点在 App 里选不了模型 —— 面板被「非 OpenCode V2」锁成只读。
// 2026-11-25 升级：
//   · agy（antigravity-acp / antigravity-sdk）走 OpenCode 同款「搜索 + 分组列表 + 一键切换」，
//     保留折叠的「手动输入自定义模型 ID」兜底，杜绝把搜索词（如 carbon）按回车误保存成模型名；
//   · 补齐 revision_conflict 自动 reloadConfig() + 中文提示（不再裸吐错误码或死循环）；
//   · classifyAcpSaveOutcome 区分「热切已生效 / 重启生效中 / 拒绝失败」，消除 restart 节点假报错。
//   run: bun src/acp-model-edit.test.ts
import {
  ACP_MODEL_SUGGESTIONS,
  acpModelChoices,
  acpModelErrorText,
  classifyAcpSaveOutcome,
  describeAgyModel,
  filterAndGroupAgyModels,
  isAcpModelRuntime,
  isAgyRuntime,
  normalizeAcpModelId,
} from './acp-model-edit';
import { suggestedModels } from './runtime-catalog';
import { chatTranslations } from './i18n-chat';
import { readFileSync } from 'node:fs';

let passed = 0;
let total = 0;
const ck = (name: string, ok: boolean) => { total++; if (ok) passed++; else console.log('❌', name); };

ck('agy 是 ACP runtime', isAcpModelRuntime('antigravity-acp'));
ck('antigravity-sdk 也是 agy/ACP runtime (#5321)', isAcpModelRuntime('antigravity-sdk') && isAgyRuntime('antigravity-sdk') && suggestedModels('antigravity-sdk').length >= 20);
ck('grok 是 ACP runtime', isAcpModelRuntime('grok-build-acp') && !isAgyRuntime('grok-build-acp'));
ck('OpenCode 不是 ACP（有目录，走原面板）', !isAcpModelRuntime('opencode-cli'));
ck('空/未知 runtime 不误判', !isAcpModelRuntime(null) && !isAcpModelRuntime(''));

ck('模型 id trim 后合法', normalizeAcpModelId('  claude-opus-5-5-high ').ok && (normalizeAcpModelId(' claude-opus-5-5-high ') as any).value === 'claude-opus-5-5-high');
ck('空串不合法', normalizeAcpModelId('   ').ok === false);
ck('带空格不合法', normalizeAcpModelId('claude opus').ok === false);
ck('超长不合法', normalizeAcpModelId('x'.repeat(121)).ok === false);
ck('错误码有人话', /模型 id/.test(acpModelErrorText('invalid_model_id')));

ck('候选按 vendor 分组且非空', ACP_MODEL_SUGGESTIONS.length >= 2 && ACP_MODEL_SUGGESTIONS.every(g => g.vendor && g.ids.length > 0));

// agy 模型解析、分组与搜索
{
  const neon = describeAgyModel('gemini-4-neon-xhigh');
  ck('Gemini 4 slug 解析出组名/可读名/档位', neon.group === 'Gemini 4' && neon.label === 'Gemini 4 Neon' && neon.level === 'XHigh');
  const opus = describeAgyModel('claude-opus-5-5-high');
  ck('Claude 5.5 slug 解析正确', opus.group === 'Claude' && opus.label === 'Claude Opus 5.5' && opus.level === 'High');
  const orch = describeAgyModel('gemini-pro-orchestrator');
  ck('Orchestrator 默认映射为 Carbon', orch.group === 'Orchestrator' && orch.label === 'Orchestrator (Carbon)' && orch.level === null);
  const gpt = describeAgyModel('gpt-oss-120b-medium');
  ck('GPT-OSS slug 解析正确', gpt.group === 'OpenAI' && gpt.label === 'GPT-OSS 120B' && gpt.level === 'Medium');

  const all = suggestedModels('antigravity-acp');
  const full = filterAndGroupAgyModels({ models: all, query: '', currentModel: 'claude-opus-5-5-high' });
  ck('当前模型所在组置顶', full.groups[0]?.group === 'Claude' && full.groups[0].rows.some(r => r.id === 'claude-opus-5-5-high' && r.current));
  ck('全量计数一致', full.total === all.length && full.catalogTotal === all.length);

  const carbon = filterAndGroupAgyModels({ models: all, query: 'carbon', currentModel: 'gemini-4-neon-high' });
  ck('搜 carbon 命中全部 gemini-4-carbon-* 和 Orchestrator (Carbon)',
    carbon.total === 4 && carbon.groups.flatMap(g => g.rows).some(r => r.id === 'gemini-4-carbon-high')
    && carbon.groups.flatMap(g => g.rows).some(r => r.id === 'gemini-pro-orchestrator'));

  const multi = filterAndGroupAgyModels({ models: all, query: 'claude high', currentModel: null });
  ck('多词搜索支持空格分词（claude high）',
    multi.total === 2 && multi.groups.flatMap(g => g.rows).every(r => r.id.startsWith('claude-') && r.level === 'High'));
}

// 保存判定：不再把 restart 节点的旧快照误判为「写入不一致」
{
  const hotApplied = classifyAcpSaveOutcome({
    applyMode: 'hot',
    updateId: 'cu_1',
    requested: 'claude-opus-5-5-high',
    baseRevision: 4,
    after: { model: 'claude-opus-5-5-high', config_revision: 5, last_update: { update_id: 'cu_1', status: 'applied' } },
  });
  ck('hot 切模型收到 applied → applied(hot=true)', hotApplied.kind === 'applied' && hotApplied.hot === true);

  const restartingOldSnap = classifyAcpSaveOutcome({
    applyMode: 'restart',
    updateId: 'cu_2',
    requested: 'gemini-4-carbon-high',
    baseRevision: 4,
    after: { model: 'gemini-4-neon-high', config_revision: 4, last_update: { update_id: 'cu_2', status: 'restarting' } },
  });
  ck('restart 节点尚未重启完（快照仍是旧模型）→ restarting，不误报失败', restartingOldSnap.kind === 'restarting');

  const noLastUpdateRestart = classifyAcpSaveOutcome({
    applyMode: 'restart',
    updateId: 'cu_3',
    requested: 'gemini-4-carbon-high',
    baseRevision: 4,
    after: { model: 'gemini-4-neon-high', config_revision: 4, last_update: null },
  });
  ck('旧 Hub 无 last_update 且快照尚未刷新 → restarting，不误报不一致', noLastUpdateRestart.kind === 'restarting');

  const rejected = classifyAcpSaveOutcome({
    applyMode: 'hot',
    updateId: 'cu_4',
    requested: 'bad-id',
    baseRevision: 4,
    after: { model: 'gemini-4-neon-high', config_revision: 4, last_update: { update_id: 'cu_4', status: 'rejected', error: 'invalid_model' } },
  });
  ck('显式 rejected → failed 并带原因', rejected.kind === 'failed' && rejected.reason === 'invalid_model');
}

// i18n 文案不能再露原始 markdown 星号，且方向与英文对齐
ck('acpHint 不再含未渲染的 ** 星号', !chatTranslations['chat.modelPicker.acpHint'][0].includes('**') && !chatTranslations['chat.modelPicker.acpHint'][1].includes('**'));
ck('acpConfigured 中文不再误写「下方」', !chatTranslations['chat.modelPicker.acpConfigured'][0].includes('下方'));

const palette = readFileSync(new URL('./ComposerModelPalette.tsx', import.meta.url), 'utf8');
ck('ACP 节点不再命中只读卡', palette.includes('!acpRuntime && (generation'));
ck('ACP 分支写节点配置（与 CLI 同一份）', palette.includes('patch: buildConfigPatch({ model: checked.value })'));
ck('ACP 分支不再用 after.model !== checked.value 假报错', !palette.includes('after.model !== checked.value'));
ck('ACP 分支处理 revision_conflict：自动 reloadConfig 并显示可读文案',
  /if \(res\.conflict\)\s*\{\s*await reloadConfig\(\);\s*setAcpError\(t\('chat\.modelPicker\.conflict'\)\);/.test(palette));
ck('ACP 分支任何终局都同步最新 config（防 revision 过期死循环）',
  /if \(after\)\s*\{\s*setConfig\(after\);\s*readbackRef\.current\(after\);\s*\}/.test(palette));
ck('agy 分支走搜索框 + 分组列表，且搜索框不绑回车误保存',
  palette.includes('filterAndGroupAgyModels') && palette.includes('model-palette-agy-custom-toggle')
  && palette.includes('testID="model-palette-agy-search"')
  && !/testID="model-palette-agy-search"[\s\S]{0,400}onSubmitEditing/.test(palette));
ck('有自定义输入框与保存按钮的 testID', palette.includes('model-palette-acp-input') && palette.includes('model-palette-acp-save'));
ck('非 agy ACP 仍预填当前配置模型', palette.includes('acpPrefilled') && palette.includes('if (current) setAcpDraft(current)'));

const reported = acpModelChoices({ runtime: 'antigravity-sdk', agyModels: ['gemini-4-neon-high', 'claude-opus-5-5-high', 'bad model', 'gemini-4-neon-high'] });
ck('agy_models 优先作为模型清单并去重过滤非法值 (#5321)', reported.source === 'reported' && JSON.stringify(reported.models) === JSON.stringify(['gemini-4-neon-high', 'claude-opus-5-5-high']));
const fallback = acpModelChoices({ runtime: 'antigravity-sdk', agyModels: null });
ck('agy 未上报时回退内置完整候选 (#5321)', fallback.source === 'fallback' && fallback.models.includes('gemini-4-neon-high') && fallback.models.length >= 20);
ck('ComposerModelPalette 消费 node.agy_models (#5321)', palette.includes('acpModelChoices({ runtime: node?.runtime, agyModels: node?.agy_models })'));

console.log(`${passed}/${total} passed`);
if (passed !== total) process.exit(1);
