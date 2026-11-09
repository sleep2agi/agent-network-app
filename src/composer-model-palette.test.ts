// ck-style（scripts/run-tests.mjs 执行）—— 聊天页模型命令面板的纯逻辑。
import { strict as assert } from 'node:assert';
import {
  confirmComposerModelSwitch,
  confirmComposerVariantSwitch,
  filterPaletteModels,
  groupPaletteModels,
  paletteCatalogModels,
  paletteCurrentKey,
  paletteVariantChoices,
  paletteVariantMap,
  paletteView,
} from './composer-model-palette';

let n = 0;
const ck = (name: string, cond: boolean) => { n += 1; assert.ok(cond, name); console.log(`PASS: ${name}`); };

const snap = {
  providers: [
    { id: 'deepseek', activation: 'enabled' },
    { id: 'off', activation: 'disabled' },
  ],
  models: [
    { providerId: 'tianma', id: 'MiniMax-M3.1-Flash' },
    { providerId: 'deepseek', id: 'deepseek-flash' },
    { providerId: 'tianma', id: 'MiniMax-M3' },
    { providerId: 'off', id: 'hidden' },
    { providerId: 'deepseek', id: 'deepseek-v4-flash' },
  ],
};

const all = paletteCatalogModels(snap);
ck('catalog keeps only real provider/model rows', all.length === 4);
ck('disabled provider is excluded', !all.some(m => m.providerId === 'off'));
ck('keys are provider/model', all[0].key === 'tianma/MiniMax-M3.1-Flash');
ck('catalog keeps server order', all.map(m => m.id).join(',') === 'MiniMax-M3.1-Flash,deepseek-flash,MiniMax-M3,deepseek-v4-flash');
ck('duplicates collapse', paletteCatalogModels({ models: [{ providerId: 'p', id: 'm' }, { providerId: 'p', id: 'm' }] }).length === 1);
ck('blank provider/id skipped', paletteCatalogModels({ models: [{ providerId: '', id: 'm' }, { providerId: 'p', id: ' ' }] }).length === 0);

// 搜索：大小写不敏感，provider / 模型名都命中
const byProvider = filterPaletteModels(all, 'TIANMA');
ck('filter matches provider case-insensitively', byProvider.length === 2 && byProvider.every(m => m.providerId === 'tianma'));
const byModel = filterPaletteModels(all, 'flash');
ck('filter matches model name case-insensitively', byModel.length === 3);
const byFull = filterPaletteModels(all, 'DeepSeek/DEEPSEEK-FLASH');
ck('filter matches full provider/model', byFull.length === 1 && byFull[0].id === 'deepseek-flash');
ck('blank query keeps all', filterPaletteModels(all, '   ').length === 4);
ck('no match is empty', filterPaletteModels(all, 'zzz').length === 0);

// 分组 + 计数 + 当前组置顶 + 组内保序
const groups = groupPaletteModels(all, 'deepseek/deepseek-flash');
ck('groups counted', JSON.stringify(groups.map(g => [g.provider, g.count])) === JSON.stringify([['deepseek', 2], ['tianma', 2]]));
ck('current provider group first', groups[0].provider === 'deepseek');
ck('rows keep catalog order inside group', groups[0].rows.map(r => r.id).join(',') === 'deepseek-flash,deepseek-v4-flash');
ck('exactly one current row', groups.flatMap(g => g.rows).filter(r => r.current).length === 1);
ck('current row is the exact key', groups.flatMap(g => g.rows).find(r => r.current)!.key === 'deepseek/deepseek-flash');

// 过滤后的计数按可见行算，且不把被过滤掉的当前组强行置顶
const filtered = filterPaletteModels(all, 'MiniMax');
const filteredGroups = groupPaletteModels(filtered, 'deepseek/deepseek-flash');
ck('filtered counts are visible counts', filteredGroups.length === 1 && filteredGroups[0].count === 2);
ck('current provider not visible does not reorder', filteredGroups[0].provider === 'tianma');

// 裸模型名不猜 provider，因此不会打勾
ck('bare model is not a current key', paletteCurrentKey('MiniMax-M3.1-Flash', all) === null);
ck('bare model view has no checkmark', paletteView({ snapshot: snap, currentModel: 'MiniMax-M3.1-Flash' }).groups.flatMap(g => g.rows).every(r => !r.current));
ck('exact key is the current key', paletteCurrentKey('tianma/MiniMax-M3.1-Flash', all) === 'tianma/MiniMax-M3.1-Flash');

// 三态：loading / 真实错误 / ready + 空态区分
const loading = paletteView({ snapshot: null, loading: true });
ck('loading wins over data', loading.status === 'loading' && loading.groups.length === 0);
const errored = paletteView({ snapshot: snap, error: 'Hub 不支持 read_opencode_catalog' });
ck('real error is surfaced verbatim', errored.status === 'error' && errored.errorText === 'Hub 不支持 read_opencode_catalog');
const emptyView = paletteView({ snapshot: { models: [] }, currentModel: null });
ck('empty catalog is ready with zero total', emptyView.status === 'ready' && emptyView.catalogTotal === 0 && emptyView.total === 0);
const noMatch = paletteView({ snapshot: snap, query: 'zzz', currentModel: null });
ck('search miss keeps catalogTotal', noMatch.total === 0 && noMatch.catalogTotal === 4);
ck('ready view reports current provider', paletteView({ snapshot: snap, currentModel: 'tianma/MiniMax-M3' }).currentProvider === 'tianma');
ck('unknown current reports no provider', paletteView({ snapshot: snap, currentModel: 'MiniMax-M3' }).currentProvider === null);

