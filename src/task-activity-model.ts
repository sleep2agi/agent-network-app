// 任务页「动态」视图的纯逻辑(#429)。组件在 TaskActivity.tsx,数据来自 Hub 的 GET /api/requirements/events
// (capability `events`,agent-network server/src/requirement-events.ts)。纯模块·可单测:task-activity-model.test.ts。
//
// 一条事件 = 一张卡的一个字段的一次改动(谁、何时、旧值 → 新值)。画的时候:
//   - 同一个人(或 Agent)对同一张卡、前后相隔不超过 COLLAPSE_MS 的改动并成一行「更新了 N 项」,可展开看每一项;
//     新建 / 删除永远单独一行。
//   - 按本地日期分段(今天 / 昨天 / 9月28日 周一),段内新 → 旧。
//   - 筛选(全部 / 我的任务、项目、成员 / Agent、事件类型)作用在事件上,再并行 —— 并出来的「N 项」只数留下来的。
import type { RequirementPersonRef } from './requirement-people';
import type { ReqColumn, ReqPriority, Requirement } from './requirements-model';

/** 同一个人对同一张卡的连续改动,相邻两次隔多久以内算一次。 */
export const COLLAPSE_MS = 5 * 60_000;
/** 默认读多久以内的(之前的点「加载更早」)。 */
export const ACTIVITY_WINDOW_MS = 7 * 86_400_000;

export type ActivityKind = 'created' | 'changed' | 'deleted';
export interface ActivityEvent {
  id: string;
  requirementId: string;
  seq: number | null;
  title: string;
  actor: RequirementPersonRef | null;
  kind: ActivityKind;
  field: string | null;
  old: unknown;
  new: unknown;
  at: string;
  /** Date.parse(at),解析一次。 */
  ms: number;
}

const ref = (v: unknown): RequirementPersonRef | null => {
  const r = v as { kind?: unknown; id?: unknown } | null;
  return r && (r.kind === 'user' || r.kind === 'node') && typeof r.id === 'string' && r.id ? { kind: r.kind, id: r.id } : null;
};

/** Hub 的一页 → 事件(形状不对的行丢掉)。 */
export function parseEvents(raw: unknown): { events: ActivityEvent[]; nextCursor: string | null; serverTime: string | null; hasMore: boolean } {
  const data = (raw ?? {}) as { events?: unknown; next_cursor?: unknown; server_time?: unknown; has_more?: unknown };
  const events: ActivityEvent[] = [];
  for (const row of Array.isArray(data.events) ? data.events : []) {
    const r = row as Record<string, unknown>;
    const kind = r.kind === 'created' || r.kind === 'changed' || r.kind === 'deleted' ? r.kind : null;
    const ms = typeof r.at === 'string' ? Date.parse(r.at) : Number.NaN;
    if (!kind || typeof r.id !== 'string' || typeof r.requirement_id !== 'string' || !Number.isFinite(ms)) continue;
    events.push({
      id: r.id, requirementId: r.requirement_id, seq: typeof r.seq === 'number' ? r.seq : null, title: typeof r.title === 'string' ? r.title : '',
      actor: ref(r.actor), kind, field: typeof r.field === 'string' ? r.field : null, old: r.old ?? null, new: r.new ?? null, at: r.at as string, ms,
    });
  }
  return {
    events,
    nextCursor: typeof data.next_cursor === 'string' && data.next_cursor ? data.next_cursor : null,
    serverTime: typeof data.server_time === 'string' && data.server_time ? data.server_time : null,
    hasMore: data.has_more === true,
  };
}

/** 并进新读到的一页:按 id 去重(同一条后读到的覆盖),新 → 旧(同刻按 id 大的在前)。 */
export function mergeEvents(prev: readonly ActivityEvent[], incoming: readonly ActivityEvent[]): ActivityEvent[] {
  const byId = new Map(prev.map(e => [e.id, e]));
  for (const e of incoming) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => b.ms - a.ms || (Number(b.id) - Number(a.id)) || (a.id < b.id ? 1 : -1));
}

// ── 事件类型(筛选用)──
export const ACTIVITY_TYPES = ['created', 'title', 'status', 'done', 'people', 'schedule', 'tags', 'checklist', 'project', 'archive'] as const;
export type ActivityType = typeof ACTIVITY_TYPES[number];

