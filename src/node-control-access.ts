// 节点页「概览」里的「节点操作」卡片:重启 / 停止能不能点、不能点时说什么、下一步给什么(agent-network board #694 第 4 步)。
//
// Vincent 10-07「为什么节点设置里面没有重启节点等按钮」:TMAI狗 是 `anet node start` 手动起的,没有 daemon 管,
// 以前按钮整块藏在「危险操作」里(聊天里打开的只读页连这个分区都没有)⇒ 他根本不知道为什么没有。
// 现在:按钮一直画出来;手动启动的节点置灰,底下一句原因,再给一个能做的下一步 ——
//   - 这台机器上有能收编的 daemon ⇒「交给守护进程管理」(复用 0.2.218 的收编流程 NodeAdoptionControls)
//   - 没有 daemon ⇒ 直说「这台机器上还没有守护进程」
//   - 有 daemon 但它不支持收编(旧版本 / Hub 太旧)⇒ 说要升级,不能骗他说「没有」
//
// 判据全部沿用已有的:
//   - 受不受 daemon 管:dangerActions().handStarted(= Hub 的 lifecycle_controllable === false;undefined 按可控,app#196)
//   - 手动启动但报了 config_update_capable 的节点**能**自己重启(board #586,「重启按能力位放开」)⇒ 重启照样可点
//   - 收编:adoptionSupported / isAdopted(node-adoption.ts),daemon 的 adopt_capable(/api/host-supervisors)
// 纯逻辑,不 import react-native。
import type { HostSupervisorDaemon, HubNode } from './api';
import type { DangerActions } from './node-danger-actions';
import { nodeIsDown } from './node-danger-actions';
import { adoptionSupported, isAdopted } from './node-adoption';
import { registerTranslations, t } from './i18n';

registerTranslations({
  'nodeControl.title': ['节点操作', 'Node actions'],
  'nodeControl.restart': ['重启', 'Restart'],
  'nodeControl.stop': ['停止', 'Stop'],
  'nodeControl.unmanaged': ['这个节点是手动启动的，还没交给守护进程（daemon）管理，所以不能在这里重启。', 'This node was started by hand and is not managed by a daemon yet, so it cannot be restarted here.'],
  'nodeControl.unmanagedStop': ['这个节点是手动启动的，还没交给守护进程（daemon）管理，所以不能在这里停止。', 'This node was started by hand and is not managed by a daemon yet, so it cannot be stopped here.'],
  'nodeControl.adopt': ['交给守护进程管理', 'Hand over to a daemon'],
  'nodeControl.noDaemon': ['这台机器上还没有守护进程', 'There is no daemon on this machine yet'],
  'nodeControl.daemonTooOld': ['这台机器上的守护进程还不支持收编，升级 anet 后可以交给它管理。', 'The daemon on this machine cannot adopt nodes yet. Upgrade anet to hand this node over.'],
  'nodeControl.pointer': ['重启、停止节点在「概览」里。', 'Restart and stop are on the Overview tab.'],
  'nodeControl.pointerOpen': ['去概览', 'Go to Overview'],
});

export type NodeControlMode = 'managed' | 'adopted' | 'unmanaged';
/** 手动启动的节点下面那一行给什么:收编入口 / 没有 daemon / daemon 太旧 / 还不知道(读取中或读失败 ⇒ 什么都不说)。 */
export type NodeControlNext = 'adopt' | 'no_daemon' | 'daemon_cannot_adopt' | null;

export interface NodeControlButton { enabled: boolean; reason: string }

export interface NodeControlView {
  mode: NodeControlMode;
  restart: NodeControlButton;
  stop: NodeControlButton;
  /** 按钮下面那一句(手动启动的节点才有)。 */
  notice: string;
  next: NodeControlNext;
}

export interface NodeControlInput {
  node: HubNode;
  danger: DangerActions;
  online: boolean;
  /** 节点所在机器的主机名(node.hostname ?? 会话上报的)。 */
  hostname?: string | null;
  /** /api/host-supervisors 的结果;undefined = 还没读到或读失败(不下结论)。 */
  daemons: readonly HostSupervisorDaemon[] | undefined;
  /** 收编要求明确的网络(NodeAdoptionControls 同样要求)。 */
  networkId?: string | null;
}

/** 主机名比较:忽略大小写和域名后缀(daemon 可能报 FQDN,节点报短名)。 */
export function sameHost(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (h: string | null | undefined) => (h ?? '').trim().toLowerCase().split('.')[0];
  return !!norm(a) && norm(a) === norm(b);
}

/** 节点所在机器上的 daemon。节点没报主机名时不按机器筛(收编对话框里由人挑)。 */
export function daemonsOnHost(daemons: readonly HostSupervisorDaemon[], hostname: string | null | undefined): HostSupervisorDaemon[] {
  return hostname && hostname.trim() ? daemons.filter(d => sameHost(d.hostname, hostname)) : [...daemons];
}

export function nodeControlView(input: NodeControlInput): NodeControlView {
  const { node, danger } = input;
  const down = nodeIsDown(input.online, node.lifecycle_state);
  // 已收编:停止 / 启动由 daemon 做;重启要先停再起(Hub 拒绝 adopted 的 restart_node)。
  if (isAdopted(node)) {
    return {
      mode: 'adopted',
      restart: { enabled: false, reason: t('adopt.restartHint') },
      stop: down ? { enabled: false, reason: danger.stop.reason || '' } : { enabled: true, reason: '' },
      notice: '', next: null,
    };
  }
  if (!danger.handStarted) {
    return { mode: 'managed', restart: danger.restart, stop: danger.stop, notice: '', next: null };
  }
  const restartOk = danger.restart.enabled;
  const notice = t(restartOk ? 'nodeControl.unmanagedStop' : 'nodeControl.unmanaged');
  return {
    mode: 'unmanaged',
    restart: restartOk ? danger.restart : { enabled: false, reason: notice },
    stop: { enabled: false, reason: t('nodeControl.unmanagedStop') },
    notice,
    next: unmanagedNext(input),
  };
}

function unmanagedNext(input: NodeControlInput): NodeControlNext {
  if (!input.daemons) return null;
  const local = daemonsOnHost(input.daemons, input.hostname ?? input.node.hostname);
  if (local.length === 0) return 'no_daemon';
  const canAdopt = adoptionSupported(input.node) && input.node.managed !== 'created' && !!input.networkId;
  return canAdopt && local.some(d => d.adopt_capable === true) ? 'adopt' : 'daemon_cannot_adopt';
}
