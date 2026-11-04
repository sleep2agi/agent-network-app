// 2026-11-05: 从 Dashboard(`agent-network-dashboard/app/lib/`)原样搬入,为了把「军团 3D」视图接到客户端。
// 这四个模块是纯几何/投影函数(无 fetch、无 React),测试也一并搬入(src/legion/*.test.ts)。
// 搬迁原则:几何行为一字不改;要改先改测试并说明理由。
/**
 * 军团（组织架构图）布局 —— #1636 / owner 2026-10-25 指令。
 *
 * 客户端目前只有「部门/成员管理」，没有可对齐的组织图，所以这张图是
 * Dashboard 单独做的：把 Hub 通讯录投影（人 → 部门 → 名下 Agent）画成
 * 三层同心环。布局必须是**纯函数**，理由和 requirements-paging 一样：
 * 角度分配、分组顺序、Agent 扇形这些只要错一点，画出来就是一堆重叠的圆，
 * 而「截图里看着还行」不能当断言。所以坐标在这里算，行为在
 * legion-layout.test.mjs 里钉住，组件只负责把它们画出来。
 *
 * v3（2026-10-25 晚）支持**任意深度的真实部门树**。客户端用的是
 * `GET /api/networks/{id}/departments`（`src/org-api.ts`），带 parent_id /
 * leader_user_id / 成员表；只按 `person.department.name` 分组画出来的是
 * 「人按部门名分堆」，不是编制。现在两种输入共用一套递归分配：
 *   - 传了 `departments` → 按树递归，半径随深度从 0.30 递增到 0.50；
 *   - 没传（老 Hub 404）→ 合成一层扁平部门，几何与 v2 一致（回退不是降级）。
 *
 * 坐标约定：以 (0,0) 为圆心、半径 1 为最外环的归一化平面；
 * angle 从 12 点方向起顺时针（0 = 正上方）。
 *   x = r * sin(angle)
 *   y = -r * cos(angle)
 */

export type LegionNodeKind = 'core' | 'group' | 'person' | 'agent';

export interface LegionPerson {
  user_id: string;
  username: string;
  display_name: string;
  role: string;
  department: { id: string; name: string } | null;
  agents: LegionAgentRef[];
}

export interface LegionAgentRef {
  node_id: string;
  alias: string;
  department_id?: string | null;
  updated_at?: string;
  lifecycle_state?: string | null;
}

/** Hub `/api/networks/{id}/departments` 的一行（客户端 `src/org-model.ts` 同构）。 */
export interface LegionDepartment {
  id: string;
  name: string;
  parent_id?: string | null;
  leader_user_id?: string | null;
  sort?: number;
}

/** Hub 成员表的落位（members: [{ user_id, department_id }]）。 */
export interface LegionMember {
  user_id: string;
  department_id: string | null;
}

export interface LegionInput {
  people: LegionPerson[];
  /** 不属于任何人的 Agent（Hub 的 agents_without_owner）。 */
  orphans?: LegionAgentRef[];
  /** 真实部门树；缺省或空数组时回退到扁平分组。 */
  departments?: LegionDepartment[];
  /** 成员落位表；缺省时用 `person.department.id`。 */
  members?: LegionMember[];
  /** 圆心标题，默认「军团」。 */
  title?: string;
  /**
   * 已折叠的部门节点 id（形如 `dept:<department_id>`）。折叠的部门不再
   * 递归展开下级，扇区只保留最小份额，把角度让给同级的其它部门。
   * 传的是**布局节点 id**而不是 Hub 的 department_id，避免两个命名空间混用。
   */
  collapsed?: string[];
}

export interface LegionNode {
  id: string;
  kind: LegionNodeKind;
  label: string;
  sublabel?: string;
  /** 0 圆心 / 1 部门 / 2 人 / 3 Agent */
  ring: 0 | 1 | 2 | 3;
  /** 部门在树里的层级（1 = 顶层部门）；人 / Agent / 圆心为 undefined。 */
  depth?: number;
  angle: number;
  radius: number;
  x: number;
  y: number;
  parentId: string | null;
  /** 该人 / 该部门名下 Agent 数（Agent 节点为 0）。 */
  agentCount: number;
  /** 该部门子树里的人数（含下级部门）；非部门节点为 0。 */
  memberCount: number;
  /** 部门负责人显示名；没配负责人时 undefined。 */
  leader?: string;
  /** 排序键，保证同一份输入永远得到同一张图。 */
  order: number;
  /** 仅部门节点：该部门在圆环上占的弧度与起点（顺时针，0 = 12 点）。 */
  span?: number;
  spanStart?: number;
  /** 仅部门节点：下级是否被折叠。 */
  collapsed?: boolean;
  /** 折叠时藏起来的子树人数 / Agent 数（用于画「+N」角标）。 */
  hiddenMembers?: number;
  hiddenAgents?: number;
}

