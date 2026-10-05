// 节点页「危险操作」里三个按钮能不能点、不能点时说什么(agent-network board #586)。
//
// 重启和停止 / 删除走的不是同一条路,所以不能一起置灰:
//   - 停止 / 删除:要节点所在机器上的 daemon 来执行。Hub 在 GET /api/nodes 的
//     `lifecycle_controllable` 里说能不能(app#196)。手动起的节点(`anet node start`)
//     没有 daemon 管 ⇒ 只能在那台机器上操作。
//   - 重启:Hub 的 restart_node 只是给节点推一个 restart 事件,节点自己 exit 75、
//     启动器原地拉起 —— **不需要 daemon**。节点在 config_snapshot 里上报
//     `config_update_capable`(GET /api/nodes/:id/config 读得到)就说明它会这么做。
//     所以手动起的节点只要在线、且报了这个能力,重启就能用(anet 2.3.0-preview.144,agent-network #2404)。
//
// 三态:configUpdateCapable 为 undefined = 还没读到(读的时候按钮先不亮,免得点了才被拒),
// null = Hub 没有 config 接口或读失败(按不支持说)。
// 🔴 lifecycle_controllable 为 undefined(旧 Hub 没这个字段)仍按可控渲染,与 app#196 一致。

export interface DangerActionInput {
  /** Hub `/api/nodes` 的 lifecycle_controllable;旧 Hub 没有 ⇒ undefined。 */
  lifecycleControllable: boolean | undefined;
  /** 会话状态不是 offline。 */
  online: boolean;
  /** GET /api/nodes/:id/config 的 config_update_capable;undefined = 读取中,null = 读不到。 */
  configUpdateCapable: boolean | null | undefined;
}

export interface DangerActionState {
  enabled: boolean;
  /** 置灰时显示在按钮下面的一句话;可点时为空串。 */
  reason: string;
}

export interface DangerActions {
  restart: DangerActionState;
  /** 停止和删除的判据相同,共用一个原因。 */
  stopDelete: DangerActionState;
  /** 是不是「手动启动、没有 daemon 管」的节点(说明文案用)。 */
  handStarted: boolean;
}

export const HAND_STARTED_STOP_DELETE_REASON = '这个节点是手动启动的，只能在它所在的机器上停止 / 删除。';

export function dangerActions(input: DangerActionInput): DangerActions {
  const handStarted = input.lifecycleControllable === false;
  const stopDelete: DangerActionState = handStarted
    ? { enabled: false, reason: HAND_STARTED_STOP_DELETE_REASON }
    : { enabled: true, reason: '' };

  // daemon 管着(或旧 Hub 不说):重启和以前一样,走 daemon / Hub,出错由 Hub 拒绝并显示。
  if (!handStarted) return { restart: { enabled: true, reason: '' }, stopDelete, handStarted };

  // 手动启动的节点:靠节点自己 exit 75 重启 —— 它得在线,并且报了 config_update_capable。
  let restart: DangerActionState;
  if (!input.online) {
    restart = { enabled: false, reason: '节点离线，无法远程重启。请在它所在的机器上启动。' };
  } else if (input.configUpdateCapable === undefined) {
    restart = { enabled: false, reason: '正在确认这个节点是否支持远程重启…' };
  } else if (input.configUpdateCapable === true) {
    restart = { enabled: true, reason: '' };
  } else {
    restart = { enabled: false, reason: '这个节点的版本不支持远程重启。请在它所在的机器上升级或重启。' };
  }
  return { restart, stopDelete, handStarted };
}
