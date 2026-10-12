// Codex 推理档位 —— 与 agent-network `flags.modelReasoningEffort` / Codex ReasoningEffort 对齐。

export const CODEX_REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const;

export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number];

export const DEFAULT_CODEX_REASONING_EFFORT: CodexReasoningEffort = 'low';

export function isCodexReasoningEffort(v: unknown): v is CodexReasoningEffort {
  return typeof v === 'string' && (CODEX_REASONING_EFFORTS as readonly string[]).includes(v);
}

export function normalizeCodexReasoningEffort(raw: unknown): CodexReasoningEffort {
  return isCodexReasoningEffort(raw) ? raw : DEFAULT_CODEX_REASONING_EFFORT;
}

export const CODEX_REASONING_EFFORT_LABELS: Record<CodexReasoningEffort, string> = {
  none: '关',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
};
