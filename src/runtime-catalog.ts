// 各 runtime 的「建议模型」——和新建节点向导(CreateNodeWizardScreen.tsx 的
// RUNTIMES 表)同一份内容。向导那份必须是字面量(wizard-runtimes.test.ts 读源码
// 切片断言),所以这里单独放一份纯数据给非 RN 模块用,node-model-change.test.ts
// 读向导源码逐条比对,两份漂移会红。
//
// 空数组 = 共存 runtime 跟随宿主 TUI 的登录态,没有可选模型(仍可手输 id)。
export const RUNTIME_MODEL_SUGGESTIONS: Record<string, string[]> = {
  'claude-agent-sdk': ['deepseek-v4-pro', 'MiniMax-M3', 'claude-sonnet-4-6', 'claude-opus-4-x'],
  'codex-sdk': ['gpt-5.5'],
  'grok-build-acp': ['grok-build'],
  'claude-code-cli': [],
  'codex-app-server': [],
  'grok-build-cli': [],
  'opencode-cli': ['opencode/mimo-v2.5-free', 'opencode/north-mini-code-free'],
};

/** Suggested model ids for a runtime; unknown/missing runtime → []. */
export function suggestedModels(runtime: string | null | undefined): string[] {
  if (!runtime) return [];
  return RUNTIME_MODEL_SUGGESTIONS[runtime] ?? [];
}
