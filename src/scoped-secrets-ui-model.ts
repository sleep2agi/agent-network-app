// #5675 PR-2 / PR-3 —— 节点「密钥」页表单解耦与热生效状态映射纯逻辑。
//
// 原则：读取「已有名称列表」不能锁住输入框和保存按钮；超过 8 秒没结果就停止转圈并
// 明确告知「节点正在忙，名称列表暂时读不到；仍可直接保存新密钥」。
// 仅在真正提交写入（writing）或 Hub/节点明确返回能力不支持/无权限（hardBlock）时禁用保存。
import { SECRET_SHADOWED_COPY } from './chat-secret-auto-apply';
import type { SecretActivation } from './scoped-secrets';

export const SECRET_LIST_SOFT_TIMEOUT_MS = 8000;

export type SecretListState = 'idle' | 'loading' | 'ready' | 'timed_out' | 'error';
export type SecretHardBlock = null | 'unsupported' | 'forbidden';

export type SecretWriteOutcome = {
  kind: SecretActivation;
  shouldOfferRestart: boolean;
  tone: 'running' | 'blocked' | 'muted';
  /** 明确要求固定中文文案时直出（如 shadowed）；否则走 i18nKey。 */
  text?: string;
  i18nKey?: string;
};

export function secretFormEditable(state: { writing: boolean; hardBlock: SecretHardBlock }): boolean {
  return !state.writing && state.hardBlock === null;
}

export function secretSaveDisabled(state: { writing: boolean; hardBlock: SecretHardBlock }): boolean {
  return state.writing || state.hardBlock !== null;
}

export function secretListStatusText(listState: SecretListState): string {
  switch (listState) {
    case 'loading':
      return '读取中…';
    case 'timed_out':
      return '节点正在忙，名称列表暂时读不到；仍可直接保存新密钥';
    default:
      return '';
  }
}

/**
 * #5675 PR-3 —— 根据节点回执中的 activation 决定密钥页文案与是否弹重启闭环。
 * - shadowed: 外层启动环境/配置覆盖，重启也没用，不弹重启，明确提示去节点配置删掉那一项；
 * - hot_applied: 已热生效，无需重启；
 * - hot_pending_idle: 节点忙，空闲后自动热生效，无需重启；
 * - next_start（或旧节点缺省）: 保持原重启倒计时/手动命令闭环。
 */
export function secretWriteOutcome(
  activation: SecretActivation | undefined | null,
  action: 'put' | 'delete',
  independent: boolean,
): SecretWriteOutcome {
  if (activation === 'shadowed') {
    return {
      kind: 'shadowed',
      shouldOfferRestart: false,
      tone: 'blocked',
      text: SECRET_SHADOWED_COPY,
    };
  }
  if (activation === 'hot_applied') {
    return {
      kind: 'hot_applied',
      shouldOfferRestart: false,
      tone: 'running',
      i18nKey: action === 'put' ? 'scopedSecrets.hotApplied' : 'scopedSecrets.hotDeleted',
    };
  }
  if (activation === 'hot_pending_idle') {
    return {
      kind: 'hot_pending_idle',
      shouldOfferRestart: false,
      tone: 'blocked',
      i18nKey: action === 'put' ? 'scopedSecrets.hotPendingIdle' : 'scopedSecrets.hotDeletePendingIdle',
    };
  }
  return {
    kind: 'next_start',
    shouldOfferRestart: true,
    tone: 'muted',
    i18nKey: independent
      ? action === 'put' ? 'scopedSecrets.nodeSaved' : 'scopedSecrets.nodeDeleted'
      : action === 'put' ? 'scopedSecrets.saved' : 'scopedSecrets.deleted',
  };
}