export function activityType(e: Pick<ActivityEvent, 'kind' | 'field' | 'new'>): ActivityType {
  if (e.kind === 'created') return 'created';
  if (e.kind === 'deleted') return 'archive';
  switch (e.field) {
    case 'column': return e.new === 'done' ? 'done' : 'status';
    case 'title': case 'description': return 'title';
    case 'owner': case 'agent_owner': case 'participants': case 'assignee': return 'people';
    case 'due': case 'start': case 'priority': return 'schedule';
    case 'tags': return 'tags';
    case 'checklist': case 'checklist_item': return 'checklist';
    case 'project': case 'parent': return 'project';
    default: return 'archive';
  }
}

// ── 筛选 ──
export interface ActivityFilter {
  mine: boolean;
  /** '' = 全部项目;'none' = 未分项目。 */
  project: string;
  /** personKey('user:u1' / 'node:n1');空 = 全部。 */
  actors: string[];
  types: ActivityType[];
}
export const EMPTY_ACTIVITY_FILTER: ActivityFilter = { mine: false, project: '', actors: [], types: [] };
export const activityFilterCount = (f: ActivityFilter): number => (f.project ? 1 : 0) + (f.actors.length ? 1 : 0) + (f.types.length ? 1 : 0);
export const actorKey = (r: RequirementPersonRef | null): string => (r ? `${r.kind}:${r.id}` : '');

/** 这张卡算不算「我的任务」:我是负责人或参与人。卡不在手里(删了 / 归档了 / 看板没读到)= 不算。 */
export function isMyCard(card: Pick<Requirement, 'owner' | 'participants'> | undefined, meId: string | null): boolean {
  if (!card || !meId) return false;
  const me = (r: RequirementPersonRef | null | undefined) => !!r && r.kind === 'user' && r.id === meId;
  return me(card.owner) || !!card.participants?.some(me);
}

export function filterEvents(events: readonly ActivityEvent[], f: ActivityFilter, cards: ReadonlyMap<string, Requirement>, meId: string | null): ActivityEvent[] {
  const actors = new Set(f.actors);
  const types = new Set(f.types);
  return events.filter(e => {
    const card = cards.get(e.requirementId);
    if (f.mine && !isMyCard(card, meId)) return false;
    if (f.project) {
      const pid = card?.projectId ?? null;
      if (f.project === 'none' ? pid !== null || !card : pid !== f.project) return false;
    }
    if (actors.size && !actors.has(actorKey(e.actor))) return false;
    if (types.size && !types.has(activityType(e))) return false;
    return true;
  });
}

/** 每种类型 / 每个人各有几条(筛选菜单右边的数字,按「除了这一项以外的筛选」算)。 */
export function countBy<K extends string>(events: readonly ActivityEvent[], key: (e: ActivityEvent) => K): Map<K, number> {
  const out = new Map<K, number>();
  for (const e of events) { const k = key(e); out.set(k, (out.get(k) ?? 0) + 1); }
  return out;
}

// ── 并行 ──
export interface ActivityRow {
  /** 最新那条事件的 id(列表 key)。 */
  key: string;
  requirementId: string;
  actor: RequirementPersonRef | null;
  /** 新 → 旧。 */
  events: ActivityEvent[];
  /** 最新 / 最早一条的时刻。 */
  at: string;
  from: string;
  ms: number;
}

export function collapseEvents(events: readonly ActivityEvent[], windowMs = COLLAPSE_MS): ActivityRow[] {
  const rows: ActivityRow[] = [];
  const open = new Map<string, ActivityRow>();
  for (const e of events) {
    const row = (): ActivityRow => ({ key: e.id, requirementId: e.requirementId, actor: e.actor, events: [e], at: e.at, from: e.at, ms: e.ms });
    if (e.kind !== 'changed') { rows.push(row()); continue; }
    const k = `${actorKey(e.actor)}|${e.requirementId}`;
    const g = open.get(k);
    if (g && Date.parse(g.from) - e.ms <= windowMs) {
      g.events.push(e);
      g.from = e.at;
      continue;
    }
    const r = row();
    rows.push(r);
    open.set(k, r);
  }
  return rows;
}

/** 行里改了哪些字段(去重,保持先后;同一字段多次记 ×n):「标题、状态、优先级、检查项 ×2」。 */
export function fieldSummary(row: ActivityRow): { field: string; n: number }[] {
  const out: { field: string; n: number }[] = [];
  for (const e of [...row.events].reverse()) {
    const f = e.field === 'checklist_item' ? 'checklist' : e.field ?? '';
    const hit = out.find(x => x.field === f);
    if (hit) hit.n++; else out.push({ field: f, n: 1 });
  }
  return out;
}

