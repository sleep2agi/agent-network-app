// 「节点来分类」视图的分组判据（纯逻辑，无 RN 依赖）。
//
// 背景（admin 2026-11-03）：侧栏只有「按部门」一种切法，而 318 个节点里 185 个没有
// 归属 —— 于是整个目录退化成一个巨大的「未归属」。同一份数据换一个切面就能看出
// 别的东西：谁在跑什么运行时、哪台机扛了多少节点、多少节点常年离线。
//
// 这里只回答「这个 session 该落在哪个组」，分组/排序/折叠仍由 agents-list 处理。

import type { Session } from './api';

export type GroupBy = 'dept' | 'runtime' | 'host' | 'status';

/** 顺序即界面上的顺序；'dept' 是默认（= 现有行为）。 */
export const GROUP_BY_OPTIONS: GroupBy[] = ['dept', 'runtime', 'host', 'status'];

export const GROUP_BY_LABEL: Record<GroupBy, string> = {
  dept: '部门',
  runtime: '运行时',
  host: '主机',
  status: '状态',
};

/** 存储里读回来的字符串 → 合法切法；认不出就退回 'dept'（默认行为，不改变现网观感）。 */
export function parseGroupBy(raw: unknown): GroupBy {
  const s = String(raw ?? '').trim();
  return (GROUP_BY_OPTIONS as string[]).includes(s) ? (s as GroupBy) : 'dept';
}

type Row = Pick<Session, 'runtime' | 'agent' | 'server' | 'hostname' | 'status'>;

const RUNTIME_RULES: Array<[RegExp, string]> = [
  [/claude/i, 'Claude'],
  [/codex/i, 'Codex'],
  [/opencode|tmwork/i, 'OpenCode'],
  [/grok/i, 'Grok'],
  [/gemini/i, 'Gemini'],
  [/qwen/i, 'Qwen'],
];

/**
 * 运行时名：优先取节点自报的 runtime，取不到再退回 agent 标识。
 * 两者都没有 ⇒ 「未上报」而不是「其它」：这两件事在排障时含义不同。
 */
export function runtimeGroup(row: Row): string {
  const raw = (row.runtime || row.agent || '').trim();
  if (!raw) return '未上报';
  for (const [re, label] of RUNTIME_RULES) if (re.test(raw)) return label;
  return raw;
}

/** 主机：server（部署名）优先，其次 hostname；都没有才是「未知主机」。 */
export function hostGroup(row: Row): string {
  const raw = (row.server || row.hostname || '').trim();
  return raw || '未知主机';
}

/** 状态：四档，与列表状态点同义。running 归到「运行中」（老 hub 用 running）。 */
export function statusGroup(row: Row): string {
  const s = (row.status || '').trim();
  if (s === 'working' || s === 'running') return '运行中';
  if (s === 'idle') return '空闲';
  if (s === 'offline') return '离线';
  if (s === 'error') return '异常';
  return '未知';
}

/**
 * 给定切法返回该行的组名。
 * 'dept' 用调用方给的部门映射（Hub 的真实归属）；拿不到归属时统一落「未归属」，
 * **不**退回别名前缀 —— 那会让「没归属」看起来像「有归属」，正是这次要修的问题。
 */
export function groupKeyOf(
  row: Row,
  by: GroupBy,
  deptOf?: (alias: string) => string | undefined,
  alias?: string,
  knownOf?: (alias: string) => boolean,
): string {
  if (by === 'runtime') return runtimeGroup(row);
  if (by === 'host') return hostGroup(row);
  if (by === 'status') return statusGroup(row);
  if (!alias) return '未归属';
  const dept = deptOf?.(alias);
  if (dept) return dept;
  // 「未登记」与「未归属」必须分开：前者是会话在组织架构里根本不存在（没有节点登记），
  // 后者是登记了但没分部门。混成一个桶会让「未归属为什么这么多」永远说不清。
  if (knownOf && !knownOf(alias)) return '未登记';
  return '未归属';
}

/** 切换切法时给调用方用：同一份 sessions 预先算好 alias → 组名，避免每行重算。 */
export function groupMapOf(
  sessions: Array<Session & { alias: string }>,
  by: GroupBy,
  deptOf?: (alias: string) => string | undefined,
  knownOf?: (alias: string) => boolean,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of sessions) map.set(s.alias, groupKeyOf(s, by, deptOf, s.alias, knownOf));
  return map;
}
