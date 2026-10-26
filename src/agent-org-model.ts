// Agent 组织架构页的纯数据:部门树来自 Hub departments,Agent 挂在负责人(人)所在的部门上。
// Hub 支持显式给 Agent 设部门(department_id)时优先于负责人部门;未设置才按负责人推断。
// 调整写入 Hub,内存里的 moves 只用于乐观更新与失败回滚。不 import react-native。
import type { Department, OrgData } from './org-model';
import { subtreeIds } from './org-model';

/** departmentId: Hub 显式设置的部门;undefined = 没设置,沿用负责人部门(旧形状)。
 *
 *  #2596 —— `updatedAt` / `lifecycleState` 来自 Hub `.162` 的
 *  `/api/requirements/people/directory`（`updated_at` / `lifecycle_state`）。
 *  两个都是可选的：老 Hub 没有这两格 ⇒ undefined ⇒ **行为必须与以前完全一致**
 *  （不过滤、不去重），否则一次客户端升级会把老 Hub 上的 Agent 全藏起来。
 */
export type OrgAgent = {
  nodeId: string;
  alias: string;
  departmentId?: string | null;
  updatedAt?: string | null;
  lifecycleState?: string | null;
};
export type OrgOwner = {
  userId: string;
  username: string;
  displayName: string;
  /** 通讯录里的部门;不在部门树里时界面按未归属算。 */
  departmentId: string | null;
  agents: OrgAgent[];
};
export type AgentOrgData = {
  departments: Department[];
  owners: OrgOwner[];
  unowned: OrgAgent[];
  /** GET /api/requirements/people/directory 有响应。 */
  directory: boolean;
  /** GET /api/networks/:id/departments 有响应。false 时部门是从通讯录摊平的。 */
  departmentsApi: boolean;
  /**
   * Hub 支持「显式给 Agent 设部门」(nodes.department_id)。
   *
   * #1976(admin 2026-10-21:「Agent 组织架构和人类组织架构是两个独立的」):
   * true ⇒ Agent 放哪个部门**只由显式设置**决定,没有显式归属就是「未归属」,
   * **不再**从「负责人在哪个部门」推断 —— 人类的部门树不该决定 Agent 的位置。
   * false ⇒ 老 Hub 没有显式归属这回事,保留旧的推断口径(此时树本身也是从通讯录摊平的)。
   */
  agentDepartmentSupported: boolean;
};

export type DemoMove = { nodeId: string; departmentId: string | null };

export type PlacedAgent = {
  nodeId: string;
  alias: string;
  ownerUserId: string | null;
  ownerName: string | null;
  sourceDepartmentId: string | null;
  departmentId: string | null;
  demo: boolean;
  /** Hub 的 `updated_at`（原样，ISO 串）；老 Hub 为 null。 */
  updatedAt?: string | null;
  /** Hub 的 `lifecycle_state`（`active` / `stopped` / …）；老 Hub 为 undefined。 */
  lifecycleState?: string | null;
  /**
   * #2596 —— 与这一行**同 alias**、但被合并掉的其它 nodeId（按活跃度降序）。
   *
   * 为什么不是直接丢掉：同 alias 多节点在 Hub 里是**真实数据**（重装/换机后旧 node 行还在），
   * 静默隐藏会让人以为“我的节点不见了”。保留 id 才能让界面说“另有 N 个同名节点”。
   */
  duplicateNodeIds?: string[];
};

/** #2596 —— 同 alias 去重 + 近 N 天过滤的开关。两者都只在 Hub 给出 `updatedAt` 时生效。 */
export type PlaceOptions = {
  /** 只显示最近 N 天活跃过的 Agent；0 / undefined = 不过滤。默认 7。 */
  recentDays?: number;
  /** 现在的时间（测试注入用）。 */
  now?: number;
};

const DAY_MS = 86_400_000;

