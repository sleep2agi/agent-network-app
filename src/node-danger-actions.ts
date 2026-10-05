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
//
// 启动(agent-network board #585):停掉之后要能从 app 里拉回来。restart_node 救不活已停止的节点
// (它没有自己的 SSE 连接收重启事件),Hub 的 start_node 让节点所在机器上的 daemon 把它拉起 ——
// 所以和停止 / 删除一样,只对 daemon 管着的节点可用。只在节点没在跑(离线,或 Hub 说 stopped / starting)
// 时出现;节点在跑时不出现。离线但 Hub 仍记着 active(比如异常退出)也让点,由 Hub 判并把原因显示出来。

export interface DangerActionInput {
  /** Hub `/api/nodes` 的 lifecycle_controllable;旧 Hub 没有 ⇒ undefined。 */
  lifecycleControllable: boolean | undefined;
  /** 会话状态不是 offline。 */
  online: boolean;
  /** GET /api/nodes/:id/config 的 config_update_capable;undefined = 读取中,null = 读不到。 */
  configUpdateCapable: boolean | null | undefined;
  /** Hub `/api/nodes` 的 lifecycle_state(stopped / starting / active …);旧 Hub 可能没有。 */
  lifecycleState?: string | null;
  /** 节点别名(手动启动节点的说明里要写出 `anet node start <别名>`)。 */
  alias?: string;
}

export interface DangerActionState {
  enabled: boolean;
  /** 置灰时显示在按钮下面的一句话;可点时为空串。 */
  reason: string;
}

export interface StartActionState extends DangerActionState {
  /** 节点在跑时不出现。 */
  visible: boolean;
}

export interface DangerActions {
  /** board #585 —— 启动节点。 */
  start: StartActionState;
  restart: DangerActionState;
  /** 停止按钮。手动启动 = stopDelete;daemon 管的节点停了再停没意义 ⇒ 置灰。 */
  stop: DangerActionState;
  /** 删除按钮(以及手动启动时的停止)。名字沿用 #712。 */
  stopDelete: DangerActionState;
  /** 是不是「手动启动、没有 daemon 管」的节点(说明文案用)。 */
  handStarted: boolean;
}

export const HAND_STARTED_STOP_DELETE_REASON = '这个节点是手动启动的，只能在它所在的机器上停止 / 删除。';

export const STOPPED_RESTART_REASON = '节点已停止，请先启动。';
export const STOPPED_STOP_REASON = '节点已停止。';

export const handStartedStartReason = (alias: string) =>
  `这个节点是手动启动的，只能在它所在的机器上启动（\`anet node start ${alias}\`）。`;

/** 节点没在跑:会话离线,或 Hub 说它已停止 / 正在启动(会话状态可能还没刷新)。 */
export const nodeIsDown = (online: boolean, lifecycleState: string | null | undefined) =>
  !online || lifecycleState === 'stopped' || lifecycleState === 'starting';

export function dangerActions(input: DangerActionInput): DangerActions {
  const handStarted = input.lifecycleControllable === false;
  const stopDelete: DangerActionState = handStarted
    ? { enabled: false, reason: HAND_STARTED_STOP_DELETE_REASON }
    : { enabled: true, reason: '' };
  const down = nodeIsDown(input.online, input.lifecycleState);
  const start: StartActionState = !down
    ? { visible: false, enabled: false, reason: '' }
    : handStarted
      ? { visible: true, enabled: false, reason: handStartedStartReason(input.alias ?? '<别名>') }
      : { visible: true, enabled: true, reason: '' };

  // daemon 管着(或旧 Hub 不说),在跑:三个都和以前一样,出错由 Hub 拒绝并显示。
  // 没在跑(#715 复审):restart_node 救不活已停止的节点,再停一次也没意义 —— 重启 / 停止置灰,删除照常。
  if (!handStarted) {
    if (down) {
      return {
        start,
        restart: { enabled: false, reason: STOPPED_RESTART_REASON },
        stop: { enabled: false, reason: STOPPED_STOP_REASON },
        stopDelete, handStarted,
      };
    }
    return { start, restart: { enabled: true, reason: '' }, stop: stopDelete, stopDelete, handStarted };
  }

  // 手动启动的节点:靠节点自己 exit 75 重启 —— 它得在线,并且报了 config_update_capable。
  let restart: DangerActionState;
  if (!input.online) {
    restart = { enabled: false, reason: '节点离线，无法远程重启。' };
  } else if (input.configUpdateCapable === undefined) {
    restart = { enabled: false, reason: '正在确认这个节点是否支持远程重启…' };
  } else if (input.configUpdateCapable === true) {
    restart = { enabled: true, reason: '' };
  } else {
    restart = { enabled: false, reason: '这个节点的版本不支持远程重启。请在它所在的机器上升级或重启。' };
  }
  return { start, restart, stop: stopDelete, stopDelete, handStarted };
}

// ── board #585:提交启动之后,页面怎么说 ─────────────────────────────────────────
// Hub 收下 start_node 时把 lifecycle_state 改成 starting;daemon 拉起成功 ack 后改回 active,失败改回 stopped。
// 页面本来就每 10s 读一次节点(usePoll),所以「等它上线」只是看这两个值,不另起轮询。

export const START_SUBMITTED_MESSAGE = '启动请求已提交，正在等节点上线…';
export const START_WAIT_MS = 120_000;

export type StartWatchOutcome = 'waiting' | 'online' | 'failed' | 'timeout';

export function startWatchOutcome(w: { online: boolean; lifecycleState: string | null | undefined; sawStarting: boolean; now: number; deadline: number }): StartWatchOutcome {
  if (w.online && w.lifecycleState !== 'stopped' && w.lifecycleState !== 'starting') return 'online';
  // 先看到过 starting、又回到 stopped = daemon 报了启动失败。
  if (w.sawStarting && w.lifecycleState === 'stopped' && !w.online) return 'failed';
  if (w.now >= w.deadline) return 'timeout';
  return 'waiting';
}

export const START_OUTCOME_MESSAGE: Record<Exclude<StartWatchOutcome, 'waiting'>, string> = {
  online: '节点已上线。',
  failed: '启动失败：daemon 没能把节点拉起来，请到它所在的机器上看一下。',
  timeout: '2 分钟内节点还没上线。可以稍后再看，或到它所在的机器上检查。',
};

/** Hub start_node 的错误码 → 一句人话;不认识的原样显示。 */
export function startErrorMessage(error: string): string {
  switch (error) {
    case 'node_not_stopped': return '这个节点不是「已停止」状态，暂时不能启动。可以先停止，再启动。';
    case 'node_already_starting': return '节点正在启动，请稍等一会儿再看。';
    case 'daemon_not_resolvable':
    case 'daemon_not_found':
    case 'daemon_child_mismatch':
      return '找不到管理这个节点的 daemon，只能在它所在的机器上启动。';
    case 'permission_denied': return '你没有权限启动这个节点。';
    default: return error;
  }
}

/** 操作结果那一行的颜色:成功绿、还在等/超时黄、出错红。 */
export function actionMessageTone(message: string): 'ok' | 'warn' | 'error' {
  if (message.includes('已提交') || message.includes('已上线')) return 'ok';
  if (message.includes('还没上线')) return 'warn';
  return 'error';
}