export interface LegionEdge {
  id: string;
  from: string;
  to: string;
}

export interface LegionLayout {
  nodes: LegionNode[];
  edges: LegionEdge[];
  stats: { groups: number; people: number; agents: number; orphans: number; depth: number; collapsed: number };
  /** 每个环的归一化半径，供组件画参考圆。 */
  rings: { ring: 1 | 2 | 3; radius: number }[];
}

export const UNGROUPED = '未分组';
export const ORPHAN_GROUP = '无主 Agent';
/** Agent 自报了一个部门 id，但当前部门树里没有它：不能吞掉，也不能并入真实部门。 */
export const UNKNOWN_DEPT = '未知部门';

/** 环半径：部门贴近圆心，人第二层，Agent 在最外。 */
export const RING_RADIUS = { core: 0, group: 0.5, person: 0.84, agent: 1 } as const;
/**
 * 多层部门时，最内层（depth 1）到最外层（最深）的半径带。0.26→0.54：
 * 0.30→0.50 在 375px 屏上只留 29px 环差，而部门圆直径 44px，父子部门
 * 会叠在一起；拉开到 0.28 环差后窄屏才放得下（节点半径同时按屏幕缩放）。
 */
// 部门环整体外移：生产 13 个部门，内圈 0.34 会被压成「顶部一团」。
const DEPT_BAND = { inner: 0.56, outer: 0.74 } as const;

/** Agent 扇形：相邻 Agent 的角度间隔与最大半宽。 */
const AGENT_STEP = 0.075;
// 一个人名下可能有 20+ 个 Agent：原来 0.2 rad 的上限会把它们挤成一坨，
// 放到 0.42 rad（约 24°），并配合三圈半径错开。
const AGENT_MAX_HALF_WIDTH = 0.42;
const AGENT_RING_BANDS = [1, 0.9, 0.82] as const;
/** 同一 owner 的 Agent 交替落在两个半径上：纯角度摊开在窄屏仍会互相压住。 */
const AGENT_RING_ALT = 0.9;

const TAU = Math.PI * 2;

function polar(radius: number, angle: number): { x: number; y: number } {
  return { x: radius * Math.sin(angle), y: -radius * Math.cos(angle) };
}

/** 角度按 12 点起顺时针增长；排序与比较都走这里，避免 -π/π 处的跳变。 */
function normalize(angle: number): number {
  const a = angle % TAU;
  return a < 0 ? a + TAU : a;
}

interface DeptNode {
  id: string;
  label: string;
  parentId: string | null;
  depth: number;
  sort: number;
  leader?: string;
  children: DeptNode[];
  people: LegionPerson[];
  orphans: LegionAgentRef[];
  weight: number;
  memberCount: number;
  agentCount: number;
}

function personName(person: LegionPerson): string {
  return person.display_name || person.username;
}

/** 深度优先算 weight / memberCount / agentCount（子树口径）。 */
function measure(node: DeptNode): void {
  node.memberCount = node.people.length;
  node.agentCount = node.people.reduce((n, p) => n + p.agents.length, 0) + node.orphans.length;
  for (const child of node.children) {
    measure(child);
    node.memberCount += child.memberCount;
    node.agentCount += child.agentCount;
  }
  // 权重用人数，空部门也占一档，否则它会被挤成看不见的一条线。
  node.weight = Math.max(node.memberCount + node.orphans.length * 0.5, 1);
}

/**
 * 建树。扁平回退时合成一层部门节点，parentId = 'core'。
 * 输入顺序不影响输出：部门按 sort → 名称排，人按显示名排。
 */