/** `updated_at` 可能是 "2026-10-26 14:01:21"（SQLite）或 ISO；解析不了返回 null。 */
export function agentUpdatedMs(agent: Pick<OrgAgent, 'updatedAt'>): number | null {
  const raw = (agent.updatedAt ?? '').trim();
  if (!raw) return null;
  const sqliteish = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? raw.replace(' ', 'T') + 'Z' : raw;
  const ms = Date.parse(sqliteish);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * #2596 —— 同一 alias 的多行按“谁还活着”排序：
 *   1. 有 `updatedAt` 且更新 ⇒ 更靠前；
 *   2. 都没有 `updatedAt` ⇒ `lifecycle_state === 'active'` 优先；
 *   3. 仍相同 ⇒ nodeId 字典序（**稳定**，避免每次渲染顺序抖动）。
 */
export function compareAgentLiveness(a: OrgAgent, b: OrgAgent): number {
  const am = agentUpdatedMs(a);
  const bm = agentUpdatedMs(b);
  if (am !== null && bm !== null && am !== bm) return bm - am;
  if (am !== null && bm === null) return -1;
  if (am === null && bm !== null) return 1;
  const aActive = (a.lifecycleState ?? '') === 'active' ? 1 : 0;
  const bActive = (b.lifecycleState ?? '') === 'active' ? 1 : 0;
  if (aActive !== bActive) return bActive - aActive;
  return a.nodeId.localeCompare(b.nodeId);
}

export function ownerLabel(owner: Pick<OrgOwner, 'displayName' | 'username'>): string {
  const display = owner.displayName.trim();
  return display || owner.username;
}

const known = (data: AgentOrgData, id: string | null): id is string => !!id && data.departments.some(d => d.id === id);

function sourceDepartment(data: AgentOrgData, departmentId: string | null): string | null {
  return known(data, departmentId) ? departmentId : null;
}

/** 负责人名下的 Agent 优先于「没有负责人」名单;同一节点只留第一次。
 *  部门优先级:Hub 显式 department_id > 负责人部门 > 未归属;moves 是内存里的乐观覆盖。
 *
 *  #2596 —— 同一个 alias 可能对应多个 nodeId（重装/换机后旧 node 行还在 Hub 里）。
 *  以前这些行会**全部**显示成同名 Agent，看起来像“重复数据”。现在：
 *    · 同一 alias 只留**最活跃**的那一行（`compareAgentLiveness`）；
 *    · 被合并的 nodeId 不丢，挂在 `duplicateNodeIds` 上；
 *    · 只有 Hub 给出 `updatedAt` 时才启用「近 N 天过滤」——老 Hub 一律照旧全显示。
 */
export function placeAgents(data: AgentOrgData, moves: readonly DemoMove[], options: PlaceOptions = {}): PlacedAgent[] {
  const byNode = new Map<string, PlacedAgent>();
  const add = (agent: OrgAgent, owner: OrgOwner | null) => {
    const nodeId = agent.nodeId.trim();
    if (!nodeId || byNode.has(nodeId)) return;
    const explicit = agent.departmentId !== undefined ? sourceDepartment(data, agent.departmentId) : null;
    // #1976 —— 两种口径:
    //   * Hub 支持显式归属:只认显式的;没有显式归属 ⇒ 未归属。**不从负责人部门推断。**
    //   * 老 Hub(不支持):没有显式归属这回事 ⇒ 退回「按负责人部门推断」的老口径。
    const source = agent.departmentId !== undefined
      ? explicit
      : (data.agentDepartmentSupported
        ? null
        : (owner ? sourceDepartment(data, owner.departmentId) : null));
    byNode.set(nodeId, {
      nodeId,
      alias: agent.alias.trim() || nodeId,
      ownerUserId: owner?.userId ?? null,
      ownerName: owner ? ownerLabel(owner) : null,
      sourceDepartmentId: source,
      departmentId: source,
      demo: false,
      updatedAt: agent.updatedAt ?? null,
      lifecycleState: agent.lifecycleState ?? null,
    });
  };
  for (const owner of data.owners) for (const agent of owner.agents) add(agent, owner);
  for (const agent of data.unowned) add(agent, null);
  for (const move of moves) {
    const row = byNode.get(move.nodeId);
    if (!row) continue;
    const next = sourceDepartment(data, move.departmentId);
    row.departmentId = next;
    row.demo = next !== row.sourceDepartmentId;
  }

  // #2596 ① — 同 alias 折叠。只在**至少一条有 updatedAt** 时才折叠：
  // 否则老 Hub 上“同名不同 node”是唯一信息，折掉就看不见了。
  const rows = [...byNode.values()];
  const byAlias = new Map<string, PlacedAgent[]>();
  for (const row of rows) {
    const key = row.alias.toLocaleLowerCase();
    const list = byAlias.get(key);
    if (list) list.push(row); else byAlias.set(key, [row]);
  }
  const kept: PlacedAgent[] = [];
  for (const list of byAlias.values()) {
    if (list.length === 1) { kept.push(list[0]); continue; }
    if (!list.some(row => agentUpdatedMs(row) !== null)) { kept.push(...list); continue; }
    const sorted = [...list].sort(compareAgentLiveness);
    const winner = sorted[0];
    kept.push({ ...winner, duplicateNodeIds: sorted.slice(1).map(row => row.nodeId) });
  }

  // #2596 ② — 近 N 天过滤。没有 updatedAt 的行**一律保留**（向后兼容）：
  // “不知道多久没动”不能等同于“很久没动”。
  const recentDays = options.recentDays ?? 7;
  const now = options.now ?? Date.now();
  const cutoff = recentDays > 0 ? now - recentDays * DAY_MS : null;
  const visible = cutoff === null ? kept : kept.filter(row => {
    const ms = agentUpdatedMs(row);
    return ms === null || ms >= cutoff;
  });

  return visible.sort((a, b) => a.alias.localeCompare(b.alias, 'zh') || a.nodeId.localeCompare(b.nodeId));
}

export function agentsDirectlyIn(placed: readonly PlacedAgent[], dept: string | null): PlacedAgent[] {
  return placed.filter(a => a.departmentId === dept);
}

/** 树上的数字:该部门含下级。未归属(null)只算直接挂在外面的。 */
export function agentCount(placed: readonly PlacedAgent[], data: AgentOrgData, dept: string | null): number {
  if (dept === null) return placed.filter(a => a.departmentId === null).length;
  const ids = subtreeIds(orgTree(data), dept);
  return placed.filter(a => a.departmentId !== null && ids.has(a.departmentId)).length;
}

export function orgTree(data: Pick<AgentOrgData, 'departments'>): OrgData {
  return { departments: data.departments, members: [] };
}
