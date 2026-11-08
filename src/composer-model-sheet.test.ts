// ck-style（由 scripts/run-tests.mjs 执行）。#4130 只读面板模型：只认上报值，不猜 Provider，档位明确不可确定。
import { strict as assert } from 'node:assert';
import { modelSheet, providerGroups, switchAvailability } from './composer-model-sheet';

let n = 0;
const ck = (name: string, cond: boolean) => { n += 1; assert.ok(cond, name); console.log(`PASS: ${name}`); };
const row = (m: ReturnType<typeof modelSheet>, key: string) => m.rows.find(r => r.key === key)!;

// 有上报：当前模型 + provider 前缀
const full = modelSheet({ reported: { model: 'openai/gpt-5-codex', runtime: 'opencode' }, catalog: null });
ck('current row shows runtime · model', row(full, 'current').value === 'opencode · openai/gpt-5-codex');
ck('provider from reported model', row(full, 'provider').value === 'openai');
ck('hasCurrent true', full.hasCurrent);

// 裸模型名不猜 provider
const bare = modelSheet({ reported: { model: 'gpt-5-codex' }, catalog: null });
ck('bare model provider not guessed', row(bare, 'provider').value === '未上报（不从裸模型名猜）');

// 无上报：当前模型说明，不编造
const none = modelSheet({ reported: null, catalog: null });
ck('no report → unknown row', row(none, 'current').value.includes('尚未上报'));
ck('no report → hasCurrent false', !none.hasCurrent);

// catalog 分组计数与排序
const cat = { models: [{ providerId: 'openai', id: 'a' }, { providerId: 'openai', id: 'b' }, { providerId: 'anthropic', id: 'c' }] };
ck('groups counted + sorted', JSON.stringify(providerGroups(cat)) === JSON.stringify([{ provider: 'anthropic', count: 1 }, { provider: 'openai', count: 2 }]));
const withCat = modelSheet({ reported: { model: 'openai/a' }, catalog: cat });
ck('catalog row lists groups', row(withCat, 'catalog').value.includes('openai(2)') && row(withCat, 'catalog').value.includes('共 3 个'));

// catalog 错误原因原样展示
const err = modelSheet({ reported: null, catalog: null, catalogError: 'Hub 不支持 read_opencode_catalog' });
ck('catalog error surfaced', row(err, 'catalog').value.includes('Hub 不支持 read_opencode_catalog'));

// 空目录
const empty = modelSheet({ reported: null, catalog: { models: [] } });
ck('empty catalog explained', row(empty, 'catalog').value.includes('空'));

// 档位：三态区分
ck('variants unknown when field missing', row(full, 'variants').value.includes('尚未提供'));
ck('variantsKnown false when missing', full.variantsKnown === false);
const noneV = modelSheet({ reported: { model: 'm' }, catalog: null, variants: [] });
ck('variants empty → 明确没有', row(noneV, 'variants').value.includes('没有可选档位'));
ck('variants empty → known', noneV.variantsKnown === true);
const someV = modelSheet({ reported: { model: 'm' }, catalog: null, variants: ['low', 'high'] });
ck('variants listed read-only', row(someV, 'variants').value.includes('low · high') && row(someV, 'variants').value.includes('未接入写入'));
ck('variants listed → known', someV.variantsKnown === true);

// 切换：按能力判定
ck('no target → disabled', switchAvailability({ hasTarget: false }).enabled === false);
ck('no target reason', switchAvailability({ hasTarget: false }).reason.includes('无目标绑定'));
ck('hub without write → disabled', switchAvailability({ hasTarget: true, configUpdateCapable: false, optionCount: 2 }).enabled === false);
ck('no options → disabled', switchAvailability({ hasTarget: true, configUpdateCapable: true, optionCount: 0 }).enabled === false);
const okSw = switchAvailability({ hasTarget: true, configUpdateCapable: true, optionCount: 3 });
ck('capable → enabled', okSw.enabled === true);
ck('capable reason mentions readback', okSw.reason.includes('回读'));

// 全部行只读（本轮没有任何写操作入口）
ck('all rows readOnly', full.rows.every(r => r.readOnly === true));

console.log(`${n}/${n} passed`);
process.exit(0);
