// 节点详情「自动执行」(Codex yolo flags) —— RFC-024 update_node_config。

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
import { codexYoloFlagsRecord, isCodexAutoExecuteActive } from './codex-execution-posture';

export function currentCodexAutoExecute(view: NodeConfigView | null | undefined): boolean {
  return isCodexAutoExecuteActive(view?.flags ?? null);
}

export function patchFlagsForAutoExecute(enabled: boolean): Record<string, unknown> {
  if (enabled) return { ...codexYoloFlagsRecord() };
  return {
    approvalPolicy: 'on-request',
    sandboxMode: 'read-only',
    skipGitRepoCheck: false,
  };
}

export function afterPollAutoExecute(
  phase: Extract<ModelChangePhase, { kind: 'restarting' }>,
  view: NodeConfigView | null,
  maxPolls: number = RESTART_MAX_POLLS,
): ModelChangePhase {
  const want = phase.requested === 'on';
  if (
    view
    && view.config_revision > phase.baseRevision
    && currentCodexAutoExecute(view) === want
  ) {
    return { kind: 'applied', model: phase.requested };
  }
  return afterPoll(phase, view ? { ...view, model: null } : view, maxPolls);
}

export function executionPhaseText(phase: ModelChangePhase): string {
  if (phase.kind === 'submitting') {
    return phase.requested === 'on' ? '正在开启自动执行…' : '正在改为需确认后执行…';
  }
  if (phase.kind === 'restarting') return `已下发,节点正在应用…(已检查 ${phase.polls} 次)`;
  if (phase.kind === 'applied') {
    return phase.model === 'on' ? '已开启自动执行（不弹确认）' : '已改为需确认后执行';
  }
  if (phase.kind === 'timeout') {
    return `已下发,但 ${RESTART_MAX_POLLS * RESTART_POLL_MS / 1000}s 内节点没有确认。请到它所在机器看日志。`;
  }
  return modelPhaseText(phase);
}

export { afterSubmit, phaseIsBusy, RESTART_POLL_MS, RESTART_MAX_POLLS, RESTART_TIMEOUT_MS, type ModelChangePhase, type SubmitOutcome };
