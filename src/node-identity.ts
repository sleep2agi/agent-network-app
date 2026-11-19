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
      ? '节点列表暂时拉取失败（这个会话在服务器上是存在的），稍后自动重试。'
      : '服务器上找不到这个会话（可能属于别的网络），暂不能做启动/停止操作。';
  }
  return '这个会话还没在服务器上登记，暂不能做启动/停止操作。';
}

/** idle 时 hub 仍带着节点最后处理的那条内容;标题要说清那是「最近」不是「当前」。 */
export function taskSectionTitle(status: string | undefined): string {
  return status === 'working' ? '当前任务' : '最近任务';
}
