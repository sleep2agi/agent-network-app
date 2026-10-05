// agent-network board #586 —— 手动启动的节点:重启不该跟着停止 / 删除一起置灰。
// ck 风格自执行脚本(npm test = scripts/run-tests.mjs 逐个 spawn)。
import { readFileSync } from 'node:fs';
import { actionMessageTone, dangerActions, HAND_STARTED_STOP_DELETE_REASON, START_OUTCOME_MESSAGE, START_SUBMITTED_MESSAGE, startErrorMessage, startWatchOutcome } from './node-danger-actions';

let p = 0, t = 0;
const ck = (n: string, c: boolean) => { t++; if (c) { p++; console.log('✅', n); } else console.error('❌', n); };

// 手动启动(lifecycle_controllable=false)
const hand = (online: boolean, cap: boolean | null | undefined) => dangerActions({ lifecycleControllable: false, online, configUpdateCapable: cap });
ck('手动启动 + 在线 + config_update_capable → 重启可点', hand(true, true).restart.enabled && hand(true, true).restart.reason === '');
ck('手动启动 → 停止 / 删除仍然置灰', !hand(true, true).stopDelete.enabled);
ck('手动启动 → 停止 / 删除的原因是那一句', hand(true, true).stopDelete.reason === HAND_STARTED_STOP_DELETE_REASON && HAND_STARTED_STOP_DELETE_REASON.includes('手动启动'));
ck('手动启动 + 离线 → 重启置灰,原因说离线', !hand(false, true).restart.enabled && hand(false, true).restart.reason.includes('离线'));
ck('手动启动 + 在线 + 不支持 → 重启置灰,原因说不支持', !hand(true, false).restart.enabled && hand(true, false).restart.reason.includes('不支持'));
ck('手动启动 + Hub 读不到 config(null) → 按不支持', !hand(true, null).restart.enabled && hand(true, null).restart.reason.includes('不支持'));
ck('手动启动 + 还在读 → 先不亮,有原因', !hand(true, undefined).restart.enabled && hand(true, undefined).restart.reason.length > 0);
ck('置灰时一定有原因(不是静默变灰)', [hand(false, true), hand(true, false), hand(true, null), hand(true, undefined)].every(a => a.restart.reason.length > 0 && a.stopDelete.reason.length > 0));

// daemon 管着的节点、在跑:三个都和以前一样可点(与能力无关)。停了的情况见文件末尾(#715 复审)。
for (const lc of [true, undefined] as const) {
  const a = dangerActions({ lifecycleControllable: lc, online: true, configUpdateCapable: null });
  ck(`lifecycle_controllable=${lc} + 在线 → 三个都可点(与升级前相同)`, a.restart.enabled && a.stop.enabled && a.stopDelete.enabled && !a.handStarted);
}

// 源码契约:页面按这个函数决定,而不是三个按钮都用 lifecycle_controllable 一刀切
const src = readFileSync(new URL('./NodeDetailScreen.tsx', import.meta.url), 'utf8');
const restartLine = src.split('\n').find(l => l.includes('label="重启节点"')) ?? '';
ck('页面用 dangerActions 决定按钮', src.includes("from './node-danger-actions'") && src.includes('dangerActions('));
ck('重启按钮不再直接看 lifecycle_controllable', restartLine.length > 0 && !restartLine.includes('lifecycle_controllable'));
ck('页面读节点的 config_update_capable(fetchNodeConfig)', src.includes('fetchNodeConfig('));
ck('置灰原因画出来了(restart / stopDelete reason)', src.includes('danger.restart.reason') && src.includes('danger.stopDelete.reason'));

// agent-network board #585 —— 「启动节点」:停掉之后要能从 app 里拉回来(start_node 走 daemon)。
const st = (lc: boolean | undefined, online: boolean, lifecycleState: string | null | undefined) =>
  dangerActions({ lifecycleControllable: lc, online, configUpdateCapable: null, lifecycleState, alias: '示例' }).start;
ck('daemon 管的节点 + 已停止 → 启动可见且可点', st(true, false, 'stopped').visible && st(true, false, 'stopped').enabled && st(true, false, 'stopped').reason === '');
ck('daemon 管的节点 + 离线(lifecycle 未说 stopped)→ 启动可见可点,由 Hub 判', st(true, false, 'active').visible && st(true, false, 'active').enabled);
ck('daemon 管的节点 + 卡在 starting → 仍可点(Hub 60s 后允许重派)', st(true, false, 'starting').visible && st(true, false, 'starting').enabled);
ck('daemon 管的节点 + 在线运行 → 启动不出现', !st(true, true, 'active').visible && !st(true, true, null).visible && !st(true, true, undefined).visible);
ck('在线但 Hub 说 stopped(状态还没刷新)→ 启动出现', st(true, true, 'stopped').visible);
ck('旧 Hub(lifecycle_controllable 缺失)+ 离线 → 启动可点,与 app#196 一致', st(undefined, false, undefined).visible && st(undefined, false, undefined).enabled);
ck('手动启动 + 已停止 → 启动置灰,一句话说去那台机器上 anet node start <别名>', st(false, false, 'stopped').visible && !st(false, false, 'stopped').enabled
  && st(false, false, 'stopped').reason === '这个节点是手动启动的，只能在它所在的机器上启动（`anet node start 示例`）。');
