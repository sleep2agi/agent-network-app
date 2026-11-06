// 侧栏分组视图的纯逻辑断言(0.477)。跑法:bun src/agent-list-grouping.test.ts
//
// 钉住三件事:
// 1) Session.status 的每种写法都能落到唯一分区,认不出的进「未上报」而不是「在线」;
// 2) 分区顺序固定:正在工作 → 在线 → 异常 → 离线 → 未上报(离线必须沉底,不许浮上来);
// 3) 存储读回 fail-safe:空/损坏/未来维度一律退回 department。
import { groupByHint, parseGroupBy, statusGroupOf, statusGroupRank, STATUS_GROUP_ORDER } from './agent-list-grouping';

const checks: [string, boolean][] = [];
const ck = (name: string, ok: boolean) => checks.push([name, ok]);

// 1) 状态映射
for (const s of ['working', 'WORKING', ' running ', 'Running']) ck(`「${s}」= 正在工作`, statusGroupOf(s) === '正在工作');
for (const s of ['online', 'idle', ' Online ']) ck(`「${s}」= 在线`, statusGroupOf(s) === '在线');
for (const s of ['error', 'failed']) ck(`「${s}」= 异常`, statusGroupOf(s) === '异常');
for (const s of ['offline', 'down']) ck(`「${s}」= 离线`, statusGroupOf(s) === '离线');
for (const s of [undefined, null, '', '   ', 'sleeping', 'whatever']) ck(`「${String(s)}」= 未上报(不猜)`, statusGroupOf(s as any) === '未上报');

// 2) 顺序:离线/未上报必须在在线之后
ck('顺序:正在工作 最前', statusGroupRank('正在工作') === 0);
ck('顺序:离线 排在 在线 之后', statusGroupRank('离线') > statusGroupRank('在线'));
ck('顺序:未上报 最末', statusGroupRank('未上报') === STATUS_GROUP_ORDER.length - 1);
ck('顺序覆盖 5 类且不重复', new Set(STATUS_GROUP_ORDER).size === 5);

// 3) 存储读回
ck('保存 status 能读回', parseGroupBy('status') === 'status');
ck('保存 department 能读回', parseGroupBy('department') === 'department');
ck('空串退回 department', parseGroupBy('') === 'department');
ck('null 退回 department', parseGroupBy(null) === 'department');
ck('未知维度(未来版本)退回 department', parseGroupBy('runtime') === 'department');

// 4) 提示文案能表明两种视图的差别
ck('status 提示写明在线态', groupByHint('status').includes('在线'));
ck('department 提示写明默认', groupByHint('department').includes('默认'));

let bad = 0;
for (const [name, ok] of checks) {
  if (!ok) { console.log(`✗ ${name}`); bad++; }
}
console.log(bad === 0 ? `agent list grouping: ${checks.length}/${checks.length} passed`
  : `agent list grouping: ${checks.length - bad}/${checks.length} passed`);
if (bad) process.exit(1);
