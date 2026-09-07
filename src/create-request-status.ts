// 桌面向导:create_node 下发后,除了等「子节点注册」,还读 hub 的 GET /api/node-create-requests?request_id=
// (commhub-server ≥ 含该接口的版本;老 hub 404 → 当作「不知道」,行为退回只等注册)。
// 纯函数:把 daemon 回的 status/error 变成向导该显示的话。

export type CreateRequestStatus = 'pending' | 'delivered' | 'started' | 'failed' | 'rejected' | 'runtime_capability_check_failed' | string;

export interface CreateRequestRow {
  request_id?: string;
  status?: CreateRequestStatus;
  error?: string | null;
  runtime?: string | null;
  child_name?: string | null;
}

export type CreateRequestVerdict =
  | { kind: 'unknown' }                       // 老 hub / 还没读到
  | { kind: 'waiting'; text: string }         // pending / delivered / started:继续等注册
  | { kind: 'failed'; text: string };         // daemon 明确说失败:停止等待,显示原因

const FAILED = new Set(['failed', 'rejected', 'runtime_capability_check_failed']);

export function createRequestVerdict(row: CreateRequestRow | null | undefined): CreateRequestVerdict {
  if (!row || !row.status) return { kind: 'unknown' };
  const status = String(row.status);
  if (FAILED.has(status)) {
    const why = (row.error ?? '').trim();
    const head = status === 'runtime_capability_check_failed'
      ? `daemon 说它不支持 ${row.runtime ?? '这个'} runtime`
      : status === 'rejected' ? 'daemon 拒绝了这次创建' : 'daemon 启动子节点失败';
    return { kind: 'failed', text: why ? `${head}:${why}` : head };
  }
  if (status === 'started') return { kind: 'waiting', text: 'daemon 已启动子进程,等待它向 Hub 注册…' };
  if (status === 'delivered') return { kind: 'waiting', text: 'daemon 已收到创建请求,正在启动…' };
  return { kind: 'waiting', text: '创建请求已下发,等待 daemon 领取…' };
}

/** 超时(24s 没注册)时的话:知道 daemon 已启动就说清楚,不知道就保持原来的诚实提示。 */
export function timeoutMessage(last: CreateRequestVerdict): string {
  if (last.kind === 'waiting' && last.text.startsWith('daemon 已启动')) {
    return 'daemon 已启动子进程,但 24s 内还没向 Hub 注册。它可能还在拉起(TUI 共存 runtime 要等宿主登录态);稍后到 Agents 列表查看,长时间不出现就去 daemon 所在机器看该节点的日志。';
  }
  if (last.kind === 'waiting') return `${last.text} 24s 内没等到子节点注册——可能 daemon 离线或还没领取;稍后到 Agents 列表查看。`;
  return '已下发，但 24s 内未看到子节点注册。可能仍在拉起中——稍后到 Agents 列表查看。';
}
