// 节点「权限」分区的纯模型(board #489,Hub RFC-041 第一阶段)。不 import react-native。
//
// 三种模式:正常 / 只读 / 受限。说明用人认得的话写(做得了什么、做不了什么),不用 RFC 的术语。
// 谁能改:完全听 Hub 的 —— GET /api/nodes 每行的 viewer_can.permission_mode(Hub ≥ .93,#2275)。
// 旧 Hub 没有这个字段 ⇒ 不显示这个分区(功能检测,不按版本号猜)。
import type { HubNode } from './api';

export type NodePermissionMode = 'normal' | 'readonly' | 'restricted';

export interface NodePermissionOption {
  readonly mode: NodePermissionMode;
  readonly label: string;
  /** 一句话:它能做什么、不能做什么。 */
  readonly summary: string;
}

export const NODE_PERMISSION_OPTIONS: readonly NodePermissionOption[] = [
  { mode: 'normal', label: '正常', summary: '和你一样：你能看、能改的任务它也能，可以给别的 Agent 派活。' },
  { mode: 'readonly', label: '只读', summary: '只看不动：能看任务、回复派给它的活；不能改任务，也不能给别的 Agent 派活。' },
  { mode: 'restricted', label: '受限', summary: '只管派给它的任务：别的任务看不到也改不了；只能找你被授权的 Agent，不能群发。' },
];

export function normalizeMode(raw: unknown): NodePermissionMode {
  return raw === 'readonly' || raw === 'restricted' ? raw : 'normal';
}

export function optionFor(mode: NodePermissionMode): NodePermissionOption {
  return NODE_PERMISSION_OPTIONS.find(o => o.mode === mode) ?? NODE_PERMISSION_OPTIONS[0];
}

/** 显示「权限」分区吗:只在 Hub 说这个人能改这个节点的模式时显示。旧 Hub(没有 viewer_can)/ 节点没加载 → 不显示。 */
export function canShowPermissionSection(node: Pick<HubNode, 'viewer_can'> | null | undefined): boolean {
  return node?.viewer_can?.permission_mode === true;
}

// ── 报表:GET /api/networks/:id/node-permission-report ──

export interface NodePermissionReportRoute { route: string; reason: string; hits: number; sample?: string | null; last_hour?: string }
export interface NodePermissionReportNode { node_id: string; alias?: string | null; permission_mode?: string; total: number; by_reason: Record<string, number>; routes: NodePermissionReportRoute[] }
export interface NodePermissionReport { ok: true; network_id: string; since: string; mode: string; total: number; nodes: NodePermissionReportNode[] }

/** 原因码 → 人话。不认识的原样显示(Hub 以后加原因不至于变空行)。 */
export const REASON_LABELS: Readonly<Record<string, string>> = {
  beyond_owner_visibility: '碰了你看不到或改不了的任务',
  agent_not_granted_to_owner: '找了没授权给你的 Agent',
  mode_readonly: '只读时想改东西或派活',
  mode_restricted_not_assigned: '受限时碰了不是派给它的任务',
  human_only: '做了只有人才能做的事（改别的节点、项目、密钥等）',
  owner_unknown: '不知道这个节点归谁',
};
export const reasonLabel = (reason: string): string => REASON_LABELS[reason] ?? reason;

/** 路由 → 人话(粗粒度,够认出是哪一类操作)。认不出的原样显示。 */
export function routeLabel(route: string): string {
  const mcp = /^mcp:(.+)$/.exec(route);
  if (mcp) {
    const tool = mcp[1];
    if (tool === 'send_task' || tool === 'send_message') return '派活 / 发消息';
    if (tool === 'broadcast') return '群发';
    if (tool === 'retry_task' || tool === 'reassign_task' || tool === 'cancel_task') return '重派 / 撤回任务';
    if (tool.startsWith('requirements_') || tool.startsWith('projects_')) return '任务看板';
    return tool;
  }
  if (route.startsWith('SSE ')) return '订阅消息推送';
  if (/\/api\/requirements/.test(route)) return route.startsWith('GET ') ? '读任务' : '改任务';
  if (/\/api\/nodes\//.test(route)) return '改节点设置';
  if (route === 'POST /api/task') return '派活 / 发消息';
  if (route === 'POST /api/broadcast') return '群发';
  return route;
}

export interface ReportSummary {
  /** 过去这段时间本来会拦下几次。 */
  total: number;
  /** Hub 当前是只记录(log)还是已在拦(enforce)/ 关闭(off)。 */
  hubMode: string;
  byReason: Array<{ reason: string; label: string; hits: number }>;
  byRoute: Array<{ route: string; label: string; reason: string; hits: number }>;
}

/** 这个节点在报表里的那一份;报表里没有它 = 0 次。按次数从多到少。 */
export function summarizeReport(report: NodePermissionReport | null | undefined, nodeId: string): ReportSummary | null {
  if (!report) return null;
  const entry = report.nodes?.find(n => n.node_id === nodeId);
  const byReason = Object.entries(entry?.by_reason ?? {})
    .map(([reason, hits]) => ({ reason, label: reasonLabel(reason), hits: Number(hits) || 0 }))
    .filter(r => r.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.reason.localeCompare(b.reason));
  const byRoute = (entry?.routes ?? [])
    .map(r => ({ route: r.route, label: routeLabel(r.route), reason: r.reason, hits: Number(r.hits) || 0 }))
    .filter(r => r.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.route.localeCompare(b.route));
  return { total: Number(entry?.total ?? 0) || 0, hubMode: report.mode, byReason, byRoute };
}

/** 报表那一行的文字。 */
export function reportHeadline(summary: ReportSummary): string {
  if (summary.total === 0) return '过去 7 天没有本来会被拦下的操作';
  return summary.hubMode === 'enforce' ? `过去 7 天拦下了 ${summary.total} 次` : `过去 7 天本来会拦下 ${summary.total} 次`;
}

/** 报表行下面的一句注脚:说清楚现在是「只记录没拦」还是真在拦。 */
export function reportFootnote(summary: ReportSummary): string {
  if (summary.hubMode === 'enforce') return 'Hub 已开启拦截：这些操作都被拒绝了。';
  if (summary.hubMode === 'off') return 'Hub 关闭了这项检查，正常模式下的操作不再记录。';
  return '目前只记录、不拦截：这些操作当时都照常完成了。只读 / 受限模式一设就生效，不受这里影响。';
}

/** 选中一个模式后要提交吗(和当前一样 / 正在提交 → 不提交)。 */
export function shouldSubmit(current: NodePermissionMode, picked: NodePermissionMode, busy: boolean): boolean {
  return !busy && picked !== current;
}

/** PUT 失败时给人看的话。 */
export function saveErrorText(error: { status?: number; error?: string } | null | undefined): string {
  if (!error) return '';
  if (error.status === 403) return '你没有权限修改这个节点的模式';
  if (error.status === 404) return '找不到这个节点(可能已被删除)';
  return `保存失败：${error.error || '网络错误'}`;
}

/** 桌面一行三段;手机三张竖排的选项卡(手指大小)。与节点页同一个断点。 */
export function permissionLayout(compact: boolean): 'segmented' | 'cards' {
  return compact ? 'cards' : 'segmented';
}
