// 侧栏分组视图的纯逻辑断言(0.477)。跑法:bun src/agent-list-grouping.test.ts
//
// 钉住三件事:
// 1) Session.status 的每种写法都能落到唯一分区,认不出的进「未上报」而不是「在线」;
// 2) 分区顺序固定:正在工作 → 在线 → 异常 → 离线 → 未上报(离线必须沉底,不许浮上来);
// 3) 存储读回 fail-safe:空/损坏/未来维度一律退回 department。
import { effectiveGroupBy, groupByHint, groupUnlockHint, headerViewSuffix, groupByLabel, groupCountLabel, groupForQuery, groupHeaderHint, nextGroupBy, parseGroupBy, runtimeGroupOf, runtimeGroupRank, statusGroupOf, statusGroupRank, STATUS_GROUP_ORDER, UNKNOWN_GROUP } from './agent-list-grouping';

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
ck('未知维度(未来版本)退回 department', parseGroupBy('host') === 'department');

// 4) 提示文案能表明两种视图的差别
ck('status 提示写明在线态', groupByHint('status').includes('在线'));
ck('department 提示写明默认', groupByHint('department').includes('默认'));

// 5) 按运行时分区(0.478)
ck('runtime: codex-cli 原样作分区名', runtimeGroupOf('codex-cli') === 'codex-cli');
ck('runtime: opencode-cli 原样', runtimeGroupOf('opencode-cli') === 'opencode-cli');
ck('runtime: 去首尾空白', runtimeGroupOf('  grok-build-cli ') === 'grok-build-cli');
ck('runtime: 空 → 未上报', runtimeGroupOf('') === UNKNOWN_GROUP && runtimeGroupOf(undefined) === UNKNOWN_GROUP);
ck('runtime: 未上报 排最后', runtimeGroupRank(UNKNOWN_GROUP) === 1 && runtimeGroupRank('codex-cli') === 0);

// 6) 三档循环 + 标签
ck('循环: department → status', nextGroupBy('department') === 'status');
ck('循环: status → runtime', nextGroupBy('status') === 'runtime');
ck('循环: runtime → department', nextGroupBy('runtime') === 'department');
ck('循环: 未知值也回到第一档', nextGroupBy('weird' as any) === 'status');
ck('标签: 三档各不相同', new Set([groupByLabel('department'), groupByLabel('status'), groupByLabel('runtime')]).size === 3);
ck('存储: runtime 能读回', parseGroupBy('runtime') === 'runtime');
ck('提示: runtime 写明 codex/opencode', groupByHint('runtime').includes('codex') && groupByHint('runtime').includes('opencode'));

// 7) 分组标题计数(0.480):按部门才显示「在线/总数」
ck('部门视图: 显示 在线/总数', groupCountLabel('department', 3, 7).text === '3/7');
ck('部门视图: a11y 说「在线」', groupCountLabel('department', 3, 7).a11y.includes('在线'));
ck('在线态视图: 只给总数(离线组不会是 0/N)', groupCountLabel('status', 0, 4).text === '4');
ck('在线态视图: a11y 不说「在线」', !groupCountLabel('status', 0, 4).a11y.includes('在线'));
ck('运行时视图: 同样只给总数', groupCountLabel('runtime', 1, 5).text === '5');

// 8) 「未上报」组的解释(0.481)
ck('在线态: 未上报组有解释', !!groupHeaderHint('status', UNKNOWN_GROUP)?.includes('在线态'));
ck('运行时: 未上报组有解释', !!groupHeaderHint('runtime', UNKNOWN_GROUP)?.includes('运行时'));
ck('部门视图不解释(没有「未上报」语义)', groupHeaderHint('department', UNKNOWN_GROUP) === null);
ck('其他组不解释', groupHeaderHint('status', '离线') === null && groupHeaderHint('runtime', 'codex-cli') === null);
ck('解释里给出原因(旧 agent-node / 无节点身份)', (groupHeaderHint('status', UNKNOWN_GROUP) ?? '').includes('agent-node'));

// 9) 搜索前缀联动分区(0.482)
ck('status= 前缀 → 在线态分区', groupForQuery('status=offline') === 'status');
ck('runtime= 前缀 → 运行时分区', groupForQuery('runtime=codex') === 'runtime');
ck('大小写/空白都认', groupForQuery('  STATUS=offline ') === 'status');
ck('普通搜索不改变分区', groupForQuery('苏猫') === null && groupForQuery('model=deepseek') === null);
ck('查询决定维度时优先于用户选择', effectiveGroupBy('department', 'status=offline') === 'status');
ck('查询不指向维度时用用户选择的', effectiveGroupBy('runtime', '苏猫') === 'runtime');

// 10) 标题后缀(0.483)
ck('部门视图不加后缀(默认不用解释)', headerViewSuffix('department') === '');
ck('在线态视图标出「按在线态」', headerViewSuffix('status') === ' · 按在线态');
ck('运行时视图标出「按运行时」', headerViewSuffix('runtime') === ' · 按运行时');

// 11) 搜索锁定分组时的解释(0.484)
ck('status= 查询会给出解锁说明', (groupUnlockHint('status=offline') ?? '').includes('status='));
ck('runtime= 查询会给出解锁说明', (groupUnlockHint('runtime=codex') ?? '').includes('runtime='));
ck('普通搜索没有解锁说明', groupUnlockHint('苏猫') === null);
ck('说明里讲明「已清掉搜索」', (groupUnlockHint('status=offline') ?? '').includes('清掉'));

let bad = 0;
for (const [name, ok] of checks) {
  if (!ok) { console.log(`✗ ${name}`); bad++; }
}
console.log(bad === 0 ? `agent list grouping: ${checks.length}/${checks.length} passed`
  : `agent list grouping: ${checks.length - bad}/${checks.length} passed`);
if (bad) process.exit(1);
