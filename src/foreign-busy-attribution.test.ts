// #4460 —— 回执归属：只有「本次写入」的 last_update 才能解释结果。
//   run: bun src/foreign-busy-attribution.test.ts
//
// 背景：上一次/别人的写入留下的 `variant_busy`，曾被渲染成「这一轮还在跑，档位会对下一轮生效」，
// 让人以为这次点了、排上了 —— 其实那次写入根本没被接受。
import { variantOutcomeOf } from './variant-outcome';
import type { NodeConfigRead } from './api';

let passed = 0;
let total = 0;
const ck = (name: string, cond: boolean, extra?: unknown) => {
  total += 1;
  if (cond) passed += 1;
  else console.log('❌', name, extra === undefined ? '' : JSON.stringify(extra));
};

const read = (last: NodeConfigRead['last_update'], modelVariant?: string | null): NodeConfigRead => ({
  node_id: 'n1',
  config_revision: 1,
  model: 'p/m',
  model_effective: 'p/m',
  config_update_capable: true,
  ...(modelVariant === undefined ? {} : { modelVariant }),
  last_update: last,
} as NodeConfigRead);

const write = { target: 'high', effectiveModel: 'p/m', updateId: 'mine' };

// ① 他次的 busy 不得被当成本次「排队生效」
{
  const foreign = read({ update_id: 'other', status: 'rejected', terminal: true, error: 'variant_busy' });
  const out = variantOutcomeOf(foreign, write);
  ck('foreign variant_busy is NOT rendered as this write being queued', out.kind !== 'busy', out);
  ck('foreign variant_busy explains the id mismatch instead', /update_id|不一致/.test(out.text), out);
}

// ② 本次的 busy 仍然是「跑完再切」（中性、不是失败）
{
  const mine = read({ update_id: 'mine', status: 'rejected', terminal: true, error: 'variant_busy' });
  const out = variantOutcomeOf(mine, write);
  ck('own variant_busy stays neutral busy', out.kind === 'busy' && out.tone === 'neutral', out);
}

// ③ 本次 applied + 顶层 modelVariant 对齐 ⇒ applied
{
  const ok = read({ update_id: 'mine', status: 'applied', terminal: true, requested_model: 'p/m' }, 'high');
  const out = variantOutcomeOf(ok, write);
  ck('own applied with matching top-level variant is success', out.kind === 'applied', out);
}

// ④ applied 但快照未跟上 ⇒ lagging（不重发），且不因为缺 variant 就报失败
{
  const lag = read({ update_id: 'mine', status: 'applied', terminal: true, requested_model: 'p/m' }, 'low');
  ck('own applied with stale variant is lagging', variantOutcomeOf(lag, write).kind === 'lagging');
}

// ⑤ 他次的 applied 也不能算本次成功（update_id 闸）
{
  const foreign = read({ update_id: 'other', status: 'applied', terminal: true, requested_model: 'p/m' }, 'high');
  const out = variantOutcomeOf(foreign, write);
  ck('foreign applied never counts as this write', out.kind !== 'applied', out);
}

console.log(`foreign-busy-attribution: ${passed}/${total}`);
process.exit(passed === total ? 0 : 1);
