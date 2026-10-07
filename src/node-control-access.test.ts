// board #694 第 4 步 —— 概览「节点操作」的三种门控状态 + 页面接线。
// ck 风格自执行脚本(npm test = scripts/run-tests.mjs 逐个 spawn)。
import { readFileSync } from 'node:fs';
import type { HostSupervisorDaemon, HubNode } from './api';
import { dangerActions } from './node-danger-actions';
import { daemonsOnHost, nodeControlView, sameHost } from './node-control-access';
import { setLanguagePreference, t } from './i18n';

let p = 0, n = 0;
const ck = (name: string, ok: boolean) => { n++; if (ok) { p++; console.log('PASS', name); } else console.error('FAIL', name); };
setLanguagePreference('zh');

const UNMANAGED = '这个节点是手动启动的，还没交给守护进程（daemon）管理，所以不能在这里重启。';
const base: HubNode = { node_id: 'fixture-node', alias: 'fixture', hostname: 'box-a', lifecycle_state: 'active' };
const hand: HubNode = { ...base, lifecycle_controllable: false, managed: 'none', adoption: null };
const daemon = (over: Partial<HostSupervisorDaemon> = {}): HostSupervisorDaemon => ({ daemon_node_id: 'd1', alias: 'fixture-daemon', hostname: 'box-a', adopt_capable: true, ...over });
const view = (node: HubNode, daemons: HostSupervisorDaemon[] | undefined, cap: boolean | null | undefined = false, online = true, networkId: string | null = 'net-fixture') =>
  nodeControlView({ node, online, daemons, networkId, danger: dangerActions({ lifecycleControllable: node.lifecycle_controllable, online, configUpdateCapable: cap, lifecycleState: node.lifecycle_state, alias: node.alias }) });

// 1. daemon 管着的节点 → 重启 / 停止可点,不说话
for (const lc of [true, undefined] as const) {
  const v = view({ ...base, lifecycle_controllable: lc }, undefined);
  ck(`managed (lifecycle_controllable=${lc}) → 重启、停止可点`, v.mode === 'managed' && v.restart.enabled && v.stop.enabled && v.notice === '' && v.next === null);
}
const stopped = view({ ...base, lifecycle_controllable: true, lifecycle_state: 'stopped' }, undefined, null, false);
ck('managed 但已停止 → 置灰且有原因(沿用 dangerActions)', !stopped.restart.enabled && stopped.restart.reason.length > 0 && !stopped.stop.enabled);

// 2. 手动启动 + 这台机器上有能收编的 daemon → 置灰 + 原因 + 收编入口
const adoptable = view(hand, [daemon()]);
ck('unmanaged + 可收编 daemon → 重启置灰', adoptable.mode === 'unmanaged' && !adoptable.restart.enabled);
ck('unmanaged + 可收编 daemon → 停止置灰', !adoptable.stop.enabled);
ck('unmanaged → 原因就是那一句', adoptable.notice === UNMANAGED && adoptable.restart.reason === UNMANAGED);
ck('unmanaged + 可收编 daemon → 给收编入口', adoptable.next === 'adopt');
ck('daemon 报 FQDN、节点报短名也算同一台', view(hand, [daemon({ hostname: 'BOX-A.example.internal' })]).next === 'adopt');

// 3. 手动启动 + 没有 daemon → 置灰 + 原因 +「还没有守护进程」
const none = view(hand, []);
ck('unmanaged + 没有 daemon → 置灰 + 原因', !none.restart.enabled && !none.stop.enabled && none.notice === UNMANAGED);
ck('unmanaged + 没有 daemon → no_daemon', none.next === 'no_daemon');
ck('别的机器上的 daemon 不算', view(hand, [daemon({ hostname: 'box-b' })]).next === 'no_daemon');
ck('no_daemon 文案', t('nodeControl.noDaemon') === '这台机器上还没有守护进程');

// 边界:不能说谎
ck('daemon 列表还没读到 → 不下结论', view(hand, undefined).next === null && view(hand, undefined).notice === UNMANAGED);
ck('同机 daemon 不支持收编 → 说要升级,不说「没有」', view(hand, [daemon({ adopt_capable: false })]).next === 'daemon_cannot_adopt');
ck('Hub 太旧(没有 adoption 投影) → 不给收编入口', view({ ...base, lifecycle_controllable: false }, [daemon()]).next === 'daemon_cannot_adopt');
ck('没有明确网络 → 不给收编入口', view(hand, [daemon()], false, true, null).next === 'daemon_cannot_adopt');
ck('节点没报主机名 → 不按机器筛', daemonsOnHost([daemon({ hostname: 'x' })], null).length === 1 && !sameHost('', ''));
const selfRestart = view(hand, [], true);
ck('手动启动但报了 config_update_capable → 重启照样可点(board #586),停止仍灰', selfRestart.restart.enabled && !selfRestart.stop.enabled && selfRestart.notice.includes('不能在这里停止'));
const adopted = view({ ...hand, managed: 'adopted' }, [daemon()]);
ck('已收编 → 停止可点,重启提示先停再起', adopted.mode === 'adopted' && adopted.stop.enabled && !adopted.restart.enabled && adopted.restart.reason === t('adopt.restartHint'));

// 英文
setLanguagePreference('en');
ck('en 文案', view(hand, []).notice.startsWith('This node was started by hand') && t('nodeControl.adopt') === 'Hand over to a daemon' && t('nodeControl.noDaemon') === 'There is no daemon on this machine yet');
setLanguagePreference('zh');

// 页面接线(源码契约)
const screen = readFileSync(new URL('./NodeDetailScreen.tsx', import.meta.url), 'utf8');
const overview = screen.slice(screen.indexOf("if (section === 'overview') return ("), screen.indexOf("if (section === 'model') return ("));
const model = screen.slice(screen.indexOf("if (section === 'model') return ("), screen.indexOf("if (section === 'rules') return ("));
ck('概览里画节点操作卡片', overview.includes('<NodeControlCard') && overview.includes('nodeControl.title'));
ck('卡片不按 readOnly 隐藏', !/!readOnly\s*&&\s*control|readOnly\s*\?\s*null\s*:\s*control|control\s*&&\s*!readOnly/.test(overview));
ck('收编复用 0.2.218 的 NodeAdoptionControls,直接打开对话框', overview.includes('<NodeAdoptionControls') && overview.includes('initialDialog="adopt"'));
ck('模型与运行时有一句指路', model.includes('node-model-control-pointer') && model.includes("setActiveSection('overview')"));
ck('只读页只放开重启 / 停止', screen.includes("const OVERVIEW_ACTIONS: readonly NodeLifecycleAction[] = ['restart_node', 'stop_node'];") && screen.includes('visible={!!pendingAction && (!readOnly || OVERVIEW_ACTIONS.includes(pendingAction))}'));
const card = readFileSync(new URL('./NodeControlCard.tsx', import.meta.url), 'utf8');
ck('手机按钮 44 高、桌面 34 高', card.includes('minHeight: 44') && card.includes('height: ds(34)'));
ck('置灰而不是隐藏:两个按钮无条件画', (card.match(/<ControlButton /g) ?? []).length === 2 && !/\{view\.\w+\.enabled \? <ControlButton/.test(card));
ck('收编入口用晴蓝(accent)', card.includes('colors.accent'));

console.log(`${p}/${n} passed`);
if (p !== n) process.exit(1);