// 档位：只有目录真的给出 variants 才是 list；缺省 = unknown
const withVariants = { models: [{ providerId: 'p', id: 'm', variants: ['low', 'high'] }, { providerId: 'p', id: 'n' }] };
ck('catalog variants become choices', paletteVariantChoices(withVariants, 'p/m').kind === 'list');
ck('missing variants stay unknown', paletteVariantChoices(withVariants, 'p/n').kind === 'unknown');
ck('unknown model stays unknown', paletteVariantChoices(withVariants, 'p/zzz').kind === 'unknown');
ck('empty variants are explicitly none', paletteVariantChoices({ models: [{ providerId: 'p', id: 'm', variants: [] }] }, 'p/m').kind === 'none');
const vmap = paletteVariantMap(withVariants);
ck('variant map only carries known models', Object.keys(vmap).join(',') === 'p/m');

// 切换确认：ACK + 读回缺一不可
const ack = { update_id: 'u1', status: 'applied', terminal: true, requested_model: 'p/m' };
const afterOk = { model_effective: 'p/m', last_update: ack };
ck('matching ack + readback confirmed', confirmComposerModelSwitch({ after: afterOk, updateId: 'u1', requested: 'p/m' }).confirmed);
ck('missing ack rejected', !confirmComposerModelSwitch({ after: { model_effective: 'p/m' }, updateId: 'u1', requested: 'p/m' }).confirmed);
ck('wrong update id rejected', !confirmComposerModelSwitch({ after: afterOk, updateId: 'u2', requested: 'p/m' }).confirmed);
ck('nonterminal ack rejected', !confirmComposerModelSwitch({ after: { model_effective: 'p/m', last_update: { ...ack, terminal: false } }, updateId: 'u1', requested: 'p/m' }).confirmed);
ck('stale readback rejected', !confirmComposerModelSwitch({ after: { model_effective: 'p/old', last_update: ack }, updateId: 'u1', requested: 'p/m' }).confirmed);
ck('missing model_effective is not confirmed', !confirmComposerModelSwitch({ after: { last_update: ack }, updateId: 'u1', requested: 'p/m' }).confirmed);
ck('missing model_effective with applied ack is ackOnly', confirmComposerModelSwitch({ after: { last_update: ack }, updateId: 'u1', requested: 'p/m' }).ackOnly === true);
ck('stale readback is not ackOnly', !confirmComposerModelSwitch({ after: { model_effective: 'p/old', last_update: ack }, updateId: 'u1', requested: 'p/m' }).ackOnly);
ck('missing ack is not ackOnly', !confirmComposerModelSwitch({ after: {}, updateId: 'u1', requested: 'p/m' }).ackOnly);
ck('null readback rejected', !confirmComposerModelSwitch({ after: null, updateId: 'u1', requested: 'p/m' }).confirmed);

const variantAck = { update_id: 'u2', status: 'applied', terminal: true, requested_model: 'p/m' };
ck('matching variant readback confirmed', confirmComposerVariantSwitch({
  after: { model_effective: 'p/m', modelVariant: 'high', last_update: variantAck },
  updateId: 'u2', requestedModel: 'p/m', requestedVariant: 'high',
}).confirmed);
ck('explicit clear needs explicit null readback', confirmComposerVariantSwitch({
  after: { model_effective: 'p/m', modelVariant: null, last_update: variantAck },
  updateId: 'u2', requestedModel: 'p/m', requestedVariant: null,
}).confirmed);
ck('missing modelVariant is unknown, not clear', !confirmComposerVariantSwitch({
  after: { model_effective: 'p/m', last_update: variantAck },
  updateId: 'u2', requestedModel: 'p/m', requestedVariant: null,
}).confirmed);
ck('wrong variant rejected', !confirmComposerVariantSwitch({
  after: { model_effective: 'p/m', modelVariant: 'low', last_update: variantAck },
  updateId: 'u2', requestedModel: 'p/m', requestedVariant: 'high',
}).confirmed);
ck('variant ack missing rejected', !confirmComposerVariantSwitch({
  after: { model_effective: 'p/m', modelVariant: 'high' },
  updateId: 'u2', requestedModel: 'p/m', requestedVariant: 'high',
}).confirmed);
ck('variant wrong model readback rejected', !confirmComposerVariantSwitch({
  after: { model_effective: 'p/other', modelVariant: 'high', last_update: variantAck },
  updateId: 'u2', requestedModel: 'p/m', requestedVariant: 'high',
}).confirmed);

console.log(`${n}/${n} passed`);
process.exit(0);
