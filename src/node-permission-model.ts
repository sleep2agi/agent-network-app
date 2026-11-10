// 节点「权限」分区的纯模型(board #489,Hub RFC-041 第一阶段)。不 import react-native。
//
// 三种模式:正常 / 只读 / 受限。说明用人认得的话写(做得了什么、做不了什么),不用 RFC 的术语。
// 谁能改:完全听 Hub 的 —— GET /api/nodes 每行的 viewer_can.permission_mode(Hub ≥ .93,#2275)。
// 旧 Hub 没有这个字段 ⇒ 不显示这个分区(功能检测,不按版本号猜)。
import type { HubNode } from './api';
import { t } from './i18n';
import './i18n-node-permissions';

export type NodePermissionMode = 'normal' | 'readonly' | 'restricted';

export interface NodePermissionOption {
  readonly mode: NodePermissionMode;
  readonly label: string;
  /** 一句话:它能做什么、不能做什么。 */
  readonly summary: string;
}

export const NODE_PERMISSION_MODES: readonly NodePermissionMode[] = ['normal', 'readonly', 'restricted'];

/** 每次调用按当前语言取文案(切语言不必重启)。 */
export function nodePermissionOptions(): NodePermissionOption[] {
  return NODE_PERMISSION_MODES.map(mode => ({ mode, label: t(`nodePerm.mode.${mode}`), summary: t(`nodePerm.mode.${mode}.summary`) }));
}

export function normalizeMode(raw: unknown): NodePermissionMode {
  return raw === 'readonly' || raw === 'restricted' ? raw : 'normal';
}

export function optionFor(mode: NodePermissionMode): NodePermissionOption {
  const options = nodePermissionOptions();
  return options.find(o => o.mode === mode) ?? options[0];
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
export function reasonLabel(reason: string): string {
  const key = `nodePerm.reportReason.${reason}`;
  const text = t(key);
  return text === key ? reason : text;
}

/** 路由 → 人话(粗粒度,够认出是哪一类操作)。认不出的原样显示。 */
export function routeLabel(route: string): string {
  const mcp = /^mcp:(.+)$/.exec(route);
  if (mcp) {
    const tool = mcp[1];
    if (tool === 'send_task' || tool === 'send_message') return t('nodePerm.route.send');
    if (tool === 'broadcast') return t('nodePerm.route.broadcast');
    if (tool === 'retry_task' || tool === 'reassign_task' || tool === 'cancel_task') return t('nodePerm.route.retarget');
    if (tool.startsWith('requirements_') || tool.startsWith('projects_')) return t('nodePerm.route.board');
    return tool;
  }
  if (route.startsWith('SSE ')) return t('nodePerm.route.sse');
  if (/\/api\/requirements/.test(route)) return route.startsWith('GET ') ? t('nodePerm.route.readTasks') : t('nodePerm.route.writeTasks');
  if (/\/api\/nodes\//.test(route)) return t('nodePerm.route.nodeSettings');
  if (route === 'POST /api/task') return t('nodePerm.route.send');
  if (route === 'POST /api/broadcast') return t('nodePerm.route.broadcast');
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
  if (summary.total === 0) return t('nodePerm.report.none');
  return t(summary.hubMode === 'enforce' ? 'nodePerm.report.blocked' : 'nodePerm.report.wouldBlock', { count: summary.total });
}

/** 报表行下面的一句注脚:说清楚现在是「只记录没拦」还是真在拦。 */
export function reportFootnote(summary: ReportSummary): string {
  if (summary.hubMode === 'enforce') return t('nodePerm.report.footEnforce');
  if (summary.hubMode === 'off') return t('nodePerm.report.footOff');
  return t('nodePerm.report.footLog');
}

/** 选中一个模式后要提交吗(和当前一样 / 正在提交 → 不提交)。 */
export function shouldSubmit(current: NodePermissionMode, picked: NodePermissionMode, busy: boolean): boolean {
  return !busy && picked !== current;
}

/** PUT 失败时给人看的话。 */
export function saveErrorText(error: { status?: number; error?: string } | null | undefined): string {
  if (!error) return '';
  if (error.status === 403) return t('nodePerm.error.modeForbidden');
  if (error.status === 404) return t('nodePerm.error.notFound');
  return t('nodePerm.error.saveFailed', { error: error.error || t('nodePerm.error.network') });
}

/** 「收」分区只在 Hub 报了收件白名单能力位时出现(旧 Hub 没有这个接口)。 */
export function supportsInboxAllowlist(capabilities: readonly string[] | null | undefined, capability: string): boolean {
  return !!capabilities && capabilities.includes(capability);
}

/** 桌面一行三段;手机三张竖排的选项卡(手指大小)。与节点页同一个断点。 */
export function permissionLayout(compact: boolean): 'segmented' | 'cards' {
  return compact ? 'cards' : 'segmented';
}
