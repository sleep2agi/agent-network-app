// 会话页的 user_inbox 读(`/api/messages?scope=user`):第一次读 200 条,之后每 5 s 只读最新 50 条并并进手里的 200 条。
// 纯模块·可单测。
//
// 背景(2026-09-30,连接较慢横幅):会话页每 5 s 读一次最近 200 条 user_inbox(生产 248 KB,gzip 90 KB),只为从里面
// 挑出这个 agent 的主动消息。两次读之间多出来的通常是 0–1 条。
//
// 口径与原来相同:手里保持「最新 200 条」。hub 按 created_at 新→旧给前 N 条,user_inbox 的行插入后只有 acked 会变
// (会话不读它)。所以只要这次读到的 50 条里至少有一条是手里已有的,「旧的 200 ∪ 新的 50」取最新 200 就等于整读 200;
// 50 条全是没见过的 = 中间可能有空档 → 当场补一次 200 条整读。另外每 USER_WINDOW_RESYNC_MS 整读一次,
// 兜住 hub 上被删的行。
import type { HubMessage, HubUserMessage } from './api';

export const USER_WINDOW_FULL = 200;
export const USER_WINDOW_POLL = 50;
export const USER_WINDOW_RESYNC_MS = 10 * 60_000;

type Row = HubUserMessage & { created_at?: string };
type Body = { messages?: HubMessage[] | Row[] };

const tsOf = (row: Row) => (typeof row.created_at === 'string' ? row.created_at.replace('T', ' ').slice(0, 19) : '');

/** 并进来、按 created_at 新→旧(同秒按 message_id 新→旧)、留最新 cap 条。新读到的同 id 行覆盖旧的。 */
export function mergeUserRows(prev: readonly Row[], fetched: readonly Row[], cap: number = USER_WINDOW_FULL): Row[] {
  const byId = new Map<string, Row>();
  for (const row of [...prev, ...fetched]) {
    if (row && typeof row.message_id === 'string' && row.message_id) byId.set(row.message_id, row);
  }
  return [...byId.values()]
    .sort((a, b) => {
      const ta = tsOf(a), tb = tsOf(b);
      if (ta !== tb) return ta < tb ? 1 : -1;
      return a.message_id! < b.message_id! ? 1 : a.message_id! > b.message_id! ? -1 : 0;
    })
    .slice(0, cap);
}

/** 这次读到的 poll 条里有没有手里已有的(没有 = 可能漏了中间的行)。读到的不满 poll 条说明到底了,也不会漏。 */
export function pollOverlaps(prev: readonly Row[], fetched: readonly Row[], pollLimit: number = USER_WINDOW_POLL): boolean {
  if (fetched.length < pollLimit) return true;
  const known = new Set(prev.map(r => r.message_id));
  return fetched.some(r => known.has(r.message_id));
}

export function createUserMessagesWindow() {
  let state: { key: string; rows: Row[]; fullAt: number } | null = null;
  return {
    /** `fetchPage(limit)` = `GET /api/messages?scope=user&limit=…`。失败时手里的行不动,错误照旧抛出。 */
    async read<B extends Body>(key: string, fetchPage: (limit: number) => Promise<B>, now: number = Date.now()): Promise<B & { messages: Row[] }> {
      const full = !state || state.key !== key || now - state.fullAt >= USER_WINDOW_RESYNC_MS;
      if (!full) {
        const body = await fetchPage(USER_WINDOW_POLL);
        const fetched = (Array.isArray(body?.messages) ? body.messages : []) as Row[];
        if (state && state.key === key && pollOverlaps(state.rows, fetched)) {
          state = { key, rows: mergeUserRows(state.rows, fetched), fullAt: state.fullAt };
          return { ...body, messages: state.rows };
        }
      }
      const body = await fetchPage(USER_WINDOW_FULL);
      const fetched = (Array.isArray(body?.messages) ? body.messages : []) as Row[];
      state = { key, rows: [...fetched], fullAt: now };
      return { ...body, messages: state.rows };
    },
    reset(): void { state = null; },
  };
}
