// 任务看板(需求池)的纯逻辑:筛选、分组、排序、期限、拖动状态机、新建校验。
// 不 import react-native —— task-board-model.test.ts 直接引。界面在 RequirementBoard.tsx。
//
// Owner 2026-09-29:「这个任务列表也他妈太难看了」。重做参照 Linear / TickTick:
// 头部一行(标题 · 列表/看板 · 负责人/优先级筛选 · ＋ 新建),三列等宽铺满,卡片整张可点,
// 桌面拖动换列、手机长按菜单。Hub 数据模型不变(标题/状态/优先级/期限/负责人/参与人)。
import {
  columnsOf,
  dueOk,
  REQ_COLUMNS,
  REQ_PRIORITIES,
  type ReqColumn,
  type ReqPriority,
  type Requirement,
} from './requirements-model';
import { personKey, type RequirementPerson, type RequirementPersonRef } from './requirement-people';

// ── 筛选 ──────────────────────────────────────────────────────────────────

/** 「未分配」在负责人筛选里的键(personKey 形如 user:… / node:…,不会撞)。 */
export const UNASSIGNED = 'none';

/** 一张卡片在负责人筛选里的键。旧 Hub 没有稳定负责人(owner undefined)时按未分配算。 */
export const ownerKeyOf = (item: Pick<Requirement, 'owner'>): string => (item.owner ? personKey(item.owner) : UNASSIGNED);

/**
 * 卡片在筛选里能被哪些人认领:负责人(人类)和负责 Agent 各算一个。两个都没有 = 未分配。
 * 「我负责的」= user:<我> 命中负责人;「按 Agent」= node:<id> 命中负责 Agent(旧 Hub 上命中单一负责人)。
 */
export function roleKeysOf(item: Pick<Requirement, 'owner' | 'agentOwner'>): string[] {
  const keys: string[] = [];
  if (item.owner) keys.push(personKey(item.owner));
  if (item.agentOwner) keys.push(personKey(item.agentOwner));
  return keys.length ? keys : [UNASSIGNED];
}

/** 这张卡所在的 Hub 分不分两个角色(行里带 agent_owner 字段)。 */
export const hasRoles = (item: Pick<Requirement, 'agentOwner'>): boolean => item.agentOwner !== undefined;

export interface BoardFilter {
  /** 负责人键(personKey 或 UNASSIGNED)。空 = 不按负责人筛。 */
  owners: string[];
  /** 空 = 不按优先级筛。 */
  priorities: ReqPriority[];
}

export const EMPTY_FILTER: BoardFilter = { owners: [], priorities: [] };

export const filterActive = (f: BoardFilter): boolean => f.owners.length > 0 || f.priorities.length > 0;

export function matchesFilter(item: Requirement, f: BoardFilter): boolean {
  if (f.owners.length && !roleKeysOf(item).some(k => f.owners.includes(k))) return false;
  if (f.priorities.length && !f.priorities.includes(item.priority)) return false;
  return true;
}

export const applyFilter = (items: readonly Requirement[], f: BoardFilter): Requirement[] => items.filter(item => matchesFilter(item, f));

/** 多选筛选里点一项:有就去掉,没有就加上。 */
export function toggleIn<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter(v => v !== value) : [...list, value];
}

/** 看板三列:先筛再分组,列里的数就是筛过之后的数(与看到的卡片一致)。 */
export const boardColumns = (items: readonly Requirement[], f: BoardFilter) => columnsOf(applyFilter(items, f));

// ── 桌面左栏:全部 / 我负责的 / 按节点 ─────────────────────────────────────

export type SidebarScope = 'all' | 'mine' | 'unassigned' | `node:${string}`;

/** 左栏的一项对应的负责人筛选(与头部「负责人」筛选是同一份状态)。 */
export function ownersForScope(scope: SidebarScope, meId: string | null): string[] {
  if (scope === 'all') return [];
  if (scope === 'mine') return meId ? [personKey({ kind: 'user', id: meId })] : [];
  if (scope === 'unassigned') return [UNASSIGNED];
  return [scope];
}

