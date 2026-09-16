// 2026-09-16(Vincent:桌面端经 RELAY 连 hub,链路 ~13 KB/s,一次列表轮询 128 KB 要 17 s):
// 固定 setInterval 会在上一次还没回来时又发一次,把慢链路彻底占死,发消息和拉历史全排在后面。
// usePoll 改成「上一次结束后再排下一次」,间隔按上一次耗时退避:next = max(intervalMs, lastDurationMs × 2),
// 上限 6 × intervalMs。快链路上行为和以前一样(耗时 << 间隔)。纯函数单独放这里,测试不用碰 react-native。
export const nextPollDelay = (intervalMs: number, lastDurationMs: number): number => {
  const backoff = Math.max(intervalMs, lastDurationMs * 2);
  return Math.min(backoff, intervalMs * 6);
};
