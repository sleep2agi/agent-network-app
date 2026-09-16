// 2026-09-16(Vincent:「发一个消息都要被吞一段时间才会显示」):发送成功后本地回显不再撤掉,
// 直到服务器行到了才让位。让位判据:hub 返回的 task_id 出现在拉回的行里;拿不到 id(老 hub)时,
// 同内容且时间在 6 分钟内也算(与 confirmedOutboxIds 同口径)。
export type EchoLike = { _localId?: string; _confirmedTaskId?: string; _pending?: boolean; content?: string; created_at?: string };
export type FetchedLike = { task_id?: string; content?: string; created_at?: string };

const windowMs = 6 * 60 * 1000;
const t = (iso?: string) => { const n = Date.parse(iso || ''); return Number.isFinite(n) ? n : NaN; };

export const echoSupersededByFetched = (echo: EchoLike, fetched: FetchedLike[]): boolean => {
  if (!echo._localId || echo._pending) return false;
  if (echo._confirmedTaskId) return fetched.some(row => row.task_id === echo._confirmedTaskId);
  const mine = t(echo.created_at);
  return fetched.some(row => (row.content ?? '').trim() === (echo.content ?? '').trim()
    && Number.isFinite(mine) && Number.isFinite(t(row.created_at)) && Math.abs(t(row.created_at) - mine) <= windowMs);
};
