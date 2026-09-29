import { dueInstant, dueValid } from './due-time';
// 需求池。长期卡片，人新建，存在 Hub 上。不跟 Hub 里正在跑的那条消息混在一起。
export const REQ_PRIORITIES = ['high', 'normal', 'low'] as const;
export type ReqPriority = (typeof REQ_PRIORITIES)[number];
export const REQ_COLUMNS = ['pool', 'doing', 'done'] as const;
export type ReqColumn = (typeof REQ_COLUMNS)[number];

export const REQ_PRIORITY_LABEL: Record<ReqPriority, string> = { high: '高', normal: '普通', low: '低' };
export const REQ_COLUMN_LABEL: Record<ReqColumn, string> = { pool: '需求池', doing: '进行中', done: '完成' };

import type { RequirementPersonRef } from './requirement-people';

export interface ChecklistItem { id: string; text: string; done: boolean }

/** 项目(军团项目 / TMAI …)。按网络隔离;归档的不再能选,但旧卡片的引用保留。 */
export interface RequirementProject { id: string; name: string; color: string; sort: number; archived: boolean }

export interface Requirement {
  /** 负责人。两个角色的 Hub 上只会是人类;旧 Hub 上可以是人类或 Agent(单一负责人)。 */
  owner?: RequirementPersonRef | null;
  /** 负责 Agent(执行者,节点)。undefined = 这个 Hub 还不分两个角色。 */
  agentOwner?: RequirementPersonRef | null;
  /** 描述(markdown)。undefined = 这个 Hub 还没有描述 / 子任务。 */
  description?: string;
  /** 子任务(有序)。undefined = 这个 Hub 还没有。 */
  checklist?: ChecklistItem[];
  /** 项目 id。null = 不属于任何项目;undefined = 这个 Hub 还没有项目。 */
  projectId?: string | null;
  participants?: RequirementPersonRef[];
  id: string;
  name: string;
  priority: ReqPriority;
  assignee: string;
  due: string;
  column: ReqColumn;
  createdAt: string;
}

/** 空、全天 'YYYY-MM-DD'、带时区的时刻(Hub #2076 存成 UTC 到秒)都合法。见 due-time.ts。 */
export const dueOk = (due: string): boolean => dueValid(due);

/** 排序键:全天 = 本地那天结束,时刻 = 本身;空 = 最后。 */
const dueKey = (due: string): number => dueInstant(due) ?? Number.POSITIVE_INFINITY;

export function createRequirement(input: {
  name: string; priority?: ReqPriority; assignee?: string; due?: string; now?: string; id?: string;
}): Requirement | null {
  const name = input.name.trim();
  if (!name || name.length > 80) return null;
  const due = (input.due ?? '').trim();
  if (!dueOk(due)) return null;
  return {
    id: input.id || `r_${Math.random().toString(36).slice(2, 10)}`,
    name,
    priority: REQ_PRIORITIES.includes(input.priority as ReqPriority) ? input.priority as ReqPriority : 'normal',
    assignee: (input.assignee ?? '').trim().slice(0, 80),
    due,
    column: 'pool',
    createdAt: input.now || new Date().toISOString(),
  };
}

export function nextColumn(column: ReqColumn): ReqColumn {
  if (column === 'pool') return 'doing';
  if (column === 'doing') return 'done';
  return 'pool';
}

const PR: Record<ReqPriority, number> = { high: 0, normal: 1, low: 2 };
export function sortColumn(items: readonly Requirement[]): Requirement[] {
  return [...items].sort((a, b) => {
    const byP = PR[a.priority] - PR[b.priority];
    if (byP) return byP;
    const ka = dueKey(a.due), kb = dueKey(b.due);
    if (ka !== kb) return ka < kb ? -1 : 1;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
}

export function columnsOf(items: readonly Requirement[]): { column: ReqColumn; items: Requirement[] }[] {
  return REQ_COLUMNS.map(column => ({ column, items: sortColumn(items.filter(i => i.column === column)) }));
}

export function parseRequirements(raw: string | null | undefined): Requirement[] {
  if (!raw) return [];
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(data)) return [];
  const out: Requirement[] = [];
  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.name !== 'string' || !r.name.trim()) continue;
    const due = typeof r.due === 'string' && dueOk(r.due.trim()) ? r.due.trim() : '';
    out.push({
      id: r.id,
      name: r.name.trim().slice(0, 80),
      priority: REQ_PRIORITIES.includes(r.priority as ReqPriority) ? r.priority as ReqPriority : 'normal',
      assignee: typeof r.assignee === 'string' ? r.assignee.trim().slice(0, 80) : '',
      due,
      column: REQ_COLUMNS.includes(r.column as ReqColumn) ? r.column as ReqColumn : 'pool',
      createdAt: typeof r.createdAt === 'string' ? r.createdAt : '',
    });
  }
  return out;
}
