// ck-style：#4099 modelVariant 契约（序列化 omitted/null/string、能力门、切模型档位适配）
import { strict as assert } from 'node:assert';
import { lastUpdateApplied } from './node-model-change';
import { buildConfigPatch, variantValueError, variantWritable, variantChoices, variantAfterModelSwitch } from './node-variant-patch';

let n = 0;
const ck = (name: string, cond: boolean) => { n += 1; assert.ok(cond, name); console.log(`PASS: ${name}`); };

// 1) 序列化：省略 modelVariant → 不带该键（= 不修改档位）
const omitted = buildConfigPatch({ model: 'openai/m2' });
ck('omitted: no modelVariant key', !('modelVariant' in omitted));
ck('omitted: model serialized', omitted.model === 'openai/m2');

// 2) 显式 null → 必须带 null（清除档位）
const cleared = buildConfigPatch({ model: 'openai/m2', modelVariant: null });
ck('null: key present and null', 'modelVariant' in cleared && cleared.modelVariant === null);

// 3) string → 选中档位
const picked = buildConfigPatch({ modelVariant: 'high' });
ck('string: serialized', picked.modelVariant === 'high');
ck('string: no model key when absent', !('model' in picked));

// 4) 同 model 只改档位也能提交（不带 model）
const variantOnly = buildConfigPatch({ modelVariant: 'low' });
ck('same-model variant change: only modelVariant', Object.keys(variantOnly).length === 1 && variantOnly.modelVariant === 'low');

// 5) 校验：空白/控制字符拒绝；省略/null 合法
ck('reject whitespace', variantValueError('hi gh') !== null);
ck('reject control char', variantValueError('a\u0007b') !== null);
ck('accept plain', variantValueError('high') === null);
ck('accept null', variantValueError(null) === null);
ck('accept undefined', variantValueError(undefined) === null);

// 6) 能力门：必须显式声明 + opencode runtime
ck('capable+opencode → ok', variantWritable({ variantCapable: true, runtime: 'opencode-cli' }).ok);
ck('missing capability → blocked', !variantWritable({ variantCapable: false, runtime: 'opencode-cli' }).ok);
ck('unknown capability → blocked', !variantWritable({ runtime: 'opencode' }).ok);
ck('other runtime → blocked', !variantWritable({ variantCapable: true, runtime: 'codex-tui' }).ok);

// 7) 目录档位三态
ck('undefined → unknown', variantChoices(undefined).kind === 'unknown');
ck('[] → none', variantChoices([]).kind === 'none');
const list = variantChoices(['high', 'high', 'low', 42]);
ck('list deduped/filtered', list.kind === 'list' && JSON.stringify(list.options) === JSON.stringify(['high', 'low']));

// 8) 切模型时档位适配
ck('same model keeps', variantAfterModelSwitch({ previousModel: 'a', nextModel: 'a', currentVariant: 'high' }).action === 'keep');
ck('next list includes → keep', variantAfterModelSwitch({ previousModel: 'a', nextModel: 'b', currentVariant: 'high', nextModelVariants: ['high'] }).action === 'keep');
ck('next none → must-reselect (no auto clear)', variantAfterModelSwitch({ previousModel: 'a', nextModel: 'b', currentVariant: 'high', nextModelVariants: [] }).action === 'must-reselect');
ck('next unknown → must-reselect', variantAfterModelSwitch({ previousModel: 'a', nextModel: 'b', currentVariant: 'high', nextModelVariants: undefined }).action === 'must-reselect');
ck('no variant → keep', variantAfterModelSwitch({ previousModel: 'a', nextModel: 'b', currentVariant: null }).action === 'keep');

// ── #4099 last_update 真实形状（server/src/node-config-last-update.ts）联测 ──


// 真实 applied 形状
ck('last_update applied + update_id 对齐 → applied',
  lastUpdateApplied({ update_id: 'u1', status: 'applied', terminal: true, requested_model: 'openai/m2', error: null }, 'u1', 'openai/m2').applied);
// update_id 不一致
ck('update_id 不一致 → 不算 applied',
  !lastUpdateApplied({ update_id: 'u_other', status: 'applied', terminal: true, requested_model: 'openai/m2' }, 'u1', 'openai/m2').applied);
// requested_model 不一致
ck('requested_model 不一致 → 不算 applied',
  !lastUpdateApplied({ update_id: 'u1', status: 'applied', terminal: true, requested_model: 'openai/other' }, 'u1', 'openai/m2').applied);
// 非终态 / unknown
ck('status=pending → 不算 applied',
  !lastUpdateApplied({ update_id: 'u1', status: 'pending', terminal: false }, 'u1', 'openai/m2').applied);
ck('status=unknown → 不算 applied',
  !lastUpdateApplied({ update_id: 'u1', status: 'unknown', terminal: false }, 'u1', 'openai/m2').applied);
ck('status=rejected → 不算 applied',
  !lastUpdateApplied({ update_id: 'u1', status: 'rejected', terminal: true, error: 'OpenCode V2 session is not running' }, 'u1', 'openai/m2').applied);
ck('last_update=null → 不算 applied', !lastUpdateApplied(null, 'u1', 'openai/m2').applied);
ck('last_update 缺失 → 不算 applied', !lastUpdateApplied(undefined, 'u1', 'openai/m2').applied);
// applied 但仍要读回 model_effective 匹配（这里只验 last 判定；组合条件在组件 fixture）
ck('applied 但期望模型为空 → 仅按 last 判定', lastUpdateApplied({ update_id: 'u1', status: 'applied', terminal: true }, 'u1', null).applied);

console.log(`${n}/${n} passed`);
process.exit(0);
