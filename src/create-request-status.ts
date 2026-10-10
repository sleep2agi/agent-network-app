// 桌面向导:create_node 下发后,除了等「子节点注册」,还读 hub 的 GET /api/node-create-requests?request_id=
// 老 Hub 404/缺少身份或启动证据 → 尚未确认,不能用同名节点冒充本次创建成功。
// 纯函数:把 daemon 回的 status/error 变成向导该显示的话。
import { describeWorkdirError } from './create-node-workdir';
import { describeCopresenceError } from './create-node-request';
import { describeNodeNameRejection } from './node-name';
import { describeOpenCodeCreateError } from './opencode-create-options';
import { describeProviderCreateError } from './provider-create-options';

export type CreateRequestStatus = 'pending' | 'delivered' | 'started' | 'failed' | 'rejected' | 'runtime_capability_check_failed' | string;

export interface CreateRequestRow {
  request_id?: string;
  status?: CreateRequestStatus;
  error?: string | null;
  runtime?: string | null;
  child_name?: string | null;
  child_node_id?: string | null;
  launch_verified_at?: number | null;
}

export type CreateRequestVerdict =
  | { kind: 'unknown' }                       // 老 hub / 还没读到
  | { kind: 'waiting'; text: string }         // pending / delivered / started:继续等注册
  | { kind: 'failed'; text: string };         // daemon 明确说失败:停止等待,显示原因

const FAILED = new Set(['failed', 'rejected', 'runtime_capability_check_failed']);

/** `name` = 向导里提交的名字(行里没有 child_name 时用它判断是不是老 daemon 拒了新规则的名字)。 */
export function createRequestVerdict(row: CreateRequestRow | null | undefined, name?: string): CreateRequestVerdict {
  if (!row || !row.status) return { kind: 'unknown' };
  const status = String(row.status);
  if (FAILED.has(status)) {
    const why = (row.error ?? '').trim();
    const opencode = describeOpenCodeCreateError({ error: why });
    if (opencode) return { kind: 'failed', text: `${opencode}（${why}）` };
    // provider 字段被旧 Hub 拒绝:说人话,并且不要让调用方改走「不带密钥」的创建。
    const provider = describeProviderCreateError({ error: why });
    if (provider) return { kind: 'failed', text: `${provider}（${why}）` };
    // Codex 共存:老 Hub/daemon 不认 flags.copresence、或目标机缺 tmux/codex/codex 登录 → 说人话,原文附在后面。
    const co = describeCopresenceError({ error: why, status, runtime: row.runtime });
    if (co) return { kind: 'failed', text: co };
    // #652 —— 老 daemon 只认小写英文名:Hub 放行了「测试」,daemon 回 node_name_invalid。
    const nm = describeNodeNameRejection(why, row.child_name || name || '', 'daemon');
    if (nm) return { kind: 'failed', text: `${nm}(${why})` };
    const head = status === 'runtime_capability_check_failed'
      ? `daemon 说它不支持 ${row.runtime ?? '这个'} runtime`
      : status === 'rejected' ? 'daemon 拒绝了这次创建' : 'daemon 启动子节点失败';
    // 工作目录被 daemon 拒(是家目录 / 系统目录 / 已有别的节点…):给一句人话,原始码留在括号里便于排查。
    const wd = describeWorkdirError(why);
    if (wd) return { kind: 'failed', text: `${head}:${wd}(${why})` };
    return { kind: 'failed', text: why ? `${head}:${why}` : head };
  }
  if (status === 'started') return { kind: 'waiting', text: 'daemon 已启动子进程,等待它向 Hub 注册…' };
  if (status === 'delivered') return { kind: 'waiting', text: 'daemon 已收到创建请求,正在启动…' };
  if (status === 'succeeded') return { kind: 'waiting', text: '节点已注册,正在核对本次启动确认与在线状态…' };
  return { kind: 'waiting', text: '创建请求已下发,等待 daemon 领取…' };
}

/** Success requires evidence for this request, not an alias collision. */
export function creationConfirmed(
  row: CreateRequestRow | null | undefined,
  expected: { requestId: string; name: string; runtime: string; requireLaunchVerification?: boolean },
  sessions: ReadonlyArray<{ alias: string; node_id?: string | null; status: string }>,
): boolean {
  if (!row || row.request_id !== expected.requestId || row.child_name !== expected.name
    || row.runtime !== expected.runtime || row.status !== 'succeeded' || !row.child_node_id) return false;
  if (expected.requireLaunchVerification
    && !(typeof row.launch_verified_at === 'number' && Number.isFinite(row.launch_verified_at) && row.launch_verified_at > 0)) return false;
  return sessions.some(s => s.node_id === row.child_node_id && s.alias === expected.name
    && (s.status === 'idle' || s.status === 'working' || s.status === 'busy'));
}

/** 45 秒观察窗结束不代表创建失败,也不代表已上线。 */
export function timeoutMessage(last: CreateRequestVerdict): string {
  if (last.kind === 'waiting' && last.text.startsWith('节点已注册')) {
    return '节点已注册,但 45s 内未确认本次启动检查与在线状态。旧 Hub/daemon 可能不提供确认信息;稍后查看 Agents 与节点日志,不要重复创建。';
  }
  if (last.kind === 'waiting' && last.text.startsWith('daemon 已启动')) {
    return 'daemon 已启动子进程,但 45s 内还没确认向 Hub 注册。它可能还在拉起(TUI 共存 runtime 要等宿主登录态);稍后到 Agents 列表查看,长时间不出现就去 daemon 所在机器看该节点的日志。';
  }
  if (last.kind === 'waiting') return `${last.text} 45s 内未确认本次创建——可能 daemon 离线或还没领取;稍后到 Agents 列表查看。`;
  return '已下发，但 45s 内未确认本次创建。可能仍在拉起或 Hub 未提供确认信息——稍后到 Agents 列表查看,不要重复创建。';
}
