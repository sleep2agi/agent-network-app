/** Additive response contract introduced by agent-network Hub draft PR #1209. */
export interface ActualRecipient {
  alias: string;
  toNodeId: string | null;
  networkId: string | null;
}
export const ACTUAL_NOTICE_A11Y = { role: 'status', accessibilityLiveRegion: 'polite' } as const;

export interface SendConfirmation {
  actualRecipient: ActualRecipient | null;
  queued: boolean;
}

const safeText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (/\b(?:atok|utok|ntok)_[A-Za-z0-9._-]+\b|\bBearer\s+/i.test(cleaned)) return null;
  return cleaned ? cleaned.slice(0, 160) : null;
};

/**
 * Only copies the three public identity fields from an untrusted Hub response.
 * In particular, rendering the raw response could expose bearer/debug fields.
 */
export const sendConfirmationFromResponse = (value: unknown): SendConfirmation => {
  const response = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const raw = response.actual_to && typeof response.actual_to === 'object'
    ? response.actual_to as Record<string, unknown>
    : null;
  const alias = safeText(raw?.alias);
  const toNodeId = safeText(raw?.to_node_id);
  const networkId = safeText(raw?.network_id);
  return {
    actualRecipient: alias ? { alias, toNodeId, networkId } : null,
    queued: response.queued === true || response.session_status === 'offline',
  };
};

/**
 * 成功即安静。
 *
 * 一条正常送达的消息已经被气泡角上的「已送达 ✓」说过一次了(ChatScreen,
 * 只对自己发出的消息显示)。再弹一条横幅是第二个、更吵的送达指示,而送达
 * 不是需要用户处理的事件。
 *
 * 剩下两件事值得打断:对方离线导致排队,以及 **Hub 把消息投给了你没写的那个
 * 别名** —— 后者正是这个功能(#182)当初存在的理由。旧版 Hub 不报告接收方
 * 属于诊断信息,不占用户的注意力。
 */
export type SendNoticeKind = 'queued' | 'rerouted';

export interface SendNotice {
  kind: SendNoticeKind;
  title: string;
  detail: string;
}

export const sendNoticeFor = (
  confirmation: SendConfirmation,
  intendedAlias: string,
): SendNotice | null => {
  const actual = confirmation.actualRecipient;
  const intended = intendedAlias.trim();
  if (confirmation.queued) {
    return {
      kind: 'queued',
      title: '已排队',
      detail: actual ? `${actual.alias} 当前离线,消息会在它上线后送达` : '对方当前离线,消息会在其上线后送达',
    };
  }
  if (actual && actual.alias !== intended) {
    return {
      kind: 'rerouted',
      title: '已送到其他节点',
      detail: `你发给 ${intended},Hub 实际投递给 ${actual.alias}`,
    };
  }
  return null;
};

export interface NoticePalette {
  surface: string;
  outline: string;
  title: string;
  detail: string;
  dot: string;
}

/**
 * 提示条的配色。做成纯数据是为了让断言按**属性**检查(浅色主题的底必须是浅的、
 * 两个主题必须不同、任何一格都不许是纯黑),而不是去比对源码里有没有出现某个
 * 色值字符串 —— 那种判据在坏代码上照样绿。
 */
export const noticePalette = (kind: SendNoticeKind, mode: 'light' | 'dark'): NoticePalette =>
  mode === 'light'
    ? (kind === 'queued'
      ? { surface: '#fff8eb', outline: '#f0d7a6', title: '#7a5300', detail: '#8a6a2f', dot: '#d99a00' }
      : { surface: '#eef4ff', outline: '#c4d6f5', title: '#1f4488', detail: '#3f5f96', dot: '#3b74d4' })
    : (kind === 'queued'
      ? { surface: '#2a2113', outline: '#5b4420', title: '#f2d79a', detail: '#c9ab73', dot: '#d99a00' }
      : { surface: '#16233a', outline: '#2c4670', title: '#bcd4fb', detail: '#8fa8cf', dot: '#5a90e8' });

/** 自动消失的时长。够读完两行,又不至于赖着不走。 */
export const NOTICE_AUTO_DISMISS_MS = 4000;