function buildTree(input: LegionInput): { roots: DeptNode[]; depth: number } {
  const depts = input.departments ?? [];
  const peopleById = new Map(input.people.map(p => [p.user_id, p]));
  const placement = new Map<string, string | null>();
  for (const person of input.people) placement.set(person.user_id, person.department?.id ?? null);
  for (const m of input.members ?? []) {
    if (peopleById.has(m.user_id)) placement.set(m.user_id, m.department_id ?? null);
  }

  let maxDepth = 1;

  if (depts.length > 0) {
    const byId = new Map<string, DeptNode>();
    for (const d of depts) {
      byId.set(d.id, {
        id: `dept:${d.id}`,
        label: d.name,
        parentId: d.parent_id ?? null,
        depth: 1,
        sort: d.sort ?? 0,
        leader: d.leader_user_id
          ? (() => {
              const p = input.people.find(x => x.user_id === d.leader_user_id);
              return p ? personName(p) : undefined;
            })()
          : undefined,
        children: [],
        people: [],
        orphans: [],
        weight: 1,
        memberCount: 0,
        agentCount: 0,
      });
    }
    const orphans: DeptNode[] = [];
    for (const node of byId.values()) {
      const parent = node.parentId ? byId.get(node.parentId) : undefined;
      if (parent) parent.children.push(node);
      else orphans.push(node);
    }
    for (const person of input.people) {
      const deptId = placement.get(person.user_id);
      const node = deptId ? byId.get(deptId) : undefined;
      const target =
        node ??
        orphans.find(n => n.id === 'dept:none') ??
        (() => {
          const created: DeptNode = {
            id: 'dept:none', label: UNGROUPED, parentId: null, depth: 1, sort: 0,
            children: [], people: [], orphans: [], weight: 1, memberCount: 0, agentCount: 0,
          };
          orphans.push(created);
          return created;
        })();
      target.people.push(person);
    }
    // 无主 Agent（Hub agents_without_owner）同样必须落进这张树。
    // 旧实现只在这个分支放 people 就 return，2D/3D 因此漏画整类 Agent。
    // 归属优先级：Agent 自己的 department_id → 真实部门；null → 无主 Agent 组；
    // 非空但部门树没定义 → 保留一个「未知部门」组，不静默并进别的部门。
    // 合成 id 必须让开真实部门 id：Hub 数据里出现 id='orphans' 的概率不为零，
    // 撞上就会把真实部门和无主 Agent 并成一个节点。
    const taken = new Set([...byId.values()].map(n => n.id));
    const synthetic = new Map<string, DeptNode>();
    const orphanRoot = (key: string, base: string, label: string): DeptNode => {
      const existing = synthetic.get(key);
      if (existing) return existing;
      let id = base, suffix = 2;
      while (taken.has(id)) id = `${base}~${suffix++}`;
      taken.add(id);
      const created: DeptNode = {
        id, label, parentId: null, depth: 1, sort: 0,
        children: [], people: [], orphans: [], weight: 1, memberCount: 0, agentCount: 0,
      };
      orphans.push(created);
      synthetic.set(key, created);
      return created;
    };
    for (const agent of [...(input.orphans ?? [])].sort((a, b) => a.alias.localeCompare(b.alias, 'zh-Hans-CN') || a.node_id.localeCompare(b.node_id))) {
      const deptId = agent.department_id;
      const dept = deptId ? byId.get(deptId) : undefined;
      const target = dept
        ?? (deptId
          ? orphanRoot(`unknown:${deptId}`, `dept:unknown:${deptId}`, `${UNKNOWN_DEPT} · ${deptId}`)
          : orphanRoot('none', 'dept:orphans', ORPHAN_GROUP));
      target.orphans.push(agent);
    }
    // 部门存在但一个人都没有：仍然画出来（编制的空位也是信息）。
    const roots = [...orphans];
    // 部门 id 里找不到 parent 的，按顶层处理（Hub 数据脏时不能整棵树消失）。
    const assignDepth = (node: DeptNode, depth: number) => {
      node.depth = depth;
      maxDepth = Math.max(maxDepth, depth);
      node.children.sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label, 'zh-Hans-CN'));
      for (const child of node.children) assignDepth(child, depth + 1);
    };
    for (const root of roots) assignDepth(root, 1);
    for (const root of roots) measure(root);
    for (const root of roots) {
      root.people.sort((a, b) => personName(a).localeCompare(personName(b), 'zh-Hans-CN') || a.user_id.localeCompare(b.user_id));
    }
    return { roots, depth: maxDepth };
  }

  // ── 回退：只有通讯录，按 department.name 合成一层 ──
  const map = new Map<string, DeptNode>();
  for (const person of input.people) {
    const id = person.department ? `dept:${person.department.id}` : 'dept:none';
    const label = person.department?.name ?? UNGROUPED;
    const node = map.get(id) ?? {
      id, label, parentId: null, depth: 1, sort: 0,
      children: [], people: [], orphans: [], weight: 1, memberCount: 0, agentCount: 0,
    };
    node.people.push(person);
    map.set(id, node);
  }
  const orphanList = input.orphans ?? [];
  if (orphanList.length > 0) {
    map.set('dept:orphans', {
      id: 'dept:orphans', label: ORPHAN_GROUP, parentId: null, depth: 1, sort: 0,
      children: [], people: [], orphans: orphanList, weight: 1, memberCount: 0, agentCount: 0,
    });
  }
  const roots = [...map.values()];
  const rank = (n: DeptNode) => (n.id === 'dept:orphans' ? 2 : n.id === 'dept:none' ? 1 : 0);
  roots.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, 'zh-Hans-CN'));
  for (const root of roots) {
    root.people.sort((a, b) => personName(a).localeCompare(personName(b), 'zh-Hans-CN') || a.user_id.localeCompare(b.user_id));
    measure(root);
  }
  return { roots, depth: 1 };
}

