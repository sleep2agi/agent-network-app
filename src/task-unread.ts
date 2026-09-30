// 「任务」tab 的未读角标(#429,Vincent 2026-09-30「任务有新的状态,也可以标识一下这个红点」)。纯模块·可单测。
//
// 数的是:我看得见的任务里,上次打开「任务」之后被别人改过的有几张。
//   - 改过 = updatedAt 晚于 lastSeen(严格大于:等于 lastSeen 的那次改动,离开「任务」时已经在看板上了);
//   - 别人 = updatedBy 不是 {kind:'user', id: 我}。节点(包括我自己的 Agent)改的算别人改的;
//     updatedBy 为空(看不出是谁)不算 —— 可能就是我自己,宁可少一个也不把自己的改动标成红点;
//   - 同一张卡只算一次;归档了的不算(看板上已经没有它,点进去找不到)。
//
// lastSeen 用 Hub 的时钟,不用本机的:取「离开任务页时看板上最新的 updatedAt」或增量读回来的 server_time。
// 本机时钟快了慢了都不影响 —— 比较的两边都是 Hub 写的时间。按账号 + 网络各存一份(换账号不串)。
//
// 怎么知道别人改了(不在任务页时看板不轮询):
//   - Hub 声明了 changes(preview.75+):每 UNREAD_POLL_MS 读一次 changes=1&updated_since=游标,并进手里的表;
//   - 旧 Hub(.73 / .74):每 UNREAD_FULL_POLL_MS 读一次整张列表(整读 ~1 MB,所以隔得久)。
//   - 从没打开过「任务」(没有 lastSeen):不读、不显示 —— 「上次打开之后」无从算起。
import type { RequirementPersonRef } from './requirement-people';

export const UNREAD_POLL_MS = 60_000;
export const UNREAD_FULL_POLL_MS = 5 * 60_000;

/** 角标只关心卡片的这几个字段(完整的 Requirement 和精简行都满足)。 */
export interface UnreadRow {
  id: string;
  updatedAt?: string | null;
  updatedBy?: RequirementPersonRef | null;
  archived?: boolean;
}

const instant = (value: string | null | undefined): number => {
  if (!value) return Number.NaN;
  // 旧库里的「YYYY-MM-DD HH:MM:SS」是 UTC(与 board-sync.ts 同口径)。
  return Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value);
};

/** 这次改动是不是我自己做的。不知道我是谁(meId 为空)时,谁的改动都当成可能是我的。 */
export const byMe = (by: RequirementPersonRef | null | undefined, meId: string | null): boolean =>
  !by || !meId || (by.kind === 'user' && by.id === meId);

/** 角标数字:lastSeen 之后被别人改过、还在看板上的卡片张数。没有 lastSeen = 0。 */
export function countUnread(rows: Iterable<UnreadRow>, lastSeen: string | null, meId: string | null): number {
  const since = instant(lastSeen);
  if (!Number.isFinite(since)) return 0;
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.archived || byMe(row.updatedBy, meId)) continue;
    const t = instant(row.updatedAt);
    if (Number.isFinite(t) && t > since) ids.add(row.id);
  }
  return ids.size;
}

/**
 * 离开 / 打开「任务」时记下的 lastSeen:看板上最新的 updatedAt 与增量的 server_time 取大,且不往回走
 * (看板还没读到、或读到的都更旧时,保留原来的)。都没有 → 原样(可能是 null)。
 */
export function seenMark(rows: Iterable<UnreadRow>, serverTime: string | null, prev: string | null): string | null {
  let best = instant(prev);
  const take = (value: string | null | undefined) => {
    const t = instant(value);
    if (Number.isFinite(t) && !(t <= best)) best = t;
  };
  for (const row of rows) take(row.updatedAt);
  take(serverTime);
  return Number.isFinite(best) ? new Date(best).toISOString() : prev;
}

/** lastSeen 的存储键:按账号 + 网络(同一账号换网络,看得见的任务不同)。 */
export const unreadKey = (profileId: string | null | undefined, networkId: string | null | undefined): string =>
  `${profileId ?? ''}|${networkId ?? ''}`;

export type UnreadReadPlan = { kind: 'none' } | { kind: 'changes'; since: string } | { kind: 'full' };

/** 手里的状态:哪个账号、lastSeen、增量游标、lastSeen 之后读到的卡片(按 id)。 */
export interface UnreadState {
  key: string;
  lastSeen: string | null;
  /** 下次增量的 updated_since;null = 从 lastSeen 读起。 */
  cursor: string | null;
  rows: Record<string, UnreadRow>;
  /** lastSeen 之后改动太多,一页装不下(has_more):至少这么多,角标显示满。 */
  overflow: boolean;
  /** 上一次后台读的时刻(本机时钟,只用来算间隔)。 */
  readAt: number;
}

export const emptyUnread = (key: string, lastSeen: string | null): UnreadState => ({ key, lastSeen, cursor: null, rows: {}, overflow: false, readAt: 0 });

/** 这一拍读不读、怎么读。在任务页上时看板自己在轮询,这里不读。 */
export function planUnreadRead(capabilities: readonly string[], state: UnreadState, onTasks: boolean, now: number): UnreadReadPlan {
  if (onTasks || !state.lastSeen) return { kind: 'none' };
  if (capabilities.includes('changes')) {
    return now - state.readAt >= UNREAD_POLL_MS ? { kind: 'changes', since: state.cursor ?? state.lastSeen } : { kind: 'none' };
  }
  return now - state.readAt >= UNREAD_FULL_POLL_MS ? { kind: 'full' } : { kind: 'none' };
}

/** 并进一次增量:按 id 覆盖(最后一次改动是我的 = 不再算)、删掉的移除、游标前移。has_more = 游标不动,标满。 */
export function applyUnreadDelta(state: UnreadState, delta: { rows: readonly UnreadRow[]; deleted: readonly string[]; serverTime: string | null; hasMore: boolean }, now: number): UnreadState {
  const rows = { ...state.rows };
  for (const row of delta.rows) rows[row.id] = pick(row);
  for (const id of delta.deleted) delete rows[id];
  if (delta.hasMore) return { ...state, rows, overflow: true, readAt: now };
  return { ...state, rows, cursor: delta.serverTime ?? state.cursor, overflow: false, readAt: now };
}

/** 换成一次整读的结果(旧 Hub):只留 lastSeen 之后改过的,别的用不上。 */
export function applyUnreadList(state: UnreadState, list: readonly UnreadRow[], now: number): UnreadState {
  const since = instant(state.lastSeen);
  const rows: Record<string, UnreadRow> = {};
  for (const row of list) if (instant(row.updatedAt) > since) rows[row.id] = pick(row);
  return { ...state, rows, overflow: false, readAt: now };
}

/** 打开 / 离开「任务」:lastSeen 前移,手里的表和游标清空(之后从新的 lastSeen 读起)。 */
export function markUnreadSeen(state: UnreadState, lastSeen: string | null): UnreadState {
  if (!lastSeen || lastSeen === state.lastSeen) return state;
  return emptyUnread(state.key, lastSeen);
}

/** 角标的数:在任务页上 = 0;一页装不下 = 按满算(railBadgeText 画成 99+)。 */
export function unreadBadgeCount(state: UnreadState, meId: string | null, onTasks: boolean): number {
  if (onTasks) return 0;
  if (state.overflow) return 100;
  return countUnread(Object.values(state.rows), state.lastSeen, meId);
}

const pick = (row: UnreadRow): UnreadRow => ({ id: row.id, updatedAt: row.updatedAt ?? null, updatedBy: row.updatedBy ?? null, archived: !!row.archived });
