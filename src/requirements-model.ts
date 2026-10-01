import { dueInstant, dueValid } from './due-time';
// 需求池。长期卡片，人新建，存在 Hub 上。不跟 Hub 里正在跑的那条消息混在一起。
export const REQ_PRIORITIES = ['high', 'normal', 'low', 'lowest'] as const;
export type ReqPriority = (typeof REQ_PRIORITIES)[number];
export const REQ_COLUMNS = ['pool', 'doing', 'done'] as const;
export type ReqColumn = (typeof REQ_COLUMNS)[number];

export const REQ_PRIORITY_LABEL: Record<ReqPriority, string> = { high: '高', normal: '普通', low: '低', lowest: '极低' };
export const REQ_COLUMN_LABEL: Record<ReqColumn, string> = { pool: '需求池', doing: '进行中', done: '完成' };

import type { RequirementPersonRef } from './requirement-people';

export interface ChecklistItem { id: string; text: string; done: boolean }

/** 项目(军团项目 / TMAI …)。按网络隔离;归档的不再能选,但旧卡片的引用保留。 */
/** canEdit === false:「仅相关任务」的成员对这个项目只有查看授权(hub 只对 scoped 调用者给 viewer_can),不能把任务建进 / 挪进去。省略 = 能。 */
export interface RequirementProject { id: string; name: string; color: string; sort: number; archived: boolean; canEdit?: boolean }

export interface Requirement {
  /** Manual GitHub associations; undefined means the Hub did not expose the field. */
  issues?: import('./requirement-issues').RequirementIssue[];
  tags?: string[];
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
  /** 父需求 id(子需求);null = 顶层;undefined = 这个 Hub 还没有子需求。 */
  parentId?: string | null;
  /** 子需求进度(未归档的子需求数 / 其中完成的)。 */
  children?: { total: number; done: number };
  /** 同步来源(如 github:owner/repo#123)和它的链接。 */
  externalRef?: string | null;
  externalUrl?: string | null;
  participants?: RequirementPersonRef[];
  id: string;
  /** 短号(#N,每个网络各自递增、不回收)。undefined = 这个 Hub 还没有短号(capabilities 不含 requirement_seq)。 */
  seq?: number | null;
  name: string;
  priority: ReqPriority;
  assignee: string;
  due: string;
  column: ReqColumn;
  createdAt: string;
  /** 开始(甘特图用),形状同 due。undefined = 这个 Hub 还没有开始字段;'' = 没设。 */
  start?: string;
  /** Missing means the connected Hub did not expose update metadata. */
  updatedAt?: string | null;
  updatedBy?: RequirementPersonRef | null;
  /** 已归档(只出现在搜索「包含已归档」读回来的行里;平常的列表 Hub 不给归档的卡)。 */
  archived?: boolean;
  /** 这张卡对我只读(hub 对「仅相关任务」的成员给 viewer_can.edit=false,RFC-038 §9)。undefined = 能改。 */
  readOnly?: boolean;
  /** 只读的卡上 hub 仍放开的字段(参与人:状态、检查项;hub viewer_can.edit_fields)。只在 readOnly 时出现。 */
  editFields?: ('column' | 'checklist')[];
  /** 进「完成」列的时刻(Hub capability completed_at);null = 不在完成列;undefined = 这个 Hub 还没有。 */
  completedAt?: string | null;
  /** completedAt 是升级前按 updatedAt 补的近似值。 */
  completedAtApprox?: boolean;
  /** 谁把它移进「完成」的(近似值的卡为 null)。 */
  completedBy?: RequirementPersonRef | null;
  /**
   * 这一行来自精简列表(Hub capability list_summary,view=summary):没带 description / checklist 正文,
   * 只带下面两个摘要;打开这张卡时按 id 读全文(board-sync.ts)。undefined = 完整的一行。
   */
  summary?: true;
  hasDescription?: boolean;
  checklistCount?: { total: number; done: number };
}

/**
 * 标题里有没有看得见的字。Hub 端和 requirementFromHub 都只 trim 空白,只由零宽字符(U+200B、U+FEFF…)
 * 或其它格式字符组成的名字能通过,列表里就是一行空标题。
 */
export const hasVisibleTitle = (name: string): boolean => name.replace(/[\s\p{Cf}\p{Z}]/gu, '').length > 0;
/** 列表 / 卡片上显示的标题:看不见字时「(无标题)· id 末 6 位」,好认也好点开改。 */
export const titleText = (item: Pick<Requirement, 'name' | 'id'>): string =>
  hasVisibleTitle(item.name) ? item.name : `（无标题）· ${item.id.length > 6 ? item.id.slice(-6) : item.id}`;

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

const PR: Record<ReqPriority, number> = { high: 0, normal: 1, low: 2, lowest: 3 };
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