// ── 按天分段 ──
const pad = (n: number) => String(n).padStart(2, '0');
export const localDay = (ms: number): string => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

export interface ActivityDay { day: string; rows: ActivityRow[]; count: number }
export function groupByDay(rows: readonly ActivityRow[]): ActivityDay[] {
  const out: ActivityDay[] = [];
  for (const r of rows) {
    const day = localDay(r.ms);
    let d = out[out.length - 1];
    if (!d || d.day !== day) out.push(d = { day, rows: [], count: 0 });
    d.rows.push(r);
    d.count += r.events.length;
  }
  return out;
}
/** 'today' / 'yesterday' / null(更早的,调用方写日期)。 */
export function dayLabel(day: string, now: number): 'today' | 'yesterday' | null {
  if (day === localDay(now)) return 'today';
  const y = new Date(now); y.setDate(y.getDate() - 1);
  return day === localDay(y.getTime()) ? 'yesterday' : null;
}

// ── 一条事件怎么说 ──
// 组件按片段画:文字、状态 / 优先级 / 项目 / 标签小块、人、划掉的旧值、箭头、检查项勾。所有面向人的字都在组件里 tr()。
export type Part =
  | { t: 'text'; key: string; vars?: Record<string, string | number> }
  | { t: 'quote'; v: string; strike?: boolean }
  | { t: 'status'; v: ReqColumn }
  | { t: 'priority'; v: ReqPriority }
  | { t: 'project'; id: string | null }
  | { t: 'tag'; v: string }
  | { t: 'person'; ref: RequirementPersonRef }
  | { t: 'date'; v: string; strike?: boolean }
  | { t: 'check'; done: boolean }
  | { t: 'arrow' };

const COLUMNS: readonly string[] = ['pool', 'doing', 'done'];
const PRIORITIES: readonly string[] = ['high', 'normal', 'low', 'lowest'];
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const refs = (v: unknown): RequirementPersonRef[] => (Array.isArray(v) ? v.map(ref).filter((r): r is RequirementPersonRef => !!r) : []);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const sameRef = (a: RequirementPersonRef, b: RequirementPersonRef) => a.kind === b.kind && a.id === b.id;

/** 字段名的 i18n 键(并行的「更新了 N 项:标题、状态…」和展开后的每一行都用它)。 */
export const FIELD_KEY: Record<string, string> = {
  column: 'act.f.column', title: 'act.f.title', priority: 'act.f.priority', due: 'act.f.due', start: 'act.f.start', assignee: 'act.f.assignee',
  owner: 'act.f.owner', agent_owner: 'act.f.agentOwner', participants: 'act.f.participants', tags: 'act.f.tags', checklist: 'act.f.checklist',
  checklist_item: 'act.f.checklist', description: 'act.f.description', project: 'act.f.project', parent: 'act.f.parent', archived: 'act.f.archived',
};

/**
 * 一条事件的说法。lead = 单独成行时的整句(「将优先级 P2 → P0」「勾选了检查项 ✓「…」」);
 * detail = 展开后的一行(字段名打头:「优先级 P2 → P0」)。done = 这条是「完成了任务」(行首画绿勾)。
 */
