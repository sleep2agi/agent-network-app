// agent-network board #586 —— 手动启动的节点:重启不该跟着停止 / 删除一起置灰。
// ck 风格自执行脚本(npm test = scripts/run-tests.mjs 逐个 spawn)。
import { readFileSync } from 'node:fs';
import { dangerActions, HAND_STARTED_STOP_DELETE_REASON } from './node-danger-actions';

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

// daemon 管着的节点:三个都和以前一样可点(与在线 / 能力无关)
for (const lc of [true, undefined] as const) {
  const a = dangerActions({ lifecycleControllable: lc, online: false, configUpdateCapable: null });
  ck(`lifecycle_controllable=${lc} → 三个都可点(与升级前相同)`, a.restart.enabled && a.stopDelete.enabled && !a.handStarted);
}

// 源码契约:页面按这个函数决定,而不是三个按钮都用 lifecycle_controllable 一刀切
const src = readFileSync(new URL('./NodeDetailScreen.tsx', import.meta.url), 'utf8');
const restartLine = src.split('\n').find(l => l.includes('label="重启节点"')) ?? '';
ck('页面用 dangerActions 决定按钮', src.includes("from './node-danger-actions'") && src.includes('dangerActions('));
ck('重启按钮不再直接看 lifecycle_controllable', restartLine.length > 0 && !restartLine.includes('lifecycle_controllable'));
ck('页面读节点的 config_update_capable(fetchNodeConfig)', src.includes('fetchNodeConfig('));
ck('置灰原因画出来了(restart / stopDelete reason)', src.includes('danger.restart.reason') && src.includes('danger.stopDelete.reason'));

console.log(`${p}/${t} passed`);
process.exit(p === t ? 0 : 1);
