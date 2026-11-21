// ACP runtime（grok-build-acp / antigravity-acp）的模型设置。
//
// 为什么单独一条：这两个 runtime 没有 OpenCode 那种 `read_opencode_catalog` 目录，
// 面板不能照搬「目录驱动」。2026-11-21 admin 反馈 agy 节点在 App 里根本选不了模型——
// 之前 #3705 修的是「CLI 设的模型能不能真生效」，没碰「App 里能不能选」。
//
// 做法（够用优先）：允许直接输入模型 id（可选快捷候选），写节点配置（与 CLI
// `anet node edit --model` 同一份），并明确告诉用户 **需要重启节点生效**、**未做读回校验**。
// 不假装验证过：这里只能确认「配置写进去了」，运行时的真实模型要重启后由节点自报。

export const ACP_MODEL_RUNTIMES = ['grok-build-acp', 'antigravity-acp'] as const;

export function isAcpModelRuntime(runtime: string | null | undefined): boolean {
  const id = String(runtime ?? '').trim();
  return (ACP_MODEL_RUNTIMES as readonly string[]).includes(id);
}

/** agy 常见模型 id 的候选（只做提示，允许任意输入；不声称是完整清单）。
 *  来源：负责人在 ANet反重力 上的真机验证（`anet node edit --model` 实际跑通的 id），
 *  以及 runtime 侧 `applyConfiguredModel()` 能透传的同一批 vendor。 */
export const ACP_MODEL_SUGGESTIONS: ReadonlyArray<{ vendor: string; ids: ReadonlyArray<string> }> = [
  { vendor: 'Claude', ids: ['claude-opus-5-5-high', 'claude-sonnet-5-5-high'] },
  { vendor: 'Gemini', ids: ['gemini-3.8-flash-high', 'gemini-pro-orchestrator'] },
  { vendor: 'OpenAI', ids: ['gpt-oss-120b'] },
];

export type AcpModelDraft = { ok: true; value: string } | { ok: false; error: 'invalid_model_id' };

/** 模型 id 的本地校验：trim 后非空、无空白/控制字符、长度上限 120。 */
export function normalizeAcpModelId(input: string): AcpModelDraft {
  const value = String(input ?? '').trim();
  if (!value || value.length > 120 || /[\s\u0000-\u001f\u007f]/.test(value)) return { ok: false, error: 'invalid_model_id' };
  return { ok: true, value };
}

export function acpModelErrorText(code: string): string {
  if (code === 'invalid_model_id') return '模型 id 不能为空、不能带空格或控制字符，最长 120。';
  return code;
}
