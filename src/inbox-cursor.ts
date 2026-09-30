// 回复未读 / 通知用的 inbox 读(alias 分支 `/api/messages?limit=300&since=…`)改成增量。纯模块·可单测。
//
// 背景(2026-09-30,Vincent「连接较慢,数据可能有延迟…越来越大了」):Agent 列表和通知每 10 s 读一次
// 「最近 7 天、最多 300 条」,生产上每次 473 KB(gzip 116 KB),而这 300 条其实只覆盖约 1.5 小时的全网流量,
// 两次读之间通常只多了几条。这一路是每个客户端最大的常驻流量,和别的读挤同一条跨太平洋链路。
//
// 现在:第一次(或换了 hub / 账号 / 网络,或距上次整读超过 INBOX_RESYNC_MS)照旧整读 7 天;之后只读
// `since=<已见最新一条的 created_at − INBOX_OVERLAP_MS>`(hub 是 `created_at >= since`,重叠的行按 id 去重),
// 和手里的行合并,再按整读的口径裁剪:7 天窗口内、按 created_at 新→旧、最多 300 条。
// 因为 hub 整读返回的就是「窗口内最新的 300 条」,「旧的最新 300 条 ∪ 游标之后的全部新行」取最新 300 条
// 与它逐行相同 —— 下游(回复未读、通知、列表预览)看到的集合不变。
// 整读不会知道的只有两件事:已有行的 acked 变了、行被 hub 删了。它们只影响 ack 时多带几个已 ack 的 id
// (hub 上是 no-op),所以定期整读一次兜底即可。
import type { HubMessage } from './api';

/** 与原来的整读同一个上限和窗口。 */
export const INBOX_LIMIT = 300;
export const INBOX_WINDOW_MS = 7 * 24 * 3600 * 1000;
/** 增量读最多连续这么久,之后整读一次(拿到 acked 变化和被删掉的行)。 */
export const INBOX_RESYNC_MS = 10 * 60_000;
/** 游标往回让这么多再读:hub 的 created_at 是插入时刻、秒精度;事务里取的时刻(PG 的 now() 是事务开始时刻)
 *  可能比别的先提交的行早一点。多读一分钟的行(按 id 去重)换「不漏」。 */
export const INBOX_OVERLAP_MS = 60_000;

export type InboxCursorCache = {
  /** hub + 令牌 + 网络:任一变了就是另一份数据。 */
  key: string;
  rows: HubMessage[];
  /** 最近一次整读成功的时刻。 */
  fullAt: number;
};

/** hub 的 UTC `YYYY-MM-DD HH:MM:SS`(sqlite 原样;别的后端若回 ISO 也归一成这个)。 */
export function hubTs(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  return value.replace('T', ' ').slice(0, 19);
}

export function windowStart(now: number): string {
  return new Date(now - INBOX_WINDOW_MS).toISOString().replace('T', ' ').slice(0, 19);
}

/** 手里最新一条的 created_at;一条都没有 → null(只能整读)。 */
export function inboxCursorOf(rows: readonly HubMessage[]): string | null {
  let newest: string | null = null;
  for (const row of rows) {
    const ts = hubTs(row?.created_at);
    if (ts && (newest === null || ts > newest)) newest = ts;
  }
  return newest;
}

/** 这一次读什么:整读(since = 7 天前)还是增量(since = 游标)。 */
export function inboxReadPlan(cache: InboxCursorCache | null, key: string, now: number): { full: boolean; since: string } {
  const cursor = cache && cache.key === key ? inboxCursorOf(cache.rows) : null;
  const full = !cache || cache.key !== key || cursor === null || now - cache.fullAt >= INBOX_RESYNC_MS;
  if (full) return { full: true, since: windowStart(now) };
  const back = Date.parse(`${cursor!.replace(' ', 'T')}Z`) - INBOX_OVERLAP_MS;
  return { full: false, since: Number.isFinite(back) ? new Date(back).toISOString().replace('T', ' ').slice(0, 19) : cursor! };
}

/**
 * 增量读回来的行并进手里的行,按整读的口径裁剪。新读到的同 id 行覆盖旧的(内容 / acked 以新为准)。
 * 排序:created_at 新→旧;同一秒内按 id 新→旧,与原来一样只保证按时间有序。
 */
export function mergeInboxRows(prev: readonly HubMessage[], fetched: readonly HubMessage[], now: number, limit: number = INBOX_LIMIT): HubMessage[] {
  const since = windowStart(now);
  const byId = new Map<string, HubMessage>();
  const add = (row: HubMessage) => {
    if (!row || typeof row.id !== 'string' || !row.id) return;
    const ts = hubTs(row.created_at);
    if (!ts || ts < since) return;
    byId.set(row.id, row);
  };
  prev.forEach(add);
  fetched.forEach(add);
  return [...byId.values()]
    .sort((a, b) => {
      const ta = hubTs(a.created_at)!;
      const tb = hubTs(b.created_at)!;
      if (ta !== tb) return ta < tb ? 1 : -1;
      return a.id! < b.id! ? 1 : a.id! > b.id! ? -1 : 0;
    })
    .slice(0, limit);
}

/** 一次读成功后的新缓存。整读:手里的行整体换成读到的(与原来逐字相同)。 */
export function nextInboxCache(cache: InboxCursorCache | null, key: string, plan: { full: boolean }, fetched: readonly HubMessage[], now: number): InboxCursorCache {
  if (plan.full || !cache || cache.key !== key) {
    return { key, rows: [...fetched], fullAt: now };
  }
  return { key, rows: mergeInboxRows(cache.rows, fetched, now), fullAt: cache.fullAt };
}

/**
 * 带游标的读取器。`fetchPage(limit, since)` = hub 的 `created_at >= since ORDER BY created_at DESC LIMIT limit`。
 * Agent 列表和通知轮询共用 api.ts 里的同一个实例,两边看到的是同一份行。读失败时缓存不动,错误照旧抛出。
 */
export function createReplyInboxReader() {
  let cache: InboxCursorCache | null = null;
  return {
    async read<B extends { messages?: HubMessage[] }>(
      key: string,
      fetchPage: (limit: number, since: string) => Promise<B>,
      now: number = Date.now(),
    ): Promise<B & { messages: HubMessage[] }> {
      const plan = inboxReadPlan(cache, key, now);
      const body = await fetchPage(INBOX_LIMIT, plan.since);
      const fetched = Array.isArray(body?.messages) ? body.messages : [];
      cache = nextInboxCache(cache, key, plan, fetched, now);
      return { ...body, messages: cache.rows };
    },
    reset(): void { cache = null; },
  };
}
