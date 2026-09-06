// Vincent 2026-09-06「节点上根本没有微信那样的红点」——
//
// 生产 hub 只读证据(24h):agent 回给 admin 的 70 条全在 `inbox` 表(session_name='admin', type='reply',
// acked 永远 0),而角标链路(#1563 / #213)只读 `/api/messages?scope=user` = `user_inbox` 表
// (总共 2 行,都是 09-03 的凭据告警)。也就是说:**agent 的回复从来不进未读计数**。
//
// 这里补上另一半,而且不依赖 hub 改动(他生产 hub 还是 0.9.0-preview.45):
//   - 用 alias 分支 `/api/messages?limit=N`(读 `inbox` 表,全网络最近 N 条)里
//     `to_alias === 登录用户名` 的行,按 from_alias 计数;
//   - 每个 agent 一条「看到哪」水位线(该 agent 最近一条已渲染消息的 created_at,hub 的 UTC
//     `YYYY-MM-DD HH:MM:SS` 字符串,可直接字典序比较),会话渲染到最新时推进水位线并持久化;
//   - 未读 = created_at > 水位线 的行数。重启后水位线还在,不会把历史全算成未读。
// hub 侧后续再加 per-agent 权威数 + ack(主仓 issue 待开);那时这里退位。
import type { HubMessage } from './api';

export const REPLY_WATERMARK_KEY = 'chat_reply_unread_watermarks_v1';
/** 只算 agent 发给用户的这几类;别的类型(状态类)不算未读。 */
const COUNTED_TYPES = new Set(['reply', 'task', 'message']);

export type ReplyWatermarks = Readonly<Record<string, string>>;

/** hub 的 created_at 是 UTC `YYYY-MM-DD HH:MM:SS`;本地兜底也生成同一格式。 */
export function hubNowTimestamp(now: Date = new Date()): string {
  return now.toISOString().replace('T', ' ').slice(0, 19);
}

function normalizeTs(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  return value.replace('T', ' ').slice(0, 19);
}

export function isReplyToUser(row: HubMessage, username: string): boolean {
  if (!row || !username) return false;
  if (row.to_alias !== username) return false;
  if (typeof row.from_alias !== 'string' || !row.from_alias.trim()) return false;
  if (row.from_alias === username) return false;
  const type = typeof row.type === 'string' ? row.type : 'reply';
  return COUNTED_TYPES.has(type);
}

/** 每个 agent 的未读回复数:to 用户、created_at 晚于该 agent 的水位线。 */
export function replyUnreadByAgent(rows: readonly HubMessage[] | null | undefined, username: string, watermarks: ReplyWatermarks): Record<string, number> {
  const out: Record<string, number> = {};
  if (!rows || !username) return out;
  for (const row of rows) {
    if (!isReplyToUser(row, username)) continue;
    const ts = normalizeTs(row.created_at);
    if (!ts) continue;
    const seen = watermarks[row.from_alias!] ?? '';
    if (ts <= seen) continue;
    out[row.from_alias!] = (out[row.from_alias!] ?? 0) + 1;
  }
  return out;
}

/** 会话渲染到最新:水位线 = 该 agent 发给用户的最新一条的 created_at(hub 时间);一条都没有就用现在。 */
export function watermarkAfterRender(rows: readonly HubMessage[] | null | undefined, username: string, agent: string, now: Date = new Date()): string {
  let latest = '';
  for (const row of rows ?? []) {
    if (!isReplyToUser(row, username) || row.from_alias !== agent) continue;
    const ts = normalizeTs(row.created_at);
    if (ts && ts > latest) latest = ts;
  }
  const local = hubNowTimestamp(now);
  return latest > local ? latest : local;
}

export function advanceWatermark(watermarks: ReplyWatermarks, agent: string, ts: string): ReplyWatermarks {
  if (!agent || !ts) return watermarks;
  const current = watermarks[agent] ?? '';
  if (ts <= current) return watermarks;
  return { ...watermarks, [agent]: ts };
}

const storage = (): Storage | null => {
  if (!(globalThis as any).__TAURI_INTERNALS__ || typeof localStorage === 'undefined') return null;
  return localStorage;
};

export function parseStoredWatermarks(raw: string | null | undefined): ReplyWatermarks {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [agent, ts] of Object.entries(parsed)) {
      if (typeof ts === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(ts)) out[agent] = ts;
    }
    return out;
  } catch {
    return {};
  }
}

export function loadReplyWatermarks(): ReplyWatermarks {
  const desktop = storage();
  if (!desktop) return {};
  return parseStoredWatermarks(desktop.getItem(REPLY_WATERMARK_KEY));
}

export function saveReplyWatermarks(watermarks: ReplyWatermarks): boolean {
  const desktop = storage();
  if (!desktop) return false;
  desktop.setItem(REPLY_WATERMARK_KEY, JSON.stringify(watermarks));
  return true;
}
