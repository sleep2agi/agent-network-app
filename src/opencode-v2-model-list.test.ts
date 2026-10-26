import { catalogErrorText, isOpenCodeV2Node, modelIdsFromCatalog, reportedCatalogModels, reportsCatalogSince } from './opencode-v2-model-list';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else { console.error('❌', n); } };

ck('v2 flag is a V2 node even if runtime label differs', isOpenCodeV2Node({ runtime: 'opencode-sdk', config_snapshot: { flags: { opencodeGeneration: 'v2' } } }));
ck('explicit v1 is not', isOpenCodeV2Node({ runtime: 'opencode-cli', config_snapshot: { flags: { opencodeGeneration: 'v1' } } }) === false);
ck('unknown generation still tries the server list for OpenCode runtimes', isOpenCodeV2Node({ runtime: 'opencode-sdk', config_snapshot: null }));
ck('other runtimes are not', isOpenCodeV2Node({ runtime: 'codex-sdk', config_snapshot: null }) === false);

const ids = modelIdsFromCatalog({
  providers: [{ id: 'deepseek', activation: 'enabled' }, { id: 'off', activation: 'disabled' }],
  models: [
    { providerId: 'deepseek', id: 'deepseek-flash' },
    { providerId: 'off', id: 'secret-model' },
    { providerId: 'deepseek', id: 'deepseek-flash' },
    { providerId: 'openai', id: 'gpt-6' },
  ],
});
ck('keeps provider/model and drops disabled providers and duplicates', JSON.stringify(ids) === JSON.stringify(['deepseek/deepseek-flash', 'openai/gpt-6']));
ck('empty snapshot is an empty list, not a builtin fallback', modelIdsFromCatalog(null).length === 0);
ck('not_opencode_v2 is readable', catalogErrorText('not_opencode_v2').includes('不是 OpenCode V2'));

// #2293 —— 节点自报清单：只保留 provider/model 形状，去重保序，不补内置。
ck('reported catalog: 保留 provider/model、去重、保序',
  JSON.stringify(reportedCatalogModels(['deepseek/deepseek-flash', 'deepseek/deepseek-flash', 'opencode/mimo-v2.6-flash-free']))
  === JSON.stringify(['deepseek/deepseek-flash', 'opencode/mimo-v2.6-flash-free']));
ck('reported catalog: 不像模型 id 的一律丢掉（空串 / 没有斜杠 / 非字符串 / 超长）',
  reportedCatalogModels(['', 'deepseek', 7 as unknown as string, null as unknown as string, 'a/'.padEnd(500, 'x')]).length === 0);
ck('reported catalog: 缺字段/旧 Hub → 空数组（不是内置表）', reportedCatalogModels(null).length === 0 && reportedCatalogModels([]).length === 0);

// #2293 —— 版本门槛：catalog 是 agent-node 2.5.0-preview.160 起才真正上报的。
ck('reportsCatalogSince: .160 起为真', reportsCatalogSince('2.5.0-preview.160') === true && reportsCatalogSince('2.5.0-preview.161') === true);
ck('reportsCatalogSince: .146 / .159 为假（正是 TMAI欧 / 空转版）', reportsCatalogSince('2.5.0-preview.146') === false && reportsCatalogSince('2.5.0-preview.159') === false);
ck('reportsCatalogSince: 看不懂的版本不判断（null）', reportsCatalogSince('dev') === null && reportsCatalogSince('') === null && reportsCatalogSince(null) === null && reportsCatalogSince('2.6.0-preview.200') === null);

console.log(`\n${p}/${t} 通过`);
if (p !== t) process.exit(1);
