// 0.2.72 —— GET /api/auth/me 只请求一次:走 RELAY 隧道时那一次失败,
// 会话里就永远不知道「我是谁」,所有请求气泡按占位身份处理。改成退避重试:
// 2s / 4s / 8s,之后每 30s,直到拿到用户名或卸载。纯函数,便于测试。
export const IDENTITY_RETRY_BASE_MS = 2000;
export const IDENTITY_RETRY_CAP_MS = 30_000;

/** Delay before retry number `attempt` (1-based: first retry = 2s). */
export function nextIdentityRetryDelay(attempt: number): number {
  const n = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 1;
  if (n <= 3) return IDENTITY_RETRY_BASE_MS * 2 ** (n - 1);
  return IDENTITY_RETRY_CAP_MS;
}