/** 深度 → 半径。一层时保持 v2 的 0.5，多层时在最内 0.30 与 0.50 之间插值。 */
/** 部门节点在世界坐标里的半径：层级越深越小（内层环会挤，必须收）。 */
export function deptWorldRadius(depth: number): number {
  return depth <= 1 ? 0.05 : 0.042;
}

function deptRadius(depth: number, maxDepth: number): number {
  if (maxDepth <= 1) return RING_RADIUS.group;
  const t = (depth - 1) / (maxDepth - 1);
  return DEPT_BAND.inner + (DEPT_BAND.outer - DEPT_BAND.inner) * t;
}

interface Slot {
  weight: number;
  apply: (start: number, span: number) => void;
}

/**
 * 按权重切扇区，但每项保底一小段（0.12 rad）：否则某个 1 人的子部门
 * 在几十人的网络里会退化成 0.01 弧度，人和标签全部叠死。
 */
function distribute(slots: Slot[], start: number, span: number): void {
  if (slots.length === 0) return;
  // 部门节点直径约 0.104（世界坐标），内层环半径只有 0.26：0.22 rad 的扇区
  // 只有 0.057 弧长，6 个一级部门会互相叠住（admin 截图里名字全糊在中心）。
  // 下限按「弧长 ≥ 1.4 个节点直径」估算：0.104*1.4/0.26 ≈ 0.56，取其 0.8 倍。
  const minShare = Math.min(0.45, (span / slots.length) * 0.6);
  const reserved = minShare * slots.length;
  const flexible = Math.max(0, span - reserved);
  const roots = slots.map(s => Math.sqrt(Math.max(0, s.weight)));
  const totalWeight = roots.reduce((n, w) => n + w, 0) || 1;
  let cursor = start;
  for (let i = 0; i < slots.length; i++) {
    const width = minShare + flexible * (roots[i] / totalWeight);
    slots[i].apply(cursor, width);
    cursor += width;
  }
}

