// #552 —— 「未送达」下面那一行原因。以前发送失败一律只显示「未送达 · 点击重试」:
// 受限成员的 app 一直往过期的网络发,Hub 每次回 404 alias_not_found,她看到的只是三条「未送达」,
// 不知道是网不好、Agent 没了,还是没权限。Hub 回了明确的错误码时,把它翻成一句人话。纯函数,无 react-native。

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

export type SendFailureReason = 'aliasNotFound' | 'notGranted' | 'network' | 'attachment';

/** Hub 错误码 → 原因 key(i18n:chat.failReason.<key>)。超时 / 断网 / 未知码 → null(只显示「未送达」)。 */
export function sendFailureReason(err: unknown): SendFailureReason | null {
  const code = err instanceof SendTaskError ? err.code : undefined;
  switch (code) {
    case 'alias_not_found': return 'aliasNotFound';
    case 'agent_not_granted':
    case 'permission_denied': return 'notGranted';
    case 'network_id_required':
    case ACCESS_DENIED_TO_NETWORK: return 'network';
    case 'attachment_not_accessible': return 'attachment';
    default: return null;
  }
}
