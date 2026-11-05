// 会话列表的分组判据。注册关系和部门归属必须有 Hub 数据支持，不能按别名前缀猜。
import type { Session } from './api';
import type { AgentDirectoryRow } from './agent-directory';
import type { AgentOrgData, OrgAgent } from './agent-org-model';
import { deptPathLabel } from './org-model';

export type GroupBy = 'dept' | 'runtime' | 'host' | 'status';

export const GROUP_BY_OPTIONS: GroupBy[] = ['dept', 'runtime', 'host', 'status'];
export const GROUP_BY_LABEL: Record<GroupBy, string> = {
  dept: '部门', runtime: '运行时', host: '主机', status: '状态',
};

export function parseGroupBy(raw: unknown): GroupBy {
  const s = String(raw ?? '').trim();
  return (GROUP_BY_OPTIONS as string[]).includes(s) ? (s as GroupBy) : 'dept';
}

type Row = Pick<Session, 'runtime' | 'agent' | 'server' | 'hostname' | 'status'>;
const RUNTIME_RULES: Array<[RegExp, string]> = [
  [/claude/i, 'Claude'], [/codex/i, 'Codex'], [/opencode|tmwork/i, 'OpenCode'],
  [/grok/i, 'Grok'], [/gemini/i, 'Gemini'], [/qwen/i, 'Qwen'],
];

export function runtimeGroup(row: Row): string {
  const raw = (row.runtime || row.agent || '').trim();
  if (!raw) return '未上报';
  for (const [re, label] of RUNTIME_RULES) if (re.test(raw)) return label;
  return raw;
}

export function hostGroup(row: Row): string {
  return (row.server || row.hostname || '').trim() || '未知主机';
}

export function statusGroup(row: Row): string {
  const s = (row.status || '').trim();
  if (s === 'working' || s === 'running') return '运行中';
  if (s === 'idle') return '空闲';
  if (s === 'offline') return '离线';
  if (s === 'error') return '异常';
  return '未知';
}

const valid = (v: unknown): v is string => typeof v === 'string' && !!v && v.trim() === v;
const nodeKey = (network: string, node: string) => JSON.stringify([network, node]);
const sessionKey = (s: Session): string | null =>
  valid(s.network_id) && valid(s.alias) ? JSON.stringify([s.network_id, s.alias]) : null;

type Registration =
  | { kind: 'matched'; nodeKey: string }
  | { kind: 'unmatched'; nodeKey: string }
  | { kind: 'unknown' };
const UNKNOWN: Registration = { kind: 'unknown' };

/**
 * 列表用 light 状态，它可能不带 node_id。只有完整目录里同网络、同 alias 的会话唯一时，
 * 才把它关联到完整会话；节点是否匹配仍以 (network_id,node_id) 为准。
 * 失败、过期、缺身份或重复会话都不是「未登记」的证据。
 */
export function registrationIndex(directory: {
  rows: readonly AgentDirectoryRow[];
  loaded: boolean;
  stale: boolean;
  nodesRead: string | null;
  sessionsRead: string | null;
}): Map<string, Registration> {
  const result = new Map<string, Registration>();
  if (!directory.loaded || directory.stale || directory.nodesRead !== 'ok' || directory.sessionsRead !== 'ok') return result;
  const nodes = directory.rows.filter(row => row.kind === 'registered');
  const nodeKeys = new Set<string>();
  const incompleteNetworks = new Set<string>();
  let unscopedNode = false;
  for (const row of nodes) {
    if (!valid(row.node.network_id)) unscopedNode = true;
    else if (!valid(row.node.node_id)) incompleteNetworks.add(row.node.network_id);
    else nodeKeys.add(nodeKey(row.node.network_id, row.node.node_id));
  }
  for (const row of directory.rows) {
    const s = row.kind === 'session_only' ? row.session : row.association === 'matched' ? row.session : null;
    if (!s) continue;
    const key = sessionKey(s);
    if (!key) continue;
    let registration: Registration = UNKNOWN;
    if (valid(s.network_id) && valid(s.node_id)) {
      const nk = nodeKey(s.network_id, s.node_id);
      if (row.kind === 'registered' && row.association === 'matched') registration = { kind: 'matched', nodeKey: nk };
      else if (!nodeKeys.has(nk) && !unscopedNode && !incompleteNetworks.has(s.network_id)) registration = { kind: 'unmatched', nodeKey: nk };
    }
    // 同一网络内同名会话不唯一，light 行无法确定是哪一条。
    result.set(key, result.has(key) ? UNKNOWN : registration);
  }
  return result;
}

/** 只用目录里的节点显式部门；旧 Hub、畸形字段或部门树不全时不猜。 */
export function departmentIndex(network: string | undefined, data: AgentOrgData | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!valid(network) || !data?.directory || !data.departmentsApi || !data.agentDepartmentSupported) return out;
  // 不同上级下允许同名部门；只用叶子名会把两组错误合并。
  const tree = { departments: data.departments, members: [] };
  const names = new Map(data.departments.map(d => [d.id, deptPathLabel(tree, d.id)]));
  const add = (agent: OrgAgent) => {
    if (!valid(agent.nodeId)) return;
    // Hub 声明 agent_department_supported 时，省略 department_id 就是没有显式归属。
    const label = (agent.departmentMalformed ? '归属待确认'
      : agent.departmentId == null ? '未归属'
      : valid(agent.departmentId) ? names.get(agent.departmentId) : undefined) || '归属待确认';
    const key = nodeKey(network, agent.nodeId);
    const previous = out.get(key);
    out.set(key, previous && previous !== label ? '归属待确认' : label);
  };
  for (const owner of data.owners) for (const agent of owner.agents) add(agent);
  for (const agent of data.unowned) add(agent);
  return out;
}

/** 用 Session 对象而非 alias 作 key：不同网络可以有同名节点。 */
export function groupMapOf(
  sessions: readonly Session[],
  by: GroupBy,
  registrations: ReadonlyMap<string, Registration> = new Map(),
  departments: ReadonlyMap<string, string> = new Map(),
): Map<Session, string> {
  const counts = new Map<string, number>();
  for (const s of sessions) {
    const key = sessionKey(s);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const out = new Map<Session, string>();
  for (const s of sessions) {
    let label: string;
    if (by === 'runtime') label = runtimeGroup(s);
    else if (by === 'host') label = hostGroup(s);
    else if (by === 'status') label = statusGroup(s);
    else {
      const key = sessionKey(s);
      const registration = key && counts.get(key) === 1 ? registrations.get(key) : undefined;
      // 如果 light 行有 node_id，也要与完整快照一致。
      const sameNode = registration && registration.kind !== 'unknown' &&
        (!valid(s.node_id) || (valid(s.network_id) && nodeKey(s.network_id, s.node_id) === registration.nodeKey));
      if (!registration || registration.kind === 'unknown' || !sameNode) label = '关联待确认';
      else if (registration.kind === 'unmatched') label = '未匹配节点';
      else label = departments.get(registration.nodeKey) ?? '归属待确认';
    }
    out.set(s, label);
  }
  return out;
}