export function buildLegionLayout(input: LegionInput): LegionLayout {
  const { roots, depth } = buildTree(input);
  const nodes: LegionNode[] = [];
  const edges: LegionEdge[] = [];
  const collapsed = new Set(input.collapsed ?? []);
  const title = input.title ?? '军团';
  const ownedAgentCount = input.people.reduce((n, p) => n + p.agents.length, 0);
  const orphanCount = input.orphans?.length ?? 0;
  // 「这张图上画了多少 Agent」：无主 Agent 也要算，否则圆心/导出副标题
  // 与画布上的点数量对不上（统计 1、图上 4）。
  const agentCount = ownedAgentCount + orphanCount;
  let order = 0;

  nodes.push({
    id: 'core', kind: 'core', label: title, ring: 0, angle: 0, radius: 0,
    ...polar(0, 0), parentId: null, agentCount, memberCount: input.people.length, order: order++,
  });

  const emitDept = (node: DeptNode, start: number, span: number, parentId: string) => {
    // 部门多的时候（生产 13 个）挤在内层环上会互相压：同层交替错开一点半径，
    // 形成两条细环，圆心文字不再叠在一起。
    const radius = deptRadius(node.depth, depth) + (node.depth === 1 && order % 2 === 1 ? 0.11 : 0);
    const center = start + span / 2;
    const isCollapsed = collapsed.has(node.id) && (node.children.length > 0 || node.people.length > 0 || node.orphans.length > 0);
    nodes.push({
      id: node.id, kind: 'group', label: node.label,
      sublabel: node.memberCount > 0 ? `${node.memberCount} 人 · ${node.agentCount} Agent` : `${node.agentCount} Agent`,
      ring: 1, depth: node.depth, angle: normalize(center), radius,
      ...polar(radius, center),
      parentId, agentCount: node.agentCount, memberCount: node.memberCount, leader: node.leader,
      order: order++, span, spanStart: normalize(start),
      ...(isCollapsed ? { collapsed: true, hiddenMembers: node.memberCount, hiddenAgents: node.agentCount } : {}),
    });
    edges.push({ id: `${parentId}->${node.id}`, from: parentId, to: node.id });
    // 折叠：下钻到此为止。节点本身仍占一个最小扇区（distribute 的 0.12 下限），
    // 剩下的角度按权重分给同级——否则折叠只是「藏起来」，玻璃般的大空弧还在。
    if (isCollapsed) return;

    const slots: Slot[] = [];
    for (const child of node.children) {
      slots.push({ weight: collapsed.has(child.id) ? 1 : child.weight, apply: (s, w) => emitDept(child, s, w, node.id) });
    }
    // 部门自己的直属成员与人一起切扇区：先子部门、后直属，和客户端列表顺序一致。
    for (const person of node.people) {
      slots.push({ weight: 1, apply: (s, w) => emitPerson(person, s + w / 2, node.id) });
    }
    for (const agent of node.orphans) {
      slots.push({ weight: 0.5, apply: (s, w) => emitOrphan(agent, s + w / 2, node.id) });
    }
    distribute(slots, start, span);
  };

  const emitPerson = (person: LegionPerson, angle: number, parentId: string) => {
    const personId = `person:${person.user_id}`;
    nodes.push({
      id: personId, kind: 'person', label: personName(person),
      sublabel: `@${person.username}`, ring: 2, angle: normalize(angle), radius: RING_RADIUS.person,
      ...polar(RING_RADIUS.person, angle),
      parentId, agentCount: person.agents.length, memberCount: 0, order: order++,
    });
    edges.push({ id: `${parentId}->${personId}`, from: parentId, to: personId });

    const agents = person.agents
      .slice()
      .sort((a, b) => a.alias.localeCompare(b.alias, 'zh-Hans-CN') || a.node_id.localeCompare(b.node_id));
    const half = agents.length <= 1 ? 0 : Math.min(((agents.length - 1) / 2) * AGENT_STEP, AGENT_MAX_HALF_WIDTH);
    agents.forEach((agent, index) => {
      const offset = agents.length === 1 ? 0 : -half + (2 * half * index) / (agents.length - 1);
      const agentAngle = angle + offset;
      const agentRadius = RING_RADIUS.agent * (index % 2 === 0 ? 1 : AGENT_RING_ALT);
      const agentId = `agent:${agent.node_id}`;
      nodes.push({
        id: agentId, kind: 'agent', label: agent.alias, ring: 3,
        angle: normalize(agentAngle), radius: agentRadius,
        ...polar(agentRadius, agentAngle),
        parentId: personId, agentCount: 0, memberCount: 0, order: order++,
      });
      edges.push({ id: `${personId}->${agentId}`, from: personId, to: agentId });
    });
  };

  const emitOrphan = (agent: LegionAgentRef, angle: number, parentId: string) => {
    const agentId = `agent:${agent.node_id}`;
    nodes.push({
      id: agentId, kind: 'agent', label: agent.alias, ring: 3,
      angle: normalize(angle), radius: RING_RADIUS.agent,
      ...polar(RING_RADIUS.agent, angle),
      parentId, agentCount: 0, memberCount: 0, order: order++,
    });
    edges.push({ id: `${parentId}->${agentId}`, from: parentId, to: agentId });
  };

  distribute(
    roots.map(root => ({
      weight: collapsed.has(root.id) ? 1 : root.weight,
      apply: (s: number, w: number) => emitDept(root, s, w, 'core'),
    })),
    0,
    TAU,
  );

  // Agent 外层均匀铺满整圈：按所属成员方位排序后再均分。否则一个部门占
  // 9/16 人时，它的几百个 Agent 会全挤在同一侧（admin 截图里的「半边糊、半边空」）。
  // 半径保留 3 档交错，外层仍有一点纹理。
  const agentNodes = nodes.filter(n => n.kind === 'agent');
  if (agentNodes.length > 1) {
    const byIdMap = new Map(nodes.map(n => [n.id, n]));
    agentNodes.sort((a, b) => {
      const pa = byIdMap.get(a.parentId ?? '')?.angle ?? 0;
      const pb = byIdMap.get(b.parentId ?? '')?.angle ?? 0;
      return pa - pb || a.order - b.order;
    });
    const bands = [1, 0.93, 0.86];
    agentNodes.forEach((agent, i) => {
      const angle = ((i + 0.5) / agentNodes.length) * TAU;
      const radius = RING_RADIUS.agent * bands[i % bands.length];
      agent.angle = angle;
      agent.radius = radius;
      const pt = polar(radius, angle);
      agent.x = pt.x;
      agent.y = pt.y;
    });
  }

  return {
    nodes,
    edges,
    stats: {
      groups: roots.length + countDescendants(roots),
      people: input.people.length,
      agents: agentCount,
      orphans: orphanCount,
      depth,
      collapsed: nodes.filter(n => n.kind === 'group' && n.collapsed).length,
    },
    rings: [
      { ring: 1, radius: deptRadius(1, depth) },
      { ring: 2, radius: RING_RADIUS.person },
      { ring: 3, radius: RING_RADIUS.agent },
    ],
  };
}

