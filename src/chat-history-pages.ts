// board #745 —— 长会话分批加载:先拉最新一页,往上滑再按游标拉「更早的一页」,不再每次把整个窗口重拉一遍。
//
// 旧做法(到 0.2.222):翻页 = limit 从 20 涨到 40、60……然后整窗重拉;hub 一次最多给 200 条
// (server.ts `Math.min(limit, 200)`),limit 涨到 220 时 hub 给 200,`200 < 220` 被当成「到起点了」,
// 更早的历史再也拉不到。hub 从 #459(2026-08-09)起就支持 `before` + `before_task_id` 游标,
// 排序是 `created_at DESC, task_id DESC` —— 这里的比较完全照它来,边界上不漏不重。
//
// 只处理 hub 的 tasks 行(newest-first)。本地回显 / 主动消息由 ChatScreen 照旧并进来。

/** 一页多少条:首屏 = 最新这么多条。 */
export const CHAT_PAGE = 30;
/** hub GET /api/tasks 一次最多给的条数。 */
export const HUB_MAX_LIMIT = 200;

export type HubRow = { task_id?: string; created_at?: string };

export type TaskPageParams = { to_name: string; limit: number; before?: string; before_task_id?: string; skipStats: true };

/** 轮询 / 首屏:不带游标,取最新 `window` 条(不超过 hub 上限)。 */
export const newestPageParams = (alias: string, window: number): TaskPageParams => ({
  to_name: alias,
  limit: Math.max(1, Math.min(window, HUB_MAX_LIMIT)),
  skipStats: true,
});

/** 往上翻:从已加载的最老一条往前取一页。没有可作游标的行就返回 null(交给轮询先拉首屏)。 */
export const olderPageParams = <T extends HubRow>(alias: string, hubRows: T[]): TaskPageParams | null => {
  for (let i = hubRows.length - 1; i >= 0; i--) {
    const { created_at, task_id } = hubRows[i];
    if (!created_at) continue;
    return { to_name: alias, limit: CHAT_PAGE, before: created_at, ...(task_id ? { before_task_id: task_id } : {}), skipStats: true };
  }
  return null;
};

/** hub 的排序键:created_at DESC, task_id DESC。a 比 b 更老 ⇒ true。 */
const olderThan = (a: HubRow, b: HubRow): boolean => {
  const ca = a.created_at ?? '', cb = b.created_at ?? '';
  if (ca !== cb) return ca < cb;
  return (a.task_id ?? '') < (b.task_id ?? '');
};

const byTaskId = <T extends HubRow>(rows: T[]) => new Set(rows.map(r => r.task_id).filter(Boolean));

/**
 * 最新一页落地:这页本身就是这段区间的权威(状态、回复都以它为准);
 * 比这页最老一条还老的、之前翻页拉到的行原样留着 —— 轮询不能把用户往上翻过的历史缩回去。
 * 这页不满 `limit` ⇒ 它就是全部历史,不留别的。
 */
export const mergeNewestPage = <T extends HubRow>(prev: T[], page: T[], limit: number): T[] => {
  if (page.length < limit) return page;
  const oldest = page[page.length - 1];
  const ids = byTaskId(page);
  return [...page, ...prev.filter(r => !(r.task_id && ids.has(r.task_id)) && olderThan(r, oldest))];
};

/** 更早的一页落地:接在末尾(视觉上的顶部),按 task_id 去重(边界上那条不重复)。 */
export const mergeOlderPage = <T extends HubRow>(prev: T[], page: T[]): { rows: T[]; added: number } => {
  const ids = byTaskId(prev);
  const fresh = page.filter(r => !(r.task_id && ids.has(r.task_id)));
  return { rows: [...prev, ...fresh], added: fresh.length };
};

/**
 * 更早的一页之后还有没有更早的。不满一页 ⇒ 到起点。
 * 一条新的都没添 ⇒ 也停:不认 `before` 的老 hub 会把最新一页原样再给一遍,不停就是死循环。
 */
export const olderPageHasMore = (pageLength: number, added: number): boolean =>
  pageLength >= CHAT_PAGE && added > 0;
