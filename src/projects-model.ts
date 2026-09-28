// 项目管理的最小一条。不是看板：一项就是名字、优先级、负责节点、预计完成。
// 存在本机，不进 Hub，也不连 GitHub Project。

export const PROJECT_PRIORITIES = ['high', 'normal', 'low'] as const;
export type ProjectPriority = (typeof PROJECT_PRIORITIES)[number];
export const PROJECT_STATUSES = ['todo', 'doing', 'done'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PRIORITY_LABEL: Record<ProjectPriority, string> = {
  high: '高',
  normal: '普通',
  low: '低',
};
export const STATUS_LABEL: Record<ProjectStatus, string> = {
  todo: '未开始',
  doing: '进行中',
  done: '完成',
};

export interface ProjectItem {
  id: string;
  name: string;
  priority: ProjectPriority;
  /** 负责的节点别名。空着表示还没分。 */
  assignee: string;
  /** YYYY-MM-DD。空着表示没定预计完成。 */
  due: string;
  status: ProjectStatus;
  createdAt: string;
}

const DUE = /^\d{4}-\d{2}-\d{2}$/;

export function dueOk(due: string): boolean {
  if (!due) return true;
  if (!DUE.test(due)) return false;
  const [y, m, d] = due.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function createProject(input: {
  name: string;
  priority?: ProjectPriority;
  assignee?: string;
  due?: string;
  now?: string;
  id?: string;
}): ProjectItem | null {
  const name = input.name.trim();
  if (!name || name.length > 80) return null;
  const due = (input.due ?? '').trim();
  if (!dueOk(due)) return null;
  const priority = PROJECT_PRIORITIES.includes(input.priority as ProjectPriority)
    ? (input.priority as ProjectPriority)
    : 'normal';
  return {
    id: input.id || `p_${Math.random().toString(36).slice(2, 10)}`,
    name,
    priority,
    assignee: (input.assignee ?? '').trim().slice(0, 80),
    due,
    status: 'todo',
    createdAt: input.now || new Date().toISOString(),
  };
}

export function cycleStatus(status: ProjectStatus): ProjectStatus {
  if (status === 'todo') return 'doing';
  if (status === 'doing') return 'done';
  return 'todo';
}

const PRIORITY_RANK: Record<ProjectPriority, number> = { high: 0, normal: 1, low: 2 };
const STATUS_RANK: Record<ProjectStatus, number> = { todo: 0, doing: 1, done: 2 };

/** 未完成在前，高优先级在前，有日期的按日期从近到远，没日期的在后。 */
export function sortProjects(items: readonly ProjectItem[]): ProjectItem[] {
  return [...items].sort((a, b) => {
    const byStatus = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (byStatus) return byStatus;
    const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (byPriority) return byPriority;
    if (a.due !== b.due) {
      if (!a.due) return 1;
      if (!b.due) return -1;
      return a.due < b.due ? -1 : 1;
    }
    return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
  });
}

export function parseProjects(raw: string | null | undefined): ProjectItem[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: ProjectItem[] = [];
  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.name !== 'string' || !r.name.trim()) continue;
    const due = typeof r.due === 'string' && dueOk(r.due.trim()) ? r.due.trim() : '';
    out.push({
      id: r.id,
      name: r.name.trim().slice(0, 80),
      priority: PROJECT_PRIORITIES.includes(r.priority as ProjectPriority)
        ? (r.priority as ProjectPriority)
        : 'normal',
      assignee: typeof r.assignee === 'string' ? r.assignee.trim().slice(0, 80) : '',
      due,
      status: PROJECT_STATUSES.includes(r.status as ProjectStatus)
        ? (r.status as ProjectStatus)
        : 'todo',
      createdAt: typeof r.createdAt === 'string' ? r.createdAt : '',
    });
  }
  return out;
}
