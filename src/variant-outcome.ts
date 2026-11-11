// #4460 / #4099 —— 档位写入的读回判定（从 NodeModelSection 抽出，便于单测）。
import { describeVariantOutcome, type VariantOutcome } from './node-variant-patch';
import { lastUpdateApplied } from './node-model-change';
import type { NodeConfigRead } from './api';

/**
 * #4099 一次档位写入的读回判定（观测窗口与「再检查一次」共用，避免两条判定走样）。
 *
 * 双条件：Hub 的 `last_update` 必须真的 applied 且 update_id 与本次提交对齐，
 * **且**顶层 `modelVariant` 已经等于目标（清除档位时目标是 null）。
 * 顶层 modelVariant 才是 server 的真相；config_snapshot 的兼容投影滞后更多，不当判据。
 */
export function variantOutcomeOf(
  v: NodeConfigRead | null,
  write: { target: string | null; effectiveModel?: string | null; updateId?: string },
): VariantOutcome {
  const ack = lastUpdateApplied(v?.last_update, write.updateId, write.effectiveModel);
  // #4460 —— 只有这一次写入自己的 last_update 才能拿来解释结果。
  // 否则上一次/别人的 `variant_busy` 会被渲染成「这一轮还在跑，档位会对下一轮生效」，
  // 让用户以为这次点了、排上了（其实那次写入根本没被接受）。
  const sameWrite = !!write.updateId && v?.last_update?.update_id === write.updateId;
  return describeVariantOutcome({
    applied: ack.applied,
    variantMatches: !!v && v.modelVariant !== undefined && v.modelVariant === write.target,
    target: write.target,
    // 本次写入的 error 原样给；不是本次的就只给「对齐原因」（update_id 不一致之类）。
    lastError: sameWrite ? (v?.last_update?.error ?? (ack.applied ? null : ack.reason)) : (ack.applied ? null : ack.reason),
    lastStatus: sameWrite ? (v?.last_update?.status ?? null) : null,
  });
}

