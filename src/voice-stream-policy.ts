// 识别模式(流式 / 极速版)与回退规则。纯逻辑,不 import react-native。
//
//   · 流式只在安卓 / iOS:RN 原生 WebSocket 能带鉴权头(new WebSocket(url, protocols, { headers }));
//     桌面 webview 的 WebSocket 设不了头,桌面固定极速版。
//   · 默认:手机 = 流式,桌面 = 极速版。
//   · 流式任一环节失败(连不上、没开通、中途断、松手 3 s 等不到终稿)→ 这一句自动改走极速版,
//     录音本来就整段留在内存里,用户感知只是慢一点,不会丢话。
//   · 「没开通 / 配置不对」这类**下一句也一定失败**的原因 → 记住(本次运行内),后面的句子直接
//     走极速版,设置页显示「流式未开通，已使用极速版」。网络抖动、超时这类偶发原因不记。

import type { StreamFailure, StreamOutcome } from './doubao-stream';

export type VoiceMode = 'stream' | 'flash';
export type VoicePlatform = 'android' | 'ios' | 'desktop' | 'web';

export const STREAM_UNAVAILABLE_HINT = '流式未开通，已使用极速版';

/** 设置页「识别模型」两项(Vincent 09-26:「设置的时候可以选模型，录音文件或者流式」)。 */
export const MODE_LABELS: Record<VoiceMode, string> = {
  stream: '流式语音识别（边说边出字）',
  flash: '录音文件识别·极速版（整段识别）',
};

export function streamingSupported(platform: VoicePlatform): boolean {
  return platform === 'android' || platform === 'ios';
}

export function defaultMode(platform: VoicePlatform): VoiceMode {
  return streamingSupported(platform) ? 'stream' : 'flash';
}

/** 存储里读出来的值 → 模式;没存过 / 读坏了 = 平台默认。 */
export function parseMode(raw: string | null | undefined, platform: VoicePlatform): VoiceMode {
  if (raw === 'stream' || raw === 'flash') return raw;
  return defaultMode(platform);
}

/** 这一句走哪条路。 */
export function chooseRoute(p: { mode: VoiceMode; platform: VoicePlatform; streamUnavailable: boolean }): VoiceMode {
  if (p.mode !== 'stream' || !streamingSupported(p.platform)) return 'flash';
  return p.streamUnavailable ? 'flash' : 'stream';
}

/**
 * 这次流式失败要不要记住(本次运行内不再尝试流式)。
 * 记:鉴权/资源被拒、握手 4xx、ack 前的 45xxxxxx 参数类错误、协议解不开、地址非法 —— 重试也一样。
 * 不记:网络、超时、中途断开、服务繁忙(55xxxxxx)、空音频/等包超时 —— 下一句可能就好了。
 */
export function shouldRemember(failure: StreamFailure, upstream?: string): boolean {
  switch (failure) {
    case 'auth_rejected':
    case 'not_enabled':
    case 'protocol':
    case 'bad_endpoint':
      return true;
    case 'rejected': {
      if (!upstream) return true;
      if (/^\d{3}$/.test(upstream)) return true; // 握手 4xx(408/429 已在 classifyClose 里排除)
      if (upstream === '45000002' || upstream === '45000081') return false;
      return /^45\d{6}$/.test(upstream);
    }
    default:
      return false;
  }
}

export const STREAM_SERVICE_NAME = '流式语音识别大模型';

/** 流式失败的原因,给「测试」看(聊天页只在记住时提示一次 STREAM_UNAVAILABLE_HINT)。 */
export function streamFailureMessage(failure: StreamFailure, resourceId: string, mode?: 'app-token' | 'api-key'): string {
  switch (failure) {
    case 'not_enabled': return `服务未开通：请在开通管理里开通 ${STREAM_SERVICE_NAME}（资源 ID ${resourceId}）`;
    case 'auth_rejected': return mode === 'app-token' ? '鉴权失败：App ID 或 Access Token 不对' : '鉴权失败：API Key 不对';
    case 'rejected': return `流式请求被拒（资源 ID ${resourceId}）`;
    case 'connect_failed':
    case 'connect_timeout':
    case 'closed': return '网络失败：流式连接断开';
    case 'final_timeout': return '网络失败：流式识别等终稿超时';
    case 'bad_endpoint': return '流式接口地址无效';
    case 'protocol': return '流式识别返回了无法解析的数据';
    default: return '流式识别失败';
  }
}

export type SessionLike = { finish(): Promise<StreamOutcome>; cancel(): void };

export type UtteranceResult = { text: string; via: VoiceMode; failure?: StreamFailure; upstream?: string; remembered?: boolean };

/**
 * 松手之后:有流式会话就等它的终稿;失败则用整段录音走极速版。
 * flash() 的异常(AsrError)原样抛给调用方 —— 极速版也失败,就是真的失败了。
 */
export async function finishUtterance(deps: {
  session: SessionLike | null;
  flash: () => Promise<string>;
  onRemember: (failure: StreamFailure, upstream?: string) => void;
}): Promise<UtteranceResult> {
  if (deps.session) {
    const out = await deps.session.finish();
    if (out.ok) return { text: out.text, via: 'stream' };
    if (out.failure === 'cancelled') return { text: '', via: 'stream', failure: 'cancelled' };
    const remembered = shouldRemember(out.failure, out.upstream);
    if (remembered) deps.onRemember(out.failure, out.upstream);
    const text = await deps.flash();
    return { text, via: 'flash', failure: out.failure, upstream: out.upstream, remembered };
  }
  return { text: await deps.flash(), via: 'flash' };
}

/**
 * 设置页「测试」走完之后,结果下面那行说明:流式失败改走极速版时,点名流式为什么失败。
 * 返回 undefined = 不需要说明(直接走的极速版,或流式成功)。
 */
export function testFallbackNote(route: VoiceMode, r: Pick<UtteranceResult, 'via' | 'failure' | 'remembered'>, resourceId: string, mode?: 'app-token' | 'api-key'): string | undefined {
  if (route !== 'stream' || r.via !== 'flash' || !r.failure) return undefined;
  const why = streamFailureMessage(r.failure, resourceId, mode);
  return r.remembered ? `${why}。${STREAM_UNAVAILABLE_HINT}` : `${why}，本次已改用极速版`;
}
