// Daemon 域 SKILLS:显示谁、什么时候显示、不能显示时说什么。纯逻辑,不 import react-native。
//
// 数据就是节点级 SKILLS 同一条链路(list_node_skills / read_node_skill → 门铃 → 节点枚举),
// 目标是这台 daemon 自己的节点行。门铃要 daemon 在线并且上报了 skills_capable === true:
//   - 离线 → 请求发出去只会 60 秒超时,所以不发,直接说离线。会话写了 offline,或 /api/host-supervisors 的心跳
//     (5 分钟窗口)过期,任一个说离线都算(崩溃的 daemon 会话状态会一直停在 idle)。
//   - 没上报 skills_capable(旧 agent-node / 旧 Hub)→ 不猜它会答,说要升级。
//   - skills_capable 只在全量 /api/status 里,?light=1 不带,所以必须读全量会话。
import type { HubNode, Session } from './api';

export type DaemonSkillsEmptyReason = 'loading' | 'no-node' | 'status-unread' | 'no-session' | 'offline' | 'unsupported';

export type DaemonSkillsView =
  | { kind: 'ready' }
  | { kind: 'empty'; reason: DaemonSkillsEmptyReason };

export interface DaemonSkillsInput {
  /** Hub 的 /api/nodes 里这台 daemon 的行;没有就没有目标可发。 */
  node: Pick<HubNode, 'node_id' | 'alias'> | null | undefined;
  /** 全量 /api/status 里这台 daemon 的会话。 */
  session: Pick<Session, 'status' | 'skills_capable'> | null | undefined;
  /** 全量 status 是否已经读过一次(成功或失败)。 */
  statusLoaded: boolean;
  /** 全量 status 读取失败(网络 / 缺 network_id)。 */
  statusFailed: boolean;
  /** /api/host-supervisors 的 online(心跳窗口)。undefined = Hub 没列出它,不当离线。 */
  supervisorOnline?: boolean;
}

export function daemonSkillsView(input: DaemonSkillsInput): DaemonSkillsView {
  if (!input.node?.node_id) return { kind: 'empty', reason: 'no-node' };
  if (!input.statusLoaded) return { kind: 'empty', reason: 'loading' };
  if (input.statusFailed) return { kind: 'empty', reason: 'status-unread' };
  if (!input.session) return { kind: 'empty', reason: 'no-session' };
  if (String(input.session.status ?? '').trim().toLowerCase() === 'offline' || input.supervisorOnline === false) return { kind: 'empty', reason: 'offline' };
  if (input.session.skills_capable !== true) return { kind: 'empty', reason: 'unsupported' };
  return { kind: 'ready' };
}

export const DAEMON_SKILLS_EMPTY_KEY: Record<DaemonSkillsEmptyReason, string> = {
  loading: 'daemon.skills.empty.loading',
  'no-node': 'daemon.skills.empty.noNode',
  'status-unread': 'daemon.skills.empty.statusUnread',
  'no-session': 'daemon.skills.empty.noSession',
  offline: 'daemon.skills.empty.offline',
  unsupported: 'daemon.skills.empty.unsupported',
};
