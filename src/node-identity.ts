// 节点详情页「身份/操作区」的文案判定(Vincent 09-03 00:5x 截图:上面显示了节点 ID,
// 下面却说「该会话没有权威节点 ID」—— 因为节点列表那一次拉取失败/未返回时代码把
// node 置空)。把三种状态分开说,并且拉取失败时**保留上一次结果**由调用方保证。
import type { HubNode, Session } from './api';

export type NodeListState = 'loading' | 'loaded' | 'failed';

export function nodeIdentityNotice(session: Pick<Session, 'node_id'>, node: HubNode | null, listState: NodeListState): string | null {
  if (node) return null;
  if (listState === 'loading') return '正在读取节点信息…';
  if (session.node_id) {
    return listState === 'failed'
      ? `节点列表暂时拉取失败（节点 ID ${session.node_id} 在 hub 上存在），稍后自动重试。`
      : `hub 的节点列表里没有 ${session.node_id}（可能属于别的网络），生命周期操作不可用。`;
  }
  return '该会话没有权威节点 ID，生命周期操作不可用。';
}

/** idle 时 hub 仍带着节点最后处理的那条内容;标题要说清那是「最近」不是「当前」。 */
export function taskSectionTitle(status: string | undefined): string {
  return status === 'working' ? '当前任务' : '最近任务';
}
