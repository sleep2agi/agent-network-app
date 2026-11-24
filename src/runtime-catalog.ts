// 各 runtime 的「建议模型」——和新建节点向导(CreateNodeWizardScreen.tsx 的
// RUNTIMES 表)同一份内容。向导那份必须是字面量(wizard-runtimes.test.ts 读源码
// 切片断言),所以这里单独放一份纯数据给非 RN 模块用,node-model-change.test.ts
// 读向导源码逐条比对,两份漂移会红。
//
// 空数组 = 共存 runtime 跟随宿主 TUI 的登录态,没有可选模型(仍可手输 id)。
//
// 这份表只是「建议」,会滞后于 provider 实际可用列表:opencode/mimo-v2.5-free 已从
// OpenCode Zen 下架(2026-09-23 真机:选它后节点回件 HTTP 500),故移除;当前模型
// 不在表里时详情页仍要把它显示为选中(modelChips),不能静默藏掉。
export const RUNTIME_MODEL_SUGGESTIONS: Record<string, string[]> = {
  'claude-agent-sdk': ['deepseek-v4-pro', 'MiniMax-M3', 'claude-sonnet-4-6', 'claude-opus-4-x'],
  'codex-sdk': ['gpt-5.5'],
  'grok-build-acp': ['grok-build'],
  'claude-code-cli': [],
  'codex-app-server': [],
  'grok-build-cli': [],
  'opencode-cli': ['opencode/mimo-v2.6-flash-free', 'opencode/north-mini-code-free'],
  // agy 正常 ACP：Google 登录，模型 slug 以 `agy models` 为准（只放验收过的）。
  // 2026-11-20 真机（负责人 agy 1.5.13，session/new 的 availableModels 27 个真实 id；
  // Antigravity 是多厂商聚合：Gemini 4 系列 + Claude 5.5 + gpt-oss）。
  'antigravity-acp': ['gemini-4-neon-high', 'gemini-4-neon-xhigh', 'gemini-4-neon-medium', 'gemini-4-neon-low', 'gemini-4-carbon-medium', 'gemini-4-carbon-high', 'gemini-4-carbon-low', 'gemini-4-argon-medium', 'gemini-4-argon-high', 'gemini-4-argon-low', 'gemini-4-hydrogen-high', 'gemini-4-hydrogen-xhigh', 'gemini-4-hydrogen-medium', 'gemini-4-hydrogen-low', 'gemini-pro-orchestrator', 'gemini-pro-orchestrator-neon', 'gemini-pro-orchestrator-argon', 'gemini-3.8-flash-high', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-low', 'claude-opus-5-5-low', 'claude-opus-5-5-medium', 'claude-opus-5-5-high', 'claude-sonnet-5-5-low', 'claude-sonnet-5-5-medium', 'claude-sonnet-5-5-high', 'gpt-oss-120b-medium'],
};

/** Suggested model ids for a runtime; unknown/missing runtime → []. */
export function suggestedModels(runtime: string | null | undefined): string[] {
  if (!runtime) return [];
  if (runtime === 'antigravity-sdk') return RUNTIME_MODEL_SUGGESTIONS['antigravity-acp'] ?? [];
  return RUNTIME_MODEL_SUGGESTIONS[runtime] ?? [];
}
