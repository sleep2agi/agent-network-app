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
};

/** Suggested model ids for a runtime; unknown/missing runtime → []. */
export function suggestedModels(runtime: string | null | undefined): string[] {
  if (!runtime) return [];
  return RUNTIME_MODEL_SUGGESTIONS[runtime] ?? [];
}