/** 当前负责人筛选对应左栏哪一项;多选或混合时一个都不亮(null)。 */
export function scopeOf(owners: readonly string[], meId: string | null): SidebarScope | null {
  if (owners.length === 0) return 'all';
  if (owners.length !== 1) return null;
  const only = owners[0];
  if (only === UNASSIGNED) return 'unassigned';
  if (meId && only === personKey({ kind: 'user', id: meId })) return 'mine';
  if (only.startsWith('node:')) return only as SidebarScope;
  return null;
}

export interface OwnerCount { key: string; ref: RequirementPersonRef | null; name: string; count: number }

/**
 * 负责人列表(头部筛选弹层、桌面左栏「按节点」用):有卡片的负责人在前按数目降序,同数按名字;
 * 名字从 Hub 的 people 里取,取不到就用 id。未分配单独一项放最后。
 */
export function ownerCounts(items: readonly Requirement[], people: readonly RequirementPerson[]): OwnerCount[] {
  const counts = new Map<string, OwnerCount>();
  let none = 0;
  for (const item of items) {
    const refs = [item.owner, item.agentOwner].filter((r): r is RequirementPersonRef => !!r);
    if (!refs.length) { none += 1; continue; }
    for (const ref of refs) {
      const key = personKey(ref);
      const row = counts.get(key);
      if (row) row.count += 1;
      else counts.set(key, { key, ref: { kind: ref.kind, id: ref.id }, name: personName(ref, people), count: 1 });
    }
  }
  const rows = [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
  return [...rows, { key: UNASSIGNED, ref: null, name: '未分配', count: none }];
}

export function personName(ref: RequirementPersonRef, people: readonly RequirementPerson[]): string {
  return people.find(p => personKey(p) === personKey(ref))?.name || ref.id;
}

/** 卡片 / 列表上的负责人文字:负责人在前、负责 Agent 在后。旧 Hub(owner undefined)显示旧的 assignee 文本。 */
export function ownerLabel(item: Pick<Requirement, 'owner' | 'assignee' | 'agentOwner'>, people: readonly RequirementPerson[]): string {
  if (item.owner === undefined) return item.assignee || '未分配';
  const names = [item.owner, item.agentOwner].filter((r): r is RequirementPersonRef => !!r).map(r => personName(r, people));
  return names.length ? names.join(' · ') : '未分配';
}

/** 卡片上的头像:人类在前、Agent 在后(没有的那个不画)。 */
export function roleAvatars(item: Pick<Requirement, 'owner' | 'agentOwner'>, people: readonly RequirementPerson[]): { role: 'owner' | 'agent'; ref: RequirementPersonRef; name: string }[] {
  const out: { role: 'owner' | 'agent'; ref: RequirementPersonRef; name: string }[] = [];
  if (item.owner) out.push({ role: 'owner', ref: item.owner, name: personName(item.owner, people) });
  if (item.agentOwner) out.push({ role: 'agent', ref: item.agentOwner, name: personName(item.agentOwner, people) });
  return out;
}

// ── 列表视图排序 ─────────────────────────────────────────────────────────

export type SortKey = 'title' | 'owner' | 'priority' | 'due' | 'status';
export interface SortSpec { key: SortKey; dir: 'asc' | 'desc' }
export const DEFAULT_SORT: SortSpec = { key: 'status', dir: 'asc' };

const PRIORITY_RANK: Record<ReqPriority, number> = { high: 0, normal: 1, low: 2 };
const COLUMN_RANK: Record<ReqColumn, number> = { pool: 0, doing: 1, done: 2 };

/** 点表头:同一列再点一次反向,换列从升序开始。 */
export const nextSort = (cur: SortSpec, key: SortKey): SortSpec =>
  cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' };

/**
 * 列表排序。空期限永远在最后(不论升降序);同值按看板里的顺序(优先级 → 期限 → 新建时间)兜底,
 * 所以排序稳定、刷新不跳行。
 */
export function sortRows(items: readonly Requirement[], sort: SortSpec, people: readonly RequirementPerson[] = []): Requirement[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const base = (a: Requirement, b: Requirement) =>
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    || (a.due === b.due ? 0 : !a.due ? 1 : !b.due ? -1 : a.due < b.due ? -1 : 1)
    || (a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? 1 : -1)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const primary = (a: Requirement, b: Requirement): number => {
    switch (sort.key) {
      case 'title': return a.name.localeCompare(b.name, 'zh') * sign;
      case 'owner': {
        const an = a.owner || a.agentOwner || (a.owner === undefined && a.assignee) ? ownerLabel(a, people) : '';
        const bn = b.owner || b.agentOwner || (b.owner === undefined && b.assignee) ? ownerLabel(b, people) : '';
        if (an === bn) return 0;
        if (!an) return 1;
        if (!bn) return -1;
        return an.localeCompare(bn, 'zh') * sign;
      }
      case 'priority': return (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) * sign;
      case 'due':
        if (a.due === b.due) return 0;
        if (!a.due) return 1;
        if (!b.due) return -1;
        return (a.due < b.due ? -1 : 1) * sign;
      case 'status': return (COLUMN_RANK[a.column] - COLUMN_RANK[b.column]) * sign;
    }
  };
  return [...items].sort((a, b) => primary(a, b) || base(a, b));
}

// ── 期限 ─────────────────────────────────────────────────────────────────

/** 本地日期 YYYY-MM-DD(不是 UTC:北京时间早上 7 点的「今天」在 UTC 还是昨天)。 */
export function localToday(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

const dayNumber = (ymd: string): number => {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};

export type DueTone = 'none' | 'overdue' | 'today' | 'normal';

/** 期限的显示:文字 + 色调。已完成的卡片不算逾期(做完了就不再催)。 */
export function dueInfo(due: string, today: string, column: ReqColumn = 'pool'): { label: string; tone: DueTone } {
  if (!due || !dueOk(due)) return { label: '', tone: 'none' };
  const diff = dayNumber(due) - dayNumber(today);
  const [y, m, d] = due.split('-').map(Number);
  const sameYear = y === Number(today.slice(0, 4));
  const date = sameYear ? `${m}月${d}日` : `${y}年${m}月${d}日`;
  if (column === 'done') return { label: date, tone: 'normal' };
  if (diff < 0) return { label: `逾期 ${-diff} 天`, tone: 'overdue' };
  if (diff === 0) return { label: '今天', tone: 'today' };
  if (diff === 1) return { label: '明天', tone: 'normal' };
  return { label: date, tone: 'normal' };
}

// ── 拖动(只在桌面:鼠标)──────────────────────────────────────────────────

export const DRAG_THRESHOLD = 5;

export type DragState =
  | { phase: 'idle' }
  | { phase: 'pressing'; id: string; from: ReqColumn; x0: number; y0: number }
  | { phase: 'dragging'; id: string; from: ReqColumn; x: number; y: number; over: ReqColumn | null };

export type DragEvent =
  | { type: 'down'; id: string; from: ReqColumn; x: number; y: number }
  | { type: 'move'; x: number; y: number; over: ReqColumn | null }
  | { type: 'up'; over?: ReqColumn | null }
  | { type: 'cancel' };

export interface DragStep {
  state: DragState;
  /** 松手落到另一列:调用方把卡片移过去(乐观更新 + PATCH)。 */
  commit?: { id: string; from: ReqColumn; to: ReqColumn };
  /** 这次按下变成了拖动:松手后那一下点击不能再打开详情。 */
  swallowClick?: boolean;
}

export const DRAG_IDLE: DragState = { phase: 'idle' };

/**
 * 按下 → 移动超过 5px 才算拖(否则是点击)→ 松手。落在原列、落在列外、Esc 都是取消,不写 Hub。
 */
export function dragReduce(state: DragState, ev: DragEvent): DragStep {
  switch (ev.type) {
    case 'down':
      return { state: { phase: 'pressing', id: ev.id, from: ev.from, x0: ev.x, y0: ev.y } };
    case 'move':
      if (state.phase === 'pressing') {
        if (Math.hypot(ev.x - state.x0, ev.y - state.y0) < DRAG_THRESHOLD) return { state };
        return { state: { phase: 'dragging', id: state.id, from: state.from, x: ev.x, y: ev.y, over: ev.over } };
      }
      if (state.phase === 'dragging') return { state: { ...state, x: ev.x, y: ev.y, over: ev.over } };
      return { state };
    case 'up': {
      if (state.phase !== 'dragging') return { state: DRAG_IDLE };
      const over = ev.over === undefined ? state.over : ev.over;
      if (!over || over === state.from) return { state: DRAG_IDLE, swallowClick: true };
      return { state: DRAG_IDLE, commit: { id: state.id, from: state.from, to: over }, swallowClick: true };
    }
    case 'cancel':
      return { state: DRAG_IDLE, swallowClick: state.phase === 'dragging' };
  }
}

/** 拖到某列时,卡片会落在那列(按看板排序)的第几个位置 —— 落点指示线画在这里。 */
export function dropIndex(target: readonly Requirement[], dragged: Requirement, to: ReqColumn): number {
  const moved = { ...dragged, column: to };
  const rest = target.filter(item => item.id !== dragged.id);
  const sorted = columnsOf([...rest, moved]).find(c => c.column === to)!.items;
  return sorted.findIndex(item => item.id === dragged.id);
}

/** 键盘换列:Shift+← / Shift+→(到头不动)。 */
export function neighbourColumn(column: ReqColumn, dir: -1 | 1): ReqColumn | null {
  const i = REQ_COLUMNS.indexOf(column) + dir;
  return i >= 0 && i < REQ_COLUMNS.length ? REQ_COLUMNS[i] : null;
}

// ── 乐观移动 ─────────────────────────────────────────────────────────────

/** 先在本地换列(列里的数立刻变),Hub 回来再以 Hub 为准。 */
export const applyMove = (items: readonly Requirement[], id: string, to: ReqColumn): Requirement[] =>
  items.map(item => (item.id === id ? { ...item, column: to } : item));

/** Hub 拒绝:只在卡片还停在我们移过去的那列时退回(期间别处又改过就不覆盖)。 */
export const revertMove = (items: readonly Requirement[], id: string, from: ReqColumn, to: ReqColumn): Requirement[] =>
  items.map(item => (item.id === id && item.column === to ? { ...item, column: from } : item));

/** 换列只发 {column}:不带别的字段,旧 Hub 也认。 */
export const statusPatch = (to: ReqColumn): { column: ReqColumn } => ({ column: to });

// ── 新建 ─────────────────────────────────────────────────────────────────

export interface CreateDraft {
  name: string;
  priority: ReqPriority;
  due: string;
  /** 负责人。分两个角色的 Hub 上只能是人类;旧 Hub 上是唯一的负责人(人类或 Agent)。 */
  owner: RequirementPersonRef | null;
  /** 负责 Agent(只在分两个角色的 Hub 上有)。 */
  agentOwner: RequirementPersonRef | null;
  column: ReqColumn;
}

export const emptyDraft = (column: ReqColumn = 'pool'): CreateDraft => ({ name: '', priority: 'normal', due: '', owner: null, agentOwner: null, column });

/** 两个角色各自能选哪一种人:负责人 = 人类,负责 Agent = 节点;旧 Hub 的单一负责人两种都行。 */
export const roleKinds = (role: 'owner' | 'agent', twoRoles: boolean): ('user' | 'node')[] =>
  !twoRoles ? ['user', 'node'] : role === 'owner' ? ['user'] : ['node'];

export type DraftCheck =
  | { ok: true; name: string; due: string }
  | { ok: false; field: 'name' | 'due'; message: string };

export function checkDraft(d: Pick<CreateDraft, 'name' | 'due'>): DraftCheck {
  const name = d.name.trim();
  if (!name) return { ok: false, field: 'name', message: '先写任务标题' };
  if (name.length > 80) return { ok: false, field: 'name', message: '标题最多 80 个字' };
  const due = d.due.trim();
  if (!dueOk(due)) return { ok: false, field: 'due', message: '日期写成 2026-10-01,或留空' };
  return { ok: true, name, due };
}

/**
 * 发给 POST /api/requirements 的字段。负责人只带稳定身份 {kind,id}(#484):显示名不是身份,
 * 旧的 assignee 文本永远是空串。
 */
export function createInput(d: CreateDraft, twoRoles = false): { name: string; priority: ReqPriority; assignee: ''; due: string; column: ReqColumn; owner?: RequirementPersonRef; agentOwner?: RequirementPersonRef } | null {
  const c = checkDraft(d);
  if (!c.ok) return null;
  // 分两个角色的 Hub 上,种类不对的一侧不发(Hub 会 400);旧 Hub 没有负责 Agent。
  const owner = d.owner && (!twoRoles || d.owner.kind === 'user') ? d.owner : null;
  const agent = twoRoles && d.agentOwner && d.agentOwner.kind === 'node' ? d.agentOwner : null;
  return {
    name: c.name,
    priority: REQ_PRIORITIES.includes(d.priority) ? d.priority : 'normal',
    assignee: '',
    due: c.due,
    column: d.column,
    ...(owner ? { owner: { kind: owner.kind, id: owner.id } } : {}),
    ...(agent ? { agentOwner: { kind: agent.kind, id: agent.id } } : {}),
  };
}

// ── 详情编辑 ─────────────────────────────────────────────────────────────

export interface EditDraft { name: string; priority: ReqPriority; due: string; owner: RequirementPersonRef | null; agentOwner: RequirementPersonRef | null }

export const editDraftOf = (item: Requirement): EditDraft => ({
  name: item.name,
  priority: item.priority,
  due: item.due,
  owner: item.owner ? { kind: item.owner.kind, id: item.owner.id } : null,
  agentOwner: item.agentOwner ? { kind: item.agentOwner.kind, id: item.agentOwner.id } : null,
});

/** PATCH 请求体(字段名就是线上的名字)。 */
export type EditPatch = { name?: string; priority?: ReqPriority; due?: string; owner?: RequirementPersonRef | null; agent_owner?: RequirementPersonRef | null };

/**
 * 只提交改过的字段;没改返回 null(保存按钮不可用)。旧 Hub(owner undefined)不提交负责人 ——
 * 那里没有稳定身份,写进去 Hub 也不认。
 */
export function editPatch(item: Requirement, d: EditDraft): EditPatch | null {
  const patch: EditPatch = {};
  const name = d.name.trim();
  if (name !== item.name) patch.name = name;
  if (d.priority !== item.priority) patch.priority = d.priority;
  const due = d.due.trim();
  if (due !== item.due) patch.due = due;
  if (item.owner !== undefined) {
    const before = item.owner ? personKey(item.owner) : '';
    const after = d.owner ? personKey(d.owner) : '';
    if (before !== after) patch.owner = d.owner ? { kind: d.owner.kind, id: d.owner.id } : null;
  }
  if (item.agentOwner !== undefined) {
    const before = item.agentOwner ? personKey(item.agentOwner) : '';
    const after = d.agentOwner ? personKey(d.agentOwner) : '';
    if (before !== after) patch.agent_owner = d.agentOwner ? { kind: d.agentOwner.kind, id: d.agentOwner.id } : null;
  }
  return Object.keys(patch).length ? patch : null;
}

/**
 * Hub 回来的那一行有没有真的带上我们改的字段。更老的 Hub 会忽略不认识的字段、照样回 200 ——
 * 那不是「保存成功」,要告诉用户这个 Hub 还不能改。
 */
export function patchApplied(row: Requirement, patch: EditPatch): boolean {
  if (patch.name !== undefined && row.name !== patch.name) return false;
  if (patch.priority !== undefined && row.priority !== patch.priority) return false;
  if (patch.due !== undefined && row.due !== patch.due) return false;
  if (patch.owner !== undefined) {
    const want = patch.owner ? personKey(patch.owner) : '';
    const got = row.owner ? personKey(row.owner) : '';
    if (want !== got) return false;
  }
  if (patch.agent_owner !== undefined) {
    const want = patch.agent_owner ? personKey(patch.agent_owner) : '';
    const got = row.agentOwner ? personKey(row.agentOwner) : '';
    if (want !== got) return false;
  }
  return true;
}
