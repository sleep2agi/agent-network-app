// 2026-09-16(Vincent:「发一个消息都要被吞一段时间才会显示」):发送成功后本地回显不再撤掉,
// 直到服务器行到了才让位。让位判据:hub 返回的 task_id 出现在拉回的行里;拿不到 id(老 hub)时,
// 同内容且时间在 6 分钟内也算(与 confirmedOutboxIds 同口径)。
//
// 2026-09-26(Vincent,0.2.113 展开的折叠屏:最后两条「发送中…」一直不变,对方其实已经收到并回复了):
// 回显的 _localId 就是这次发送的 dreq id(sendTask 把它作为 meta.client_request_id 发给 hub,
// hub 存进 meta_json 并在 /api/tasks 行里原样返回)。拉回的行带着同一个 id ⇒ 这条就是它,
// hub 已收 = 已送达 —— 不管本地还标着「发送中」。
// 以前「发送中」的回显只有两条出路:发起它的那次 doSend 回来改本地 state,或 load() 里按 outbox
// 条目 + 内容对上。ChatScreen 重挂(两栏里点别的 agent 再点回来 = key 变了;折叠/展开;主题 /
// 密度切换重 key)时,新实例从 outbox / 会话缓存恢复出「发送中」回显;旧实例的 doSend 成功后删掉
// outbox 条目、只改缓存 —— 新实例的回显两条出路都断了:永远「发送中…」,旁边还多一条 hub 的同文行。
import { dashboardRequestIdForLocalId } from './api';

export type EchoLike = { _localId?: string; _confirmedTaskId?: string; _pending?: boolean; content?: string; created_at?: string };
export type FetchedLike = { task_id?: string; content?: string; created_at?: string; meta_json?: string | null; meta?: unknown };

const windowMs = 6 * 60 * 1000;
// Hub timestamps are UTC without a zone ("2026-09-26 10:43:25"); Date.parse would read that as
// device-local time and put every row hours off on a phone east of UTC (same rule as chat-actions).
const t = (iso?: string) => {
  if (!iso) return NaN;
  const n = Date.parse(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  return Number.isFinite(n) ? n : NaN;
};

/** The dashboard request id a hub task row was created with (meta.client_request_id), or null. */
export const clientRequestIdOfRow = (row: FetchedLike): string | null => {
  let meta: unknown = row?.meta;
  if (meta == null && typeof row?.meta_json === 'string' && row.meta_json) {
    try { meta = JSON.parse(row.meta_json); } catch { return null; }
  }
  const id = meta && typeof meta === 'object' ? (meta as Record<string, unknown>).client_request_id : null;
  return typeof id === 'string' && id ? id : null;
};

/** True when a fetched hub row was created by the send whose local id is `localId`. */
export const rowIsLocalSend = (row: FetchedLike, localId: string): boolean => {
  const rid = clientRequestIdOfRow(row);
  return rid !== null && rid === dashboardRequestIdForLocalId(localId);
};

export const echoSupersededByFetched = (echo: EchoLike, fetched: FetchedLike[]): boolean => {
  if (!echo._localId) return false;
  // Hub-authoritative: the row carries this send's request id. Pending, failed or delivered,
  // the local copy is now a duplicate of a row the hub has.
  const localId = echo._localId;
  if (fetched.some(row => rowIsLocalSend(row, localId))) return true;
  if (echo._pending) return false;
  if (echo._confirmedTaskId) return fetched.some(row => row.task_id === echo._confirmedTaskId);
  const mine = t(echo.created_at);
  // Content + time only for rows without a request id (hubs that do not return meta).
  return fetched.some(row => clientRequestIdOfRow(row) === null && (row.content ?? '').trim() === (echo.content ?? '').trim()
    && Number.isFinite(mine) && Number.isFinite(t(row.created_at)) && Math.abs(t(row.created_at) - mine) <= windowMs);
};
