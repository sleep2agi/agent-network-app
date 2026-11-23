import { isAutoRetryableSendError } from './send-failure-reason';

/**
 * 超时 / 丢 ACK 后后台自动重发的退避间隔（ms）。
 * 首次失败后自动再试 2 次（合计 3 次尝试），每次复用同一个 client_request_id（Hub 幂等去重/重放），
 * 全部失败后才把气泡标红，不再要求用户一撞到 Hub 短暂卡顿就手动点重试。
 */
export const SEND_AUTO_RETRY_DELAYS_MS = [1_000, 2_000] as const;

export interface SendAutoRetryOptions {
  delaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  shouldRetry?: (err: unknown) => boolean;
  /** 返回 true 时提前结束重试（例如并发轮询已经从 Hub 对账确认该条消息已送达）。 */
  shouldStop?: () => boolean;
  onRetry?: (retryNumber: number, delayMs: number, err: unknown) => void;
}

export async function runWithSendAutoRetry<T>(
  attemptSend: (attemptIndex: number) => Promise<T>,
  options: SendAutoRetryOptions = {},
): Promise<T> {
  const delays = options.delaysMs ?? SEND_AUTO_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const shouldRetry = options.shouldRetry ?? isAutoRetryableSendError;

  let lastError: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await attemptSend(attempt);
    } catch (err) {
      lastError = err;
      if (attempt >= delays.length || !shouldRetry(err) || options.shouldStop?.()) {
        throw err;
      }
      const delayMs = delays[attempt];
      options.onRetry?.(attempt + 1, delayMs, err);
      if (delayMs > 0) await sleep(delayMs);
      if (options.shouldStop?.()) throw err;
    }
  }
  throw lastError;
}