export function describe(e: ActivityEvent): { lead: Part[]; detail: Part[]; done?: boolean } {
  const both = (p: Part[]) => ({ lead: p, detail: p });
  if (e.kind === 'created') return both([{ t: 'text', key: 'act.created' }]);
  if (e.kind === 'deleted') return both([{ t: 'text', key: 'act.deleted' }]);
  const o = e.old, n = e.new;
  const change = (field: string, from: Part | null, to: Part | null): { lead: Part[]; detail: Part[] } => {
    const tail: Part[] = [...(from ? [from, { t: 'arrow' } as Part] : []), ...(to ? [to] : [{ t: 'text', key: 'act.none' } as Part])];
    return { lead: [{ t: 'text', key: 'act.setField', vars: { field } }, ...tail], detail: [{ t: 'text', key: FIELD_KEY[field] ?? 'act.f.other' }, ...tail] };
  };
  switch (e.field) {
    case 'column': {
      const from = COLUMNS.includes(str(o)) ? { t: 'status', v: str(o) as ReqColumn } as Part : null;
      const to = COLUMNS.includes(str(n)) ? { t: 'status', v: str(n) as ReqColumn } as Part : null;
      if (n === 'done') return { lead: [{ t: 'text', key: 'act.done' }], detail: change('column', from, to).detail, done: true };
      if (o === 'done') return { lead: [{ t: 'text', key: 'act.reopened' }, ...(to ? [to] : [])], detail: change('column', from, to).detail };
      return change('column', from, to);
    }
    case 'priority':
      return change('priority', PRIORITIES.includes(str(o)) ? { t: 'priority', v: str(o) as ReqPriority } : null, PRIORITIES.includes(str(n)) ? { t: 'priority', v: str(n) as ReqPriority } : null);
    case 'title':
      return change('title', str(o) ? { t: 'quote', v: str(o), strike: true } : null, { t: 'quote', v: str(n) });
    case 'due': case 'start': {
      const from = str(o) ? { t: 'date', v: str(o), strike: true } as Part : null;
      const to = str(n) ? { t: 'date', v: str(n) } as Part : null;
      return change(e.field, from, to);
    }
    case 'assignee':
      return change('assignee', str(o) ? { t: 'quote', v: str(o), strike: true } : null, str(n) ? { t: 'quote', v: str(n) } : null);
    case 'owner': case 'agent_owner': {
      const to = ref(n);
      const key = e.field === 'owner' ? 'owner' : 'agentOwner';
      if (to) return both([{ t: 'text', key: `act.set.${key}` }, { t: 'person', ref: to }]);
      return both([{ t: 'text', key: `act.clear.${key}` }]);
    }
    case 'participants': {
      const a = refs(o), b = refs(n);
      const added = b.filter(x => !a.some(y => sameRef(x, y)));
      const removed = a.filter(x => !b.some(y => sameRef(x, y)));
      const p: Part[] = [];
      if (added.length) p.push({ t: 'text', key: 'act.participantsAdded' }, ...added.map(r => ({ t: 'person', ref: r }) as Part));
      if (removed.length) p.push({ t: 'text', key: added.length ? 'act.andRemoved' : 'act.participantsRemoved' }, ...removed.map(r => ({ t: 'person', ref: r }) as Part));
      return both(p.length ? p : [{ t: 'text', key: 'act.participantsChanged' }]);
    }
    case 'tags': {
      const a = strs(o), b = strs(n);
      const added = b.filter(x => !a.includes(x));
      const removed = a.filter(x => !b.includes(x));
      const p: Part[] = [];
      if (added.length) p.push({ t: 'text', key: 'act.tagsAdded' }, ...added.map(v => ({ t: 'tag', v }) as Part));
      if (removed.length) p.push({ t: 'text', key: added.length ? 'act.andRemoved' : 'act.tagsRemoved' }, ...removed.map(v => ({ t: 'tag', v }) as Part));
      return both(p.length ? p : [{ t: 'text', key: 'act.tagsReordered' }]);
    }
    case 'checklist_item': {
      const item = (n ?? {}) as { text?: unknown; done?: unknown };
      const done = item.done === true;
      return both([{ t: 'text', key: done ? 'act.checked' : 'act.unchecked' }, { t: 'check', done }, { t: 'quote', v: str(item.text) }]);
    }
    case 'checklist': {
      const a = (o ?? {}) as { total?: unknown }, b = (n ?? {}) as { total?: unknown };
      return both([{ t: 'text', key: 'act.checklistEdited', vars: { from: Number(a.total) || 0, to: Number(b.total) || 0 } }]);
    }
    case 'description':
      return both([{ t: 'text', key: 'act.descriptionEdited' }]);
    case 'project': {
      const from = typeof o === 'string' ? o : null, to = typeof n === 'string' ? n : null;
      if (from && to) return both([{ t: 'text', key: 'act.movedFrom' }, { t: 'project', id: from }, { t: 'text', key: 'act.movedTo' }, { t: 'project', id: to }]);
      if (to) return both([{ t: 'text', key: 'act.movedInto' }, { t: 'project', id: to }]);
      return both([{ t: 'text', key: 'act.movedOutOf' }, { t: 'project', id: from }]);
    }
    case 'parent':
      return both([{ t: 'text', key: n ? 'act.parentSet' : 'act.parentCleared' }]);
    case 'archived':
      return both([{ t: 'text', key: n === true ? 'act.archived' : 'act.unarchived' }]);
    default:
      return both([{ t: 'text', key: 'act.changedOther' }]);
  }
}

/** 顶部一句「近 7 天 128 条 · 成员 41 · Agent 87」。 */
export function tally(events: readonly ActivityEvent[]): { total: number; members: number; agents: number } {
  let members = 0, agents = 0;
  for (const e of events) { if (e.actor?.kind === 'node') agents++; else if (e.actor) members++; }
  return { total: events.length, members, agents };
}