ck('手动启动 + 在线 → 启动不出现', !st(false, true, 'active').visible);
ck('加了启动之后重启 / 停止 / 删除判据不变', JSON.stringify(dangerActions({ lifecycleControllable: false, online: true, configUpdateCapable: true, lifecycleState: 'active' }).restart) === JSON.stringify(hand(true, true).restart));
ck('页面画了启动按钮并用 danger.start 决定', src.includes('label="启动节点"') && src.includes('danger.start.visible') && src.includes('danger.start.reason'));
ck('页面把 lifecycle_state 交给 dangerActions', /dangerActions\(\{[^}]*lifecycleState:/.test(src));
const apiSrc = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
ck('api 的生命周期操作包含 start_node', /NodeLifecycleAction = [^;]*'start_node'/.test(apiSrc));

// 提交之后:等上线 / daemon 报失败 / 超时
const w = (online: boolean, lifecycleState: string | null | undefined, sawStarting: boolean, now = 0) => startWatchOutcome({ online, lifecycleState, sawStarting, now, deadline: 100 });
ck('提交后还是离线 + starting → 继续等', w(false, 'starting', true) === 'waiting');
ck('刚提交、读到的还是 stopped(没见过 starting)→ 继续等,不当失败', w(false, 'stopped', false) === 'waiting');
ck('上线且 Hub 改回 active → 已上线', w(true, 'active', true) === 'online' && w(true, null, false) === 'online');
ck('会话在线但 Hub 还记 starting → 继续等', w(true, 'starting', true) === 'waiting');
ck('见过 starting 又回到 stopped → daemon 启动失败', w(false, 'stopped', true) === 'failed');
ck('到期还没上线 → 超时', w(false, 'starting', true, 100) === 'timeout');
ck('提交 / 上线 是绿,超时 是黄,失败 / 错误 是红', actionMessageTone(START_SUBMITTED_MESSAGE) === 'ok' && actionMessageTone(START_OUTCOME_MESSAGE.online) === 'ok'
  && actionMessageTone(START_OUTCOME_MESSAGE.timeout) === 'warn' && actionMessageTone(START_OUTCOME_MESSAGE.failed) === 'error' && actionMessageTone(startErrorMessage('node_not_stopped')) === 'error');
ck('原有三条「已提交」仍是绿', ['重启请求已提交', '停止请求已提交', '删除请求已提交'].every(m => actionMessageTone(m) === 'ok'));
ck('Hub 错误码翻成人话,不认识的原样', startErrorMessage('daemon_not_resolvable').includes('daemon') && startErrorMessage('node_already_starting').includes('正在启动') && startErrorMessage('HTTP 500') === 'HTTP 500');

// 复审(#715):daemon 管的节点停了 —— 重启救不活、停止没意义;删除照常。手动启动的停止节点保持原样。
const down = (lifecycleState: string | null | undefined, online = false) =>
  dangerActions({ lifecycleControllable: true, online, configUpdateCapable: null, lifecycleState, alias: '示例' });
ck('托管 + 已停止 → 启动可点', down('stopped').start.enabled);
ck('托管 + 已停止 → 重启置灰,原因「节点已停止，请先启动」', !down('stopped').restart.enabled && down('stopped').restart.reason === '节点已停止，请先启动。');
ck('托管 + 已停止 → 停止置灰,原因「节点已停止」', !down('stopped').stop.enabled && down('stopped').stop.reason === '节点已停止。');
ck('托管 + 已停止 → 删除仍可点', down('stopped').stopDelete.enabled && down('stopped').stopDelete.reason === '');
ck('托管 + 离线(active)→ 同样按已停止处理', !down('active').restart.enabled && !down('active').stop.enabled && down('active').start.enabled);
ck('托管 + 在线运行 → 重启 / 停止 / 删除都可点,无原因', (() => { const a = down('active', true); return a.restart.enabled && a.stop.enabled && a.stopDelete.enabled && !a.start.visible && a.restart.reason === '' && a.stop.reason === ''; })());
ck('手动启动 + 已停止 → 与之前相同(重启说离线,停止 / 删除说手动启动)', (() => { const a = dangerActions({ lifecycleControllable: false, online: false, configUpdateCapable: true, lifecycleState: 'stopped', alias: '示例' });
  return !a.restart.enabled && a.restart.reason.includes('离线') && !a.stop.enabled && a.stop.reason === HAND_STARTED_STOP_DELETE_REASON && !a.stopDelete.enabled; })());
ck('页面的停止按钮用 danger.stop 决定', /label="停止节点"[^\n]*danger\.stop\.enabled/.test(src) && src.includes('danger.stop.reason'));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
