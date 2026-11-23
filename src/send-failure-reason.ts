// #552 —— 「未送达」下面那一行原因。以前发送失败一律只显示「未送达 · 点击重试」:
// 受限成员的 app 一直往过期的网络发,Hub 每次回 404 alias_not_found,她看到的只是三条「未送达」,
// 不知道是网不好、Agent 没了,还是没权限。Hub 回了明确的错误码时,把它翻成一句人话。纯函数,无 react-native。
//
// 2026-11-23 补充：
//   - 超时 / 断网给出明确人话（「网络慢，没发出去，点一下重试」），并由后台自动退避重发 2 次后才标红；
//   - 409 target_never_consumes / node_degraded / node_not_active / node_stopped 明确告知对方卡住/没在运行，
//     仍可重试（对方恢复后点一下即可，不用重新打字）；
//   - 401 走重新登录提示，同样不给「点击重试」。

/** sendTask 失败时抛的错误:带 HTTP 状态码和 Hub 的 error 码(没有就是 undefined)。 */
export class SendTaskError extends Error {
  readonly status: number | null;
  readonly code?: string;
  /** 这一次请求用的 network_id(重判网络时和新值比较)。 */
  readonly networkId?: string;
  constructor(message: string, status: number | null, code?: string, networkId?: string) {
    super(message);
    this.name = 'SendTaskError';
    this.status = status;
    if (code) this.code = code;
    if (networkId) this.networkId = networkId;
  }
}

export const ACCESS_DENIED_TO_NETWORK = 'access denied to requested network';

/** 这几种失败可能只是「网络选错了」:丢掉缓存、重新判网络,网络真变了就用同一个 client_request_id 再发一次。 */
export function isNetworkScopedSendFailure(err: unknown): err is SendTaskError {
  if (!(err instanceof SendTaskError)) return false;
  return (err.status === 404 && err.code === 'alias_not_found')
    || (err.status === 400 && err.code === 'network_id_required')
    || (err.status === 403 && err.code === ACCESS_DENIED_TO_NETWORK);
}

export type SendFailureReason =
  | 'aliasNotFound'
  | 'notGranted'
  | 'network'
  | 'attachment'
  | 'timeout'
  | 'targetUnresponsive'
  | 'targetNotRunning'
  | 'unauthorized';

const TRANSIENT_ERROR_RE = /秒内没有响应|秒内没有返回完整响应|network request failed|failed to fetch|request cancelled|timed? ?out|econnreset|econnrefused|etimedout|socket|connection|load failed/i;

/**
 * 超时 / 丢 ACK / 底层连接断开（没有拿到 Hub HTTP 状态码）：适合用同一个 client_request_id
 * 在后台退避自动重发。显式的 HTTP 4xx/5xx 响应不走自动重发（避免对 409/503 等确定性响应瞎试）。
 */
export function isAutoRetryableSendError(err: unknown): boolean {
  if (err instanceof SendTaskError) {
    return err.status === null && (err.code === 'timeout' || err.code === 'network_error');
  }
  if (!(err instanceof Error)) return false;
  if (err.name === 'AbortError' || err instanceof TypeError) return true;
  return TRANSIENT_ERROR_RE.test(err.message);
}

/** Hub 明确以 4xx 拒收（排除 408/429）：不存在「其实落库但丢 ACK」的歧义，不必再发一次 GET /api/tasks 对账。 */
export function isDefiniteSendRejection(err: unknown): boolean {
  return err instanceof SendTaskError
    && err.status !== null
    && err.status >= 400
    && err.status < 500
    && err.status !== 408
    && err.status !== 429;
}

/**
 * 这一类失败还给不给「点击重试」。只有登录过期不给（要先重新登录，重试必然再失败）。
 * 对方卡住 / 没在运行仍然可以重试：对方恢复后用户点一下就能把这条发出去，不用重新打字；
 * 原因那一行会写明「等它恢复后再点重试」。
 */
export function isRetryableSendFailure(reason?: SendFailureReason): boolean {
  return reason !== 'unauthorized';
}

/** Hub 错误码 / 超时断网 → 原因 key(i18n:chat.failReason.<key>)。未知错误 → null(只显示「未送达」)。 */
export function sendFailureReason(err: unknown): SendFailureReason | null {
  if (err instanceof SendTaskError) {
    if (err.status === 401 || err.code === 'unauthorized' || err.code === 'token_expired') {
      return 'unauthorized';
    }
    switch (err.code) {
      case 'alias_not_found': return 'aliasNotFound';
      case 'agent_not_granted':
      case 'permission_denied':
      case 'inbox_not_allowed':
      case 'inbox_denied': return 'notGranted';
      case 'network_id_required':
      case ACCESS_DENIED_TO_NETWORK: return 'network';
      case 'attachment_not_accessible': return 'attachment';
      case 'target_never_consumes':
      case 'node_degraded': return 'targetUnresponsive';
      case 'node_not_active':
      case 'node_stopped': return 'targetNotRunning';
      default: break;
    }
    if (err.status === 408 || err.status === 502 || err.status === 503 || err.status === 504) {
      return 'timeout';
    }
    return null;
  }
  if (isAutoRetryableSendError(err)) return 'timeout';
  return null;
}
