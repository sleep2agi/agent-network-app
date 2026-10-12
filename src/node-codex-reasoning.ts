// 节点详情「思考程度」(flags.modelReasoningEffort) —— RFC-024 hot-tier 下发。

import type { NodeConfigView } from './node-model-change';
import {
  afterSubmit,
  afterPoll,
  phaseIsBusy,
  phaseText as modelPhaseText,
  RESTART_MAX_POLLS,
  RESTART_POLL_MS,
  RESTART_TIMEOUT_MS,
  type ModelChangePhase,
  type SubmitOutcome,
} from './node-model-change';
import { normalizeCodexReasoningEffort, type CodexReasoningEffort } from './codex-reasoning-effort';

export function currentReasoningEffort(view: NodeConfigView | null | undefined): CodexReasoningEffort {
  const raw = view?.flags?.modelReasoningEffort;
  return normalizeCodexReasoningEffort(raw);
}

export function afterPollReasoning(
  phase: Extract<ModelChangePhase, { kind: 'restarting' }>,
  view: NodeConfigView | null,
  maxPolls: number = RESTART_MAX_POLLS,
): ModelChangePhase {
  const requested = phase.requested;
  if (
    view
    && view.config_revision > phase.baseRevision
    && normalizeCodexReasoningEffort(view.flags?.modelReasoningEffort) === requested
  ) {
    return { kind: 'applied', model: requested };
  }
  return afterPoll(phase, view ? { ...view, model: null } : view, maxPolls);
}

export function reasoningPhaseText(phase: ModelChangePhase): string {
  if (phase.kind === 'submitting') return `正在提交思考程度「${phase.requested}」…`;
  if (phase.kind === 'restarting') return `已下发,节点正在应用…(已检查 ${phase.polls} 次)`;
  if (phase.kind === 'applied') return `思考程度已设为 ${phase.model}`;
  if (phase.kind === 'timeout') return `已下发 ${phase.requested},但 ${RESTART_MAX_POLLS * RESTART_POLL_MS / 1000}s 内节点没有确认。请到它所在机器看日志。`;
  return modelPhaseText(phase);
}

export { afterSubmit, phaseIsBusy, RESTART_POLL_MS, RESTART_MAX_POLLS, RESTART_TIMEOUT_MS, type ModelChangePhase, type SubmitOutcome };