function countDescendants(roots: DeptNode[]): number {
  let n = 0;
  const walk = (node: DeptNode) => {
    for (const child of node.children) {
      n += 1;
      walk(child);
    }
  };
  roots.forEach(walk);
  return n;
}

/**
 * 归一化坐标 → 像素。组件在 ResizeObserver 里拿到容器尺寸后调用；
 * radiusFactor 留出标签外沿的空白（0.84 意味着最外环贴到 84% 半径）。
 */
export function toPixel(
  node: { x: number; y: number },
  size: { width: number; height: number },
  radiusFactor = 0.92,
): { x: number; y: number } {
  const radius = (Math.min(size.width, size.height) / 2) * radiusFactor;
  return {
    x: size.width / 2 + node.x * radius,
    y: size.height / 2 + node.y * radius,
  };
}


/**
 * 找某个节点最近的**真实**部门祖先（Agent/成员 → 所属部门）。
 *
 * 为什么不直接看 parentId：`未分组` 与 `无主 Agent` 是合成分组，它们不是部门；
 * 对这两个分组下的节点，UI 不该出现「聚焦所在部门」。
 */
/** 演示巡礼的出场顺序：先按楼层（浅 → 深），同层再按方位角。
 *  原来只按布局数组顺序，镜头会在楼层之间来回跳，看不出「一层一层往下走」；
 *  按层排之后，同一层的部门连续扫过去，再落到下一层。 */
export function tourOrder<T extends { kind: string; depth?: number; angle: number }>(nodes: T[]): T[] {
  return nodes
    .filter(node => node.kind === 'group')
    .slice()
    .sort((a, b) => (a.depth ?? 1) - (b.depth ?? 1) || a.angle - b.angle);
}

export function nearestDept(nodeId: string, nodes: LegionNode[]): LegionNode | null {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const cur = byId.get(nodeId);
  if (!cur) return null;
  for (let parent = cur.parentId ? byId.get(cur.parentId) : null; parent; parent = parent.parentId ? byId.get(parent.parentId) : null) {
    if (parent.kind !== 'group') continue;
    if (parent.label === UNGROUPED || parent.label === ORPHAN_GROUP || parent.id.startsWith('dept:unknown:')) return null;
    return parent;
  }
  return null;
}
